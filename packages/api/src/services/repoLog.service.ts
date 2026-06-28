/**
 * Repo Log Service (self-sovereign identity layer — F0.2 hash chain)
 *
 * Read-side helpers over a subject's per-subject signed-record hash chain. These
 * power the public chain endpoints and the future node-sync log (Fase 5): a node
 * pulls the ordered log since a cursor, checks the head, and materializes the
 * current value of each AtProto-style (collection, rkey) key.
 *
 * All reads are served from Oxy's fast copy ({@link SignedRecord} +
 * {@link RepoHead}) — never from a user node (the absolute read-path invariant).
 */

import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import SignedRecord from '../models/SignedRecord';
import RepoHead from '../models/RepoHead';

/** Default page size for {@link getLogSince}. */
const DEFAULT_LOG_LIMIT = 100;
/** Hard ceiling so a single call can never scan an unbounded slice. */
const MAX_LOG_LIMIT = 500;

/** The O(1) chain head for a subject. */
export interface ChainHead {
  seq: number;
  headRecordId: string;
  recordCount: number;
}

/**
 * The ordered slice of a subject's chain with `seq > sinceSeq`, ascending by
 * `seq`, capped at `limit` (clamped to {@link MAX_LOG_LIMIT}). Only v2 (chained)
 * records have a `seq`, so v1 rows are naturally excluded. Pass `sinceSeq = -1`
 * to start from genesis (`seq === 0`).
 */
export async function getLogSince(
  userId: string,
  sinceSeq: number,
  limit: number = DEFAULT_LOG_LIMIT,
): Promise<SignedRecordEnvelope[]> {
  const capped = Math.max(1, Math.min(Math.trunc(limit) || DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT));
  const rows = await SignedRecord.find({ userId, seq: { $gt: sinceSeq } })
    .sort({ seq: 1 })
    .limit(capped)
    .lean<Array<{ envelope: SignedRecordEnvelope }>>();
  return rows.map((row) => row.envelope);
}

/**
 * Resolve a `recordId` cursor to its chain `seq` for the public node log. A node
 * resumes a pull by passing the last `recordId` it ingested; this maps that
 * content address back to its `seq` so {@link getLogSince} continues from there.
 * Returns `null` when no such (v2) record exists for the user. A pure Oxy-DB
 * read — never touches a node.
 */
export async function resolveCursorSeq(userId: string, recordId: string): Promise<number | null> {
  const row = await SignedRecord.findOne({ userId, recordId })
    .select('seq')
    .lean<{ seq?: number } | null>();
  return typeof row?.seq === 'number' ? row.seq : null;
}

/** The subject's chain head, or `null` when the user has no chain yet. */
export async function getHead(userId: string): Promise<ChainHead | null> {
  const head = await RepoHead.findOne({ userId })
    .lean<{ seq: number; headRecordId: string; recordCount: number } | null>();
  if (!head) {
    return null;
  }
  return {
    seq: head.seq,
    headRecordId: head.headRecordId,
    recordCount: head.recordCount,
  };
}

/**
 * The latest VERIFIED record for an AtProto-style (collection, rkey) key — the
 * materialized "current" value (last-writer-wins by chain order). The
 * caller-facing `collection` parameter matches the envelope field; it maps to
 * the denormalized `nsid` column and the `{userId, nsid, rkey, createdAt: -1}`
 * index. Returns the bare envelope, or `null` when no verified record exists for
 * that key.
 */
export async function materializeCurrent(
  userId: string,
  collection: string,
  rkey: string,
): Promise<SignedRecordEnvelope | null> {
  const row = await SignedRecord.findOne({ userId, nsid: collection, rkey, verified: true })
    .sort({ createdAt: -1 })
    .lean<{ envelope: SignedRecordEnvelope } | null>();
  return row?.envelope ?? null;
}
