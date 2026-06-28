/**
 * Node Sync Service (self-sovereign identity layer — F5b node → Oxy ingest)
 *
 * Pulls a user's authentic signed-record chain BACK from their personal data
 * node and mirrors it into Oxy's fast local copy ({@link SignedRecord} +
 * {@link RepoHead}). This is the inbound half of the two-way sync; F5a is the
 * outbound (Oxy → node) export.
 *
 * ## Absolute read-path invariant
 *
 * Every node fetch here goes through `@oxyhq/core/server`'s `safeFetch`
 * (HTTPS-only, private-IP denylist, DNS-pinned, bounded redirects) and runs ONLY
 * in the background (the BullMQ worker / the in-process fallback). NOTHING in a
 * request's read path ever calls this. A down/slow/malicious node leaves Oxy's
 * mirror STALE — never wrong and never slow. `ingestFromNode` NEVER throws into a
 * caller; it logs and records `lastError` on the {@link UserNode} row.
 *
 * ## Trust model — verify everything, trust nothing the node says
 *
 * The node is untrusted transport. Every record it returns is independently
 * re-verified with the EXISTING `signedRecord.service.verifyEnvelope` (signature
 * over the canonical input, recomputed `recordId`, current-verification-method /
 * subject ownership, freshness, and v2 chain continuity). A record whose
 * `publicKey` is not a current verification method of THIS user's DID, or whose
 * `subject` is not this user's DID, is rejected as forged/foreign — a node
 * cannot inject a record the user did not sign.
 *
 * ## Conflict resolution
 *
 *  - **Linear append** (the normal case): a record that extends Oxy's chain head
 *    by one is appended atomically via `verifyAndStoreRecord`, advancing the
 *    head and the {@link UserNode} cursor.
 *  - **Last-writer-wins per `(userId, nsid, rkey)`**: a record whose `issuedAt`
 *    is not newer than Oxy's current value for that key (tiebreak: higher
 *    `recordId`) is the loser — Oxy keeps what it has and skips. This also makes
 *    re-pulling an already-ingested record idempotent.
 *  - **Genuine fork** (a record authentically signed by the owner that conflicts
 *    Oxy's chain at an existing point): append-only history is authentic, so the
 *    forked envelope is ALSO preserved (stored as a non-chained mirror row so the
 *    unique `(userId, seq)` chain index is never violated) and the materialized
 *    "current" value for its key advances to it when it wins LWW. Both branches
 *    persist; nothing is ever deleted; the fork is logged.
 *
 * ## Anti-rewrite counter-signature
 *
 * Every recordId Oxy ingests is COUNTER-SIGNED with the Oxy custodial key into an
 * append-only {@link NodeIngestWitness}. If the user's node key were stolen and
 * used to silently rewrite history, the witness proves the original record
 * existed and was observed by Oxy at a specific time. When the Oxy key is
 * unconfigured (dev/pre-prod) witnessing is skipped (logged once) but ingest
 * still proceeds.
 */

import { canonicalize, computeRecordId } from '@oxyhq/core';
import { safeFetch } from '@oxyhq/core/server';
import { signedRecordEnvelopeSchema, type SignedRecordEnvelope } from '@oxyhq/contracts';
import UserNode from '../models/UserNode';
import SignedRecord from '../models/SignedRecord';
import NodeIngestWitness from '../models/NodeIngestWitness';
import { User } from '../models/User';
import SignatureService from './signature.service';
import { getHead } from './repoLog.service';
import {
  verifyAndStoreRecord,
  type SignedRecordSubject,
} from './signedRecord.service';
import userCache from '../utils/userCache';
import { logger } from '../utils/logger';
import {
  NODE_OXY_HEAD_PATH,
  NODE_OXY_LOG_PATH,
  NODE_INGEST_BATCH,
  NODE_INGEST_MAX_ITERATIONS,
  NODE_INGEST_FETCH_TIMEOUT_MS,
  NODE_INGEST_MAX_BYTES,
  NODE_LAST_ERROR_MAX_LEN,
} from '../utils/nodes.constants';

/** True only once the missing-Oxy-key warning has been logged (avoid log spam). */
let warnedMissingOxyKey = false;

/** The cached node fields the ingest worker needs. */
interface IngestNode {
  endpoint: string;
  cursor?: number;
}

/** Per-record ingest outcome, used to drive cursor advance + loop control. */
type IngestOutcome =
  | { kind: 'appended'; seq: number; recordId: string }
  | { kind: 'fork'; recordId: string }
  | { kind: 'skipped' }
  | { kind: 'stop'; reason: string };

