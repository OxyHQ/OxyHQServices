/**
 * Express application for the Oxy personal data node.
 *
 * Endpoints:
 *  - `GET  /.well-known/oxy-node.json` — node identity + liveness (Oxy's probe).
 *  - `GET  /oxy/head`                  — chain head `{ seq, headRecordId, recordCount }`.
 *  - `GET  /oxy/log?since=&limit=`     — ordered envelopes from a cursor (Oxy ingest).
 *  - `POST /records`                   — owner writes a single signed envelope.
 *  - `POST /sync/push`                 — owner pushes a batch of signed envelopes.
 *  - `GET  /blobs/:hash`               — serve a content-addressed blob.
 *  - `PUT  /blobs/:hash`               — owner pins a blob (signed-header auth).
 *  - `GET  /health`                    — container liveness.
 *
 * `createApp` is dependency-injected (store, config, logger) so it can be driven
 * by tests with an in-memory store and no network.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Logger } from './logger.js';
import type { NodeConfig } from './config.js';
import { isOwnerKey, verifyOwnerActionSignature } from './auth.js';
import { verifyRecordEnvelope } from './verify.js';
import { BlobHashMismatchError, type NodeStore } from './store/nodeStore.js';
import {
  DEFAULT_LOG_LIMIT,
  JSON_BODY_LIMIT,
  MAX_LOG_LIMIT,
  MAX_SYNC_BATCH,
  OWNER_ACTION_BLOB_PIN,
  OWNER_AUTH_HEADERS,
  SHA256_HEX,
} from './constants.js';

export interface AppDependencies {
  store: NodeStore;
  config: NodeConfig;
  logger: Logger;
}

/** Clamp the `limit` query param into `[1, MAX_LOG_LIMIT]`, defaulting when absent/invalid. */
function parseLimit(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULT_LOG_LIMIT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_LOG_LIMIT;
  }
  return Math.min(value, MAX_LOG_LIMIT);
}

/** HTTP status for a chain-append rejection. */
function appendStatus(reason: string): number {
  return reason === 'chain_conflict' ? 409 : 422;
}

