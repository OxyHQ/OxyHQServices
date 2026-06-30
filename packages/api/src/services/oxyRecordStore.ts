/**
 * Oxy RecordStore — the @oxyhq/protocol {@link RecordStore} implementation over
 * Oxy's Mongo `SignedRecord` + `RepoHead` models.
 *
 * This is the storage HALF of the chain adapter: the protocol engine
 * (`@oxyhq/protocol`'s `verifyAndAppend`) owns verification + continuity policy
 * and delegates every read/write here. Everything Oxy- and Mongo-specific that
 * does NOT belong in the app-agnostic engine lives in this file:
 *
 *  - `withTransaction` (the atomic append + head advance, with the session-less
 *    fallback for a standalone mongod in local dev),
 *  - the unique `{userId, seq}` index backstop translated to `chain_conflict`
 *    on a duplicate-key (E11000) error,
 *  - the v1 `{type}` vs v2 `{nsid, rkey}` monotonicity split, and
 *  - the `nsid` denormalization of the envelope's `collection` field.
 *
 * The store is **subject-keyed by the subject DID** (the protocol's notion of a
 * subject). Oxy's primary key is the account `userId`, so each method parses the
 * DID back to its `userId` via {@link parseUserDid}. (Oxy has no per-record blob
 * storage — identity/civic/node records carry no blobs — so no `BlobStore` is
 * implemented here.)
 */

import mongoose, { type ClientSession } from 'mongoose';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import type { AppendOutcome, ChainHead, RecordStore } from '@oxyhq/protocol';
import { buildUserDid, parseUserDid } from './did.service';
import SignedRecord, { type ISignedRecord } from '../models/SignedRecord';
import RepoHead from '../models/RepoHead';
import { logger } from '../utils/logger';

/** Default page size for the log read helpers. */
export const DEFAULT_LOG_LIMIT = 100;
/** Hard ceiling so a single log call can never scan an unbounded slice. */
const MAX_LOG_LIMIT = 500;

function clampLogLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit) || DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT));
}

/**
 * Run a unit of work inside a Mongo transaction, falling back to a session-less
 * execution when the deployment does not support transactions (e.g. a standalone
 * mongod in local dev). Production runs a single-node replica set, so the
 * transactional path is the norm. Mirrors `reputation.service.ts`.
 */