/** A bounded JSON read of a node response (rejects when the cap is exceeded). */
function readBoundedJson(stream: NodeJS.ReadableStream, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        (stream as { destroy?: () => void }).destroy?.();
        reject(new Error(`node response exceeded ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    stream.on('error', reject);
  });
}

/**
 * Fetch the node's chain head seq via `safeFetch ${endpoint}/oxy/head`. Throws on
 * a non-2xx response, an oversized body, or any fetch/parse error — the caller
 * records that as `lastError` and leaves the mirror stale.
 */
async function fetchNodeHeadSeq(endpoint: string): Promise<number> {
  const result = await safeFetch(`${endpoint}${NODE_OXY_HEAD_PATH}`, {
    headersTimeoutMs: NODE_INGEST_FETCH_TIMEOUT_MS,
    maxRedirects: 1,
  });
  if (result.status < 200 || result.status >= 300) {
    result.response.destroy();
    throw new Error(`node /oxy/head responded HTTP ${result.status}`);
  }
  const body = await readBoundedJson(result.response, 64 * 1024);
  const seq = (body as { seq?: unknown }).seq;
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : -1;
}

/**
 * Fetch one ordered page of the node's log via
 * `safeFetch ${endpoint}/oxy/log?since=<seq>&limit=<n>`. Returns the raw record
 * objects (each is re-validated + re-verified per record by the caller). Throws
 * on a non-2xx / oversized / malformed-envelope response.
 */
async function fetchNodeLogPage(endpoint: string, sinceSeq: number, limit: number): Promise<unknown[]> {
  const url = `${endpoint}${NODE_OXY_LOG_PATH}?since=${encodeURIComponent(String(sinceSeq))}&limit=${encodeURIComponent(String(limit))}`;
  const result = await safeFetch(url, {
    headersTimeoutMs: NODE_INGEST_FETCH_TIMEOUT_MS,
    maxRedirects: 1,
  });
  if (result.status < 200 || result.status >= 300) {
    result.response.destroy();
    throw new Error(`node /oxy/log responded HTTP ${result.status}`);
  }
  const body = await readBoundedJson(result.response, NODE_INGEST_MAX_BYTES);
  const records = (body as { records?: unknown }).records;
  if (!Array.isArray(records)) {
    throw new Error('node /oxy/log returned no records array');
  }
  return records;
}

/**
 * Counter-sign an ingested recordId with the Oxy custodial key and append it to
 * the witness ledger (idempotent per recordId). Non-fatal and never throws: a
 * missing Oxy key skips witnessing (warned once); a duplicate is a no-op.
 */
async function witnessRecord(userId: string, recordId: string, ingestedAt: number): Promise<void> {
  const privateKey = process.env.OXY_PRIVATE_KEY;
  const publicKey = process.env.OXY_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    if (!warnedMissingOxyKey) {
      warnedMissingOxyKey = true;
      logger.warn('Node ingest counter-signing skipped: OXY_PRIVATE_KEY/OXY_PUBLIC_KEY not configured', {
        component: 'nodeSync',
      });
    }
    return;
  }
  try {
    const witnessSignature = SignatureService.signMessage(
      canonicalize({ recordId, userId, ingestedAt }),
      privateKey,
    );
    await NodeIngestWitness.create({ userId, recordId, witnessSignature, ingestedAt });
  } catch (err) {
    // A duplicate recordId (E11000) means we already witnessed it — expected on
    // a re-pull. Anything else is logged, never thrown (background-safe).
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      return;
    }
    logger.warn('Node ingest counter-signature failed (non-fatal)', {
      component: 'nodeSync',
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The current materialized record for an AtProto-style `(nsid, rkey)` key, as the
 * minimal `{ issuedAt, recordId }` LWW needs. Reads Oxy's own copy only.
 */
async function currentKeyValue(
  userId: string,
  nsid: string,
  rkey: string,
): Promise<{ issuedAt: number; recordId: string } | null> {
  const row = await SignedRecord.findOne({ userId, nsid, rkey, verified: true })
    .sort({ createdAt: -1 })
    .lean<{ recordId?: string; envelope?: { issuedAt?: number } } | null>();
  if (!row || typeof row.envelope?.issuedAt !== 'number' || typeof row.recordId !== 'string') {
    return null;
  }
  return { issuedAt: row.envelope.issuedAt, recordId: row.recordId };
}

/**
 * Last-writer-wins decision: does the incoming record supersede the existing
 * value for its key? Newer `issuedAt` wins; on an exact `issuedAt` tie the higher
 * `recordId` (string compare) wins. No existing value → incoming always wins.
 */
function incomingWinsLww(
  incoming: { issuedAt: number; recordId: string },
  existing: { issuedAt: number; recordId: string } | null,
): boolean {
  if (!existing) return true;
  if (incoming.issuedAt !== existing.issuedAt) return incoming.issuedAt > existing.issuedAt;
  return incoming.recordId > existing.recordId;
}

/**
 * Persist a forked / tie-breaking envelope as a NON-chained mirror row. It keeps
 * the AtProto `(nsid, rkey)` materialization fields and `recordId` (so it becomes
 * the current value for its key by `createdAt`) but deliberately carries NO `seq`
 * — the authentic linear chain (and its unique `(userId, seq)` index) is left
 * untouched, so both the existing chain row AND this fork branch persist. The
 * unique `recordId` index makes a re-ingested fork idempotent.
 */
async function storeForkMirror(env: SignedRecordEnvelope, userId: string, recordId: string): Promise<boolean> {
  try {
    await SignedRecord.create({
      subjectDid: env.subject,
      userId,
      type: env.type,
      envelope: env,
      publicKey: env.publicKey,
      verified: true,
      // No `seq`/`prev` — intentionally off the linear chain (fork archive).
      recordId,
      nsid: env.version === 2 ? env.collection : undefined,
      rkey: env.version === 2 ? env.rkey : undefined,
    });
    return true;
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      return false; // already stored (idempotent re-pull)
    }
    throw err;
  }
}

/**
 * Verify + ingest a single envelope from the node. Drives the cursor/loop via the
 * returned {@link IngestOutcome}. `verifyAndStoreRecord` does the heavy lifting
 * (re-verify + atomic append + head advance); its rejection reason routes the
 * record to LWW-skip, fork-preserve, or hard-reject.
 */
async function ingestEnvelope(
  env: SignedRecordEnvelope,
  subject: SignedRecordSubject,
  userId: string,
): Promise<IngestOutcome> {
  const result = await verifyAndStoreRecord(env, subject, userId);

  if (result.ok) {
    const recordId = result.record.recordId ?? (await computeRecordId(env));
    await witnessRecord(userId, recordId, Date.now());
    return { kind: 'appended', seq: typeof result.record.seq === 'number' ? result.record.seq : -1, recordId };
  }

  switch (result.reason) {
    case 'stale_issued_at': {
      // LWW: incoming is not newer for its key — usually idempotent re-pull. Only
      // an exact-issuedAt tie with a higher recordId flips to incoming (fork
      // archive); otherwise Oxy keeps what it has. Either way the linear chain
      // cannot advance through a stale frontier record, so we stop.
      if (env.version === 2 && env.collection && env.rkey) {
        const recordId = await computeRecordId(env);
        const existing = await currentKeyValue(userId, env.collection, env.rkey);
        if (incomingWinsLww({ issuedAt: env.issuedAt, recordId }, existing)) {
          const stored = await storeForkMirror(env, userId, recordId);
          if (stored) {
            await witnessRecord(userId, recordId, Date.now());
            logger.info('Node ingest LWW tiebreak adopted incoming record', {
              component: 'nodeSync',
              userId,
              nsid: env.collection,
              rkey: env.rkey,
            });
            return { kind: 'stop', reason: 'lww_tiebreak' };
          }
        }
      }
      return { kind: 'skipped' };
    }

    case 'chain_fork':
    case 'bad_seq':
    case 'chain_conflict': {
      // A genuine fork: the record is authentically signed by the owner (signature
      // + ownership + freshness all passed before the chain check) but conflicts
      // Oxy's chain. Preserve it append-only and let it win materialization for
      // its key (it is strictly newer — `stale_issued_at` is handled above). The
      // authentic linear chain is left intact; we stop advancing past the fork.
      const recordId = await computeRecordId(env);
      const stored = await storeForkMirror(env, userId, recordId);
      if (stored) {
        await witnessRecord(userId, recordId, Date.now());
      }
      logger.warn('Node ingest detected a chain fork; preserved both branches', {
        component: 'nodeSync',
        userId,
        reason: result.reason,
        recordId,
      });
      return { kind: 'fork', recordId };
    }

    case 'chain_gap':
      // Oxy is missing intermediate records this one builds on — cannot append out
      // of order. Stop and leave the mirror stale at the last good seq.
      return { kind: 'stop', reason: 'chain_gap' };

    default:
      // Forged / foreign / malformed: subject_mismatch,
      // public_key_not_a_current_verification_method, untrusted_issuer,
      // bad_signature, invalid_envelope, issued_in_future. Reject and stop so a
      // poisoned log entry can never advance the mirror.
      logger.warn('Node ingest rejected a record', {
        component: 'nodeSync',
        userId,
        reason: result.reason,
      });
      return { kind: 'stop', reason: `rejected:${result.reason}` };
  }
}

/**
 * Ingest a user's chain from their registered node into Oxy's local mirror.
 *
 * Background-safe: NEVER throws. A missing/revoked/unreachable node is a no-op
 * (or records `lastError`) — the mirror simply stays as-is. On success the
 * {@link UserNode} cursor (= Oxy's local head seq) and `lastSyncedAt` advance, and
 * the user cache is invalidated when the materialized records/DID changed.
 */
export async function ingestFromNode(userId: string): Promise<void> {
  try {
    const node = await UserNode.findOne({ userId, status: { $ne: 'revoked' } })
      .select('endpoint cursor')
      .lean<IngestNode | null>();
    if (!node) {
      return; // no registered node — nothing to ingest
    }

    const user = await User.findById(userId).select('publicKey authMethods').lean();
    if (!user) {
      return;
    }
    const subject: SignedRecordSubject = { publicKey: user.publicKey, authMethods: user.authMethods };

    // Compare the node's head against Oxy's local head. When Oxy is already at or
    // ahead of the node, there is nothing to pull — just stamp the sync time.
    let remoteHeadSeq: number;
    try {
      remoteHeadSeq = await fetchNodeHeadSeq(node.endpoint);
    } catch (err) {
      await recordIngestError(userId, err);
      return;
    }

    const localHead = await getHead(userId);
    const localHeadSeq = localHead ? localHead.seq : -1;
    // Never re-pull below our own head: start from the greater of the persisted
    // cursor and the live local head (idempotent — avoids re-ingesting).
    let cursor = Math.max(typeof node.cursor === 'number' ? node.cursor : -1, localHeadSeq);

    if (remoteHeadSeq <= cursor) {
      await markSynced(userId, cursor, true);
      return;
    }

    let changed = false;
    let stopReason: string | null = null;

    for (let iteration = 0; iteration < NODE_INGEST_MAX_ITERATIONS && !stopReason; iteration += 1) {
      let page: unknown[];
      try {
        page = await fetchNodeLogPage(node.endpoint, cursor, NODE_INGEST_BATCH);
      } catch (err) {
        await recordIngestError(userId, err);
        return;
      }
      if (page.length === 0) {
        break; // caught up
      }

      for (const raw of page) {
        const parsed = signedRecordEnvelopeSchema.safeParse(raw);
        if (!parsed.success) {
          stopReason = 'rejected:invalid_envelope';
          logger.warn('Node ingest rejected a malformed envelope', { component: 'nodeSync', userId });
          break;
        }
        const env = parsed.data;

        // Already mirrored (below our advanced cursor)? Skip without re-work.
        if (env.version === 2 && typeof env.seq === 'number' && env.seq <= cursor) {
          continue;
        }

        const outcome = await ingestEnvelope(env, subject, userId);
        if (outcome.kind === 'appended') {
          cursor = outcome.seq >= 0 ? outcome.seq : cursor;
          changed = true;
        } else if (outcome.kind === 'fork') {
          changed = true;
          stopReason = 'chain_fork';
          break;
        } else if (outcome.kind === 'stop') {
          if (outcome.reason === 'lww_tiebreak') {
            changed = true;
          }
          stopReason = outcome.reason;
          break;
        }
        // 'skipped' → continue to the next record (LWW loser / idempotent).
      }

      // A short page means the node has no more records right now.
      if (page.length < NODE_INGEST_BATCH) {
        break;
      }
    }

    if (stopReason && stopReason !== 'lww_tiebreak') {
      await UserNode.updateOne(
        { userId, status: { $ne: 'revoked' } },
        { $set: { cursor, lastSyncedAt: new Date(), lastError: stopReason.slice(0, NODE_LAST_ERROR_MAX_LEN) } },
      );
    } else {
      await markSynced(userId, cursor, true);
    }

    if (changed) {
      userCache.invalidate(userId);
    }
  } catch (err) {
    // Background-safe: a programming/DB error must never escape the worker.
    logger.error(
      'Node ingest encountered an error',
      err instanceof Error ? err : new Error(String(err)),
      { component: 'nodeSync', userId },
    );
    await recordIngestError(userId, err).catch(() => undefined);
  }
}

/** Advance the cursor + stamp `lastSyncedAt`; clear `lastError` when requested. */
async function markSynced(userId: string, cursor: number, clearError: boolean): Promise<void> {
  await UserNode.updateOne(
    { userId, status: { $ne: 'revoked' } },
    {
      $set: { cursor, lastSyncedAt: new Date() },
      ...(clearError ? { $unset: { lastError: '' } } : {}),
    },
  );
}

/** Record a non-throwing ingest failure as `lastError` on the node row. */
async function recordIngestError(userId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.debug('Node ingest fetch failed', { component: 'nodeSync', userId, error: message });
  await UserNode.updateOne(
    { userId, status: { $ne: 'revoked' } },
    { $set: { lastError: message.slice(0, NODE_LAST_ERROR_MAX_LEN), lastSyncedAt: new Date() } },
  );
}