export function createApp(deps: AppDependencies): Express {
  const { store, config, logger } = deps;
  const app = express();
  app.disable('x-powered-by');

  // JSON parser applies only to JSON bodies (it checks Content-Type), so the raw
  // blob upload below is untouched by it.
  const jsonParser = express.json({ limit: JSON_BODY_LIMIT });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // ── Node identity / liveness ────────────────────────────────────────────────
  app.get('/.well-known/oxy-node.json', (_req: Request, res: Response) => {
    const head = store.getHead();
    res.json({
      nodePublicKey: config.nodePublicKey,
      mode: config.mode,
      version: config.protocolVersion,
      head: head ? { seq: head.seq, headRecordId: head.headRecordId } : null,
    });
  });

  // ── Chain head ──────────────────────────────────────────────────────────────
  app.get('/oxy/head', (_req: Request, res: Response) => {
    const head = store.getHead();
    if (!head) {
      res.json({ seq: null, headRecordId: null, recordCount: 0 });
      return;
    }
    res.json({ seq: head.seq, headRecordId: head.headRecordId, recordCount: head.recordCount });
  });

  // ── Ordered log (Oxy ingest) ─────────────────────────────────────────────────
  app.get('/oxy/log', (req: Request, res: Response) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const limit = parseLimit(req.query.limit);
    const records = store.getLogSince(since, limit);
    const head = store.getHead();
    res.json({
      records: records.map((record) => ({
        seq: record.seq,
        recordId: record.recordId,
        prev: record.prev,
        issuedAt: record.issuedAt,
        envelope: record.envelope,
      })),
      count: records.length,
      head: head ? { seq: head.seq, headRecordId: head.headRecordId } : null,
    });
  });

  // ── Owner write: a single signed envelope ────────────────────────────────────
  app.post('/records', jsonParser, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const verification = await verifyRecordEnvelope(req.body);
      if (!verification.ok) {
        res.status(400).json({ error: verification.reason });
        return;
      }
      if (!isOwnerKey(verification.envelope.publicKey, config.ownerPublicKey)) {
        res.status(403).json({ error: 'not_owner' });
        return;
      }
      const outcome = store.appendRecord(verification.envelope, verification.recordId);
      if (!outcome.ok) {
        res.status(appendStatus(outcome.reason)).json({ error: outcome.reason });
        return;
      }
      res.status(201).json({ recordId: outcome.recordId, seq: outcome.seq });
    } catch (error) {
      next(error);
    }
  });

  // ── Owner write: a batch push (verified + appended in order) ──────────────────
  app.post('/sync/push', jsonParser, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body: unknown = req.body;
      const items =
        typeof body === 'object' && body !== null && Array.isArray((body as { records?: unknown }).records)
          ? ((body as { records: unknown[] }).records)
          : null;
      if (!items) {
        res.status(400).json({ error: 'invalid_batch' });
        return;
      }
      if (items.length > MAX_SYNC_BATCH) {
        res.status(400).json({ error: 'batch_too_large' });
        return;
      }

      const results: Array<
        { ok: true; recordId: string; seq: number } | { ok: false; reason: string }
      > = [];
      for (const item of items) {
        const verification = await verifyRecordEnvelope(item);
        if (!verification.ok) {
          results.push({ ok: false, reason: verification.reason });
          continue;
        }
        if (!isOwnerKey(verification.envelope.publicKey, config.ownerPublicKey)) {
          results.push({ ok: false, reason: 'not_owner' });
          continue;
        }
        const outcome = store.appendRecord(verification.envelope, verification.recordId);
        results.push(
          outcome.ok
            ? { ok: true, recordId: outcome.recordId, seq: outcome.seq }
            : { ok: false, reason: outcome.reason },
        );
      }

      const accepted = results.filter((result) => result.ok).length;
      res.json({ accepted, results });
    } catch (error) {
      next(error);
    }
  });

  // ── Serve a content-addressed blob ───────────────────────────────────────────
  app.get('/blobs/:hash', (req: Request, res: Response) => {
    const hash = req.params.hash.toLowerCase();
    if (!SHA256_HEX.test(hash)) {
      res.status(400).json({ error: 'invalid_hash' });
      return;
    }
    const bytes = store.getBlob(hash);
    if (!bytes) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    // Content-addressed → immutable, safe to cache aggressively.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(bytes);
  });

  // ── Owner pins a blob (signed-header authorization) ──────────────────────────
  app.put(
    '/blobs/:hash',
    express.raw({ type: () => true, limit: config.maxBlobBytes }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const hash = req.params.hash.toLowerCase();
        if (!SHA256_HEX.test(hash)) {
          res.status(400).json({ error: 'invalid_hash' });
          return;
        }

        const publicKey = req.header(OWNER_AUTH_HEADERS.publicKey);
        const signature = req.header(OWNER_AUTH_HEADERS.signature);
        const timestampRaw = req.header(OWNER_AUTH_HEADERS.timestamp);
        if (!publicKey || !signature || !timestampRaw) {
          res.status(401).json({ error: 'missing_owner_auth' });
          return;
        }

        const authorized = await verifyOwnerActionSignature(config.ownerPublicKey, `${OWNER_ACTION_BLOB_PIN}:${hash}`, {
          publicKey,
          signature,
          timestamp: Number(timestampRaw),
        });
        if (!authorized) {
          res.status(403).json({ error: 'unauthorized' });
          return;
        }

        const bytes = req.body;
        if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
          res.status(400).json({ error: 'empty_blob' });
          return;
        }

        try {
          store.putBlob(hash, bytes);
        } catch (error) {
          if (error instanceof BlobHashMismatchError) {
            res.status(400).json({ error: 'hash_mismatch' });
            return;
          }
          throw error;
        }

        res.status(201).json({ hash, size: bytes.length });
      } catch (error) {
        next(error);
      }
    },
  );

  // ── Terminal error handler ───────────────────────────────────────────────────
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'unhandled request error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