async function withTransaction<T>(
  work: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transactionsUnsupported =
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set') ||
      message.includes('does not support transactions');
    if (transactionsUnsupported) {
      logger.warn(
        'OxyRecordStore: transactions unsupported by this MongoDB deployment; executing without a transaction',
        { component: 'oxyRecordStore' },
      );
      return work(undefined);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

/** True when an error is a MongoDB duplicate-key (E11000) error. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * The Oxy implementation of the protocol {@link RecordStore}, backed by the
 * `SignedRecord` ledger + `RepoHead` head pointer.
 */
class OxyRecordStoreImpl implements RecordStore {
  async getHead(subject: string): Promise<ChainHead | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const head = await RepoHead.findOne({ userId })
      .lean<{ seq: number; headRecordId: string; recordCount?: number } | null>();
    if (!head) {
      return null;
    }
    return {
      headRecordId: head.headRecordId,
      seq: head.seq,
      recordCount: head.recordCount ?? 0,
    };
  }

  /**
   * Persist a verified envelope and (for v2) advance the per-subject hash chain.
   *
   * v1: a single append, NO chain fields and NO head advance. v2: the append AND
   * the head advance happen atomically (one transaction, session-less fallback).
   * A duplicate-key error from the unique `{userId, seq}` / `recordId` index — a
   * concurrent write that already took this `seq` — is surfaced as
   * `chain_conflict` so the caller re-reads the head and retries.
   */
  async append(subject: string, env: SignedRecordEnvelope, recordId: string): Promise<AppendOutcome> {
    const userId = parseUserDid(subject);
    if (!userId) {
      // The subject DID does not belong to this issuer's domain — there is no
      // Oxy chain to write. Treated as a continuity conflict (no valid head).
      return { ok: false, reason: 'chain_gap' };
    }

    if (env.version === 2) {
      try {
        return await withTransaction(async (session) => {
          const opts = session ? { session } : {};
          await SignedRecord.create(
            [
              {
                subjectDid: env.subject,
                userId,
                type: env.type,
                envelope: env,
                publicKey: env.publicKey,
                verified: true,
                seq: env.seq,
                prev: env.prev ?? null,
                recordId,
                // Denormalize the envelope's `collection` to the `nsid` column.
                nsid: env.collection,
                rkey: env.rkey,
              },
            ],
            opts,
          );

          await RepoHead.findOneAndUpdate(
            { userId },
            {
              $set: { subjectDid: env.subject, seq: env.seq, headRecordId: recordId },
              $inc: { recordCount: 1 },
              $setOnInsert: { userId },
            },
            { upsert: true, new: true, ...opts },
          );

          return { ok: true as const, recordId, seq: env.seq as number };
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return { ok: false, reason: 'chain_conflict' };
        }
        throw error;
      }
    }

    // v1: an unchained singleton append. No chain fields, no head advance.
    await SignedRecord.create({
      subjectDid: env.subject,
      userId,
      type: env.type,
      envelope: env,
      publicKey: env.publicKey,
      verified: true,
    });
    return { ok: true, recordId, seq: -1 };
  }

  async getLogSince(subject: string, sinceSeq: number, limit: number = DEFAULT_LOG_LIMIT): Promise<SignedRecordEnvelope[]> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return [];
    }
    const rows = await SignedRecord.find({ userId, seq: { $gt: sinceSeq } })
      .sort({ seq: 1 })
      .limit(clampLogLimit(limit))
      .lean<Array<{ envelope: SignedRecordEnvelope }>>();
    return rows.map((row) => row.envelope);
  }

  async resolveCursorSeq(subject: string, recordId: string): Promise<number | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const row = await SignedRecord.findOne({ userId, recordId })
      .select('seq')
      .lean<{ seq?: number } | null>();
    return typeof row?.seq === 'number' ? row.seq : null;
  }

  async materializeCurrent(subject: string, collection: string, rkey: string): Promise<SignedRecordEnvelope | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const row = await SignedRecord.findOne({ userId, nsid: collection, rkey, verified: true })
      .sort({ createdAt: -1 })
      .lean<{ envelope: SignedRecordEnvelope } | null>();
    return row?.envelope ?? null;
  }

  /**
   * Monotonicity frontier scoped to the LOGICAL record key:
   *  - v1 (identity/profile singletons): per `type` — a newer record supersedes
   *    the latest of the same type.
   *  - v2: per record KEY (`nsid`, `rkey`) — last-writer-wins for THAT key;
   *    distinct keys are independent appends.
   */
  async latestIssuedAtForKey(subject: string, env: SignedRecordEnvelope): Promise<number | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const filter =
      env.version === 2
        ? { userId, nsid: env.collection, rkey: env.rkey }
        : { userId, type: env.type };
    const latest = await SignedRecord.findOne(filter)
      .sort({ createdAt: -1 })
      .lean<{ envelope?: { issuedAt?: number } } | null>();
    const latestIssuedAt = latest?.envelope?.issuedAt;
    return typeof latestIssuedAt === 'number' ? latestIssuedAt : null;
  }

  /* ---------------------------------------------------------------------- */
  /*  Oxy-specific reads (not part of the protocol RecordStore interface)   */
  /* ---------------------------------------------------------------------- */

  /**
   * Public node-bootstrap log export: only verified records whose `nsid` is in
   * the supplied allowlist (an Oxy POLICY passed by the caller — the protocol
   * has no notion of "public collections"). `userId`-keyed because the public
   * chain endpoints address subjects by their Oxy account id.
   */
  async getPublicLogSince(
    userId: string,
    sinceSeq: number,
    limit: number,
    collections: readonly string[],
  ): Promise<SignedRecordEnvelope[]> {
    const rows = await SignedRecord.find({
      userId,
      seq: { $gt: sinceSeq },
      verified: true,
      nsid: { $in: [...collections] },
    })
      .sort({ seq: 1 })
      .limit(clampLogLimit(limit))
      .lean<Array<{ envelope: SignedRecordEnvelope }>>();
    return rows.map((row) => row.envelope);
  }

  /** Latest stored record of `type` for a user (v1 singleton read), or null. */
  async latestRecordOfType(userId: string, type: 'identity' | 'profile'): Promise<ISignedRecord | null> {
    return SignedRecord.findOne({ userId, type }).sort({ createdAt: -1 }).lean<ISignedRecord | null>();
  }
}

/** The singleton Oxy record store the chain adapter + repo-log glue drive. */
export const oxyRecordStore = new OxyRecordStoreImpl();

/** Build the subject DID for an Oxy `userId` (the store's subject key). */
export function subjectKeyForUser(userId: string): string {
  return buildUserDid(userId);
}
