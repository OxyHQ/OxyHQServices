/**
 * Oxy RecordStore — the @oxyhq/protocol {@link RecordStore} implementation over
 * Oxy's `signed_records` + `repo_heads` tables.
 *
 * This is the storage HALF of the chain adapter: the protocol engine
 * (`@oxyhq/protocol`'s `verifyAndAppend`) owns verification + continuity policy
 * and delegates every read/write here. Everything Oxy- and Postgres-specific
 * that does NOT belong in the app-agnostic engine lives in this file:
 *
 *  - the ATOMIC append + head advance (one real transaction — see below),
 *  - the unique `{user_id, seq}` index backstop translated to `chain_conflict`
 *    on a `unique_violation`,
 *  - the v1 `{type}` vs v2 `{nsid, rkey}` monotonicity split, and
 *  - the `nsid` denormalization of the envelope's `collection` field.
 *
 * ## The session-less fallback is DELETED, not translated
 *
 * The Mongo version string-matched "no replica set" on the transaction error and
 * silently RE-RAN the append and the head advance without a session. That made
 * the pair non-atomic on any deployment without a replica set, which is exactly
 * the failure the pair exists to prevent: a head pointing at a record that was
 * never stored makes every later `prev` check fail, and a head left behind lets
 * a second device re-use a `seq` that is already taken. Postgres has real
 * transactions everywhere, so there is nothing to fall back FROM — `repoHeads.ts`
 * records the same decision on the schema side.
 *
 * ## `{user_id, seq}` is the multi-device write-race backstop
 *
 * Two devices that sign at the same `seq` both try to insert; the loser gets a
 * `unique_violation`, which this store answers as `chain_conflict` so the caller
 * re-reads the head and re-signs. That shape is preserved verbatim — it is the
 * only thing standing between a concurrent write and a forked chain.
 *
 * The store is **subject-keyed by the subject DID** (the protocol's notion of a
 * subject). Oxy's primary key is the account `userId`, so each method parses the
 * DID back to its `userId` via {@link parseUserDid}. (Oxy has no per-record blob
 * storage — identity/civic/node records carry no blobs — so no `BlobStore` is
 * implemented here.)
 */

import { and, asc, desc, eq, gt, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { oxySignedRecordTypeSchema, type SignedRecordEnvelope } from '@oxyhq/contracts';
import type { AppendOutcome, ChainHead, RecordStore } from '@oxyhq/protocol';
import { getDb } from '../config/postgres';
import { isUniqueViolation } from '../db/pgErrors';
import { repoHeads } from '../db/schema/repoHeads';
import { signedRecords } from '../db/schema/signedRecords';
import { buildUserDid, parseUserDid } from './did.service';

/** Default page size for the log read helpers. */
export const DEFAULT_LOG_LIMIT = 100;
/** Hard ceiling so a single log call can never scan an unbounded slice. */
const MAX_LOG_LIMIT = 500;

function clampLogLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit) || DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT));
}

/**
 * The Oxy implementation of the protocol {@link RecordStore}, backed by the
 * `signed_records` ledger + `repo_heads` head pointer.
 */
class OxyRecordStoreImpl implements RecordStore {
  async getHead(subject: string): Promise<ChainHead | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const [head] = await getDb()
      .select({
        headRecordId: repoHeads.headRecordId,
        seq: repoHeads.seq,
        recordCount: repoHeads.recordCount,
      })
      .from(repoHeads)
      .where(eq(repoHeads.userId, userId))
      .limit(1);
    if (!head) {
      return null;
    }
    return { headRecordId: head.headRecordId, seq: head.seq, recordCount: head.recordCount };
  }

  /**
   * Persist a verified envelope and (for v2) advance the per-subject hash chain.
   *
   * v1: a single append, NO chain fields and NO head advance — which is why a
   * v1 row's content address is NOT stored (`signed_records_chain_completeness_check`
   * forbids it) and why nothing may use one as a foreign key. `oxyStorePolicy`
   * in `signedRecord.service.ts` is what keeps every projected record type off
   * that path; see its `chain_required` branch.
   *
   * v2: the append AND the head advance happen in ONE transaction. A
   * `unique_violation` from `{user_id, seq}` or from `record_id` — a concurrent
   * write that already took this `seq` — is surfaced as `chain_conflict` so the
   * caller re-reads the head and retries.
   */
  async append(subject: string, env: SignedRecordEnvelope, recordId: string): Promise<AppendOutcome> {
    const userId = parseUserDid(subject);
    if (!userId) {
      // The subject DID does not belong to this issuer's domain — there is no
      // Oxy chain to write. Treated as a continuity conflict (no valid head).
      return { ok: false, reason: 'chain_gap' };
    }

    // The envelope `type` is an OPEN string on the shared protocol grammar; the
    // `signed_records.type` column is the closed Oxy set with a matching CHECK.
    // `oxyStorePolicy` already refused anything outside it, so this re-narrowing
    // is what carries that guarantee into the INSERT rather than a cast — and it
    // keeps the store correct if it is ever driven by another caller.
    const oxyType = oxySignedRecordTypeSchema.safeParse(env.type);
    if (!oxyType.success) {
      return { ok: false, reason: 'invalid_envelope' };
    }
    const type = oxyType.data;

    if (env.version === 2) {
      // Narrowed here rather than asserted: the engine rejects a v2 envelope
      // missing any chain field as `invalid_envelope` upstream, and the CHECK
      // constraint refuses a half-chained row, so a missing one at this point is
      // a continuity failure rather than a row to write.
      const seq = env.seq;
      const nsid = env.collection;
      const rkey = env.rkey;
      if (typeof seq !== 'number' || typeof nsid !== 'string' || typeof rkey !== 'string') {
        return { ok: false, reason: 'chain_gap' };
      }

      try {
        await getDb().transaction(async (tx) => {
          await tx.insert(signedRecords).values({
            subjectDid: env.subject,
            userId,
            type,
            envelope: env,
            publicKey: env.publicKey,
            verified: true,
            seq,
            prev: env.prev ?? null,
            recordId,
            // Denormalize the envelope's `collection` to the `nsid` column.
            nsid,
            rkey,
          });

          await tx
            .insert(repoHeads)
            .values({
              userId,
              subjectDid: env.subject,
              seq,
              headRecordId: recordId,
              recordCount: 1,
            })
            .onConflictDoUpdate({
              target: repoHeads.userId,
              set: {
                subjectDid: env.subject,
                seq,
                headRecordId: recordId,
                recordCount: sql`${repoHeads.recordCount} + 1`,
                updatedAt: new Date(),
              },
            });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, reason: 'chain_conflict' };
        }
        throw error;
      }

      return { ok: true, recordId, seq };
    }

    // v1: an unchained singleton append. No chain fields, no head advance — so
    // no `record_id` either, and the returned address names no stored row.
    await getDb().insert(signedRecords).values({
      subjectDid: env.subject,
      userId,
      type,
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
    const rows = await getDb()
      .select({ envelope: signedRecords.envelope })
      .from(signedRecords)
      .where(and(eq(signedRecords.userId, userId), gt(signedRecords.seq, sinceSeq)))
      .orderBy(asc(signedRecords.seq))
      .limit(clampLogLimit(limit));
    return rows.map((row) => row.envelope);
  }

  async resolveCursorSeq(subject: string, recordId: string): Promise<number | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const [row] = await getDb()
      .select({ seq: signedRecords.seq })
      .from(signedRecords)
      .where(and(eq(signedRecords.userId, userId), eq(signedRecords.recordId, recordId)))
      .limit(1);
    return row?.seq ?? null;
  }

  async materializeCurrent(subject: string, collection: string, rkey: string): Promise<SignedRecordEnvelope | null> {
    const userId = parseUserDid(subject);
    if (!userId) {
      return null;
    }
    const [row] = await getDb()
      .select({ envelope: signedRecords.envelope })
      .from(signedRecords)
      .where(
        and(
          eq(signedRecords.userId, userId),
          eq(signedRecords.nsid, collection),
          eq(signedRecords.rkey, rkey),
          eq(signedRecords.verified, true),
        ),
      )
      .orderBy(desc(signedRecords.createdAt))
      .limit(1);
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
    // A v2 envelope missing its required `collection`/`rkey` would collapse the
    // filter below to a global-latest comparison across ALL keys — a false
    // replay/rollback rejection of valid appends on OTHER keys. Mirror the
    // NodeStore guard and treat it as "no prior record for this key". (The
    // engine rejects such an envelope as `invalid_envelope` upstream anyway.)
    let filter: SQL | undefined;
    if (env.version === 2) {
      const { collection, rkey } = env;
      if (typeof collection !== 'string' || typeof rkey !== 'string') {
        return null;
      }
      filter = and(
        eq(signedRecords.userId, userId),
        eq(signedRecords.nsid, collection),
        eq(signedRecords.rkey, rkey),
      );
    } else {
      // The same open-`type` narrowing `append` applies: a type outside the Oxy
      // set can hold no stored record, so there is no prior issuedAt for it.
      const oxyType = oxySignedRecordTypeSchema.safeParse(env.type);
      if (!oxyType.success) {
        return null;
      }
      filter = and(eq(signedRecords.userId, userId), eq(signedRecords.type, oxyType.data));
    }
    const [latest] = await getDb()
      .select({ envelope: signedRecords.envelope })
      .from(signedRecords)
      .where(filter)
      .orderBy(desc(signedRecords.createdAt))
      .limit(1);
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
    if (collections.length === 0) {
      return [];
    }
    const rows = await getDb()
      .select({ envelope: signedRecords.envelope })
      .from(signedRecords)
      .where(
        and(
          eq(signedRecords.userId, userId),
          gt(signedRecords.seq, sinceSeq),
          eq(signedRecords.verified, true),
          inArray(signedRecords.nsid, [...collections]),
        ),
      )
      .orderBy(asc(signedRecords.seq))
      .limit(clampLogLimit(limit));
    return rows.map((row) => row.envelope);
  }

  /** Latest stored record of `type` for a user (v1 singleton read), or null. */
  async latestRecordOfType(
    userId: string,
    type: 'identity' | 'profile',
  ): Promise<{ envelope: SignedRecordEnvelope } | null> {
    const [row] = await getDb()
      .select({ envelope: signedRecords.envelope })
      .from(signedRecords)
      .where(and(eq(signedRecords.userId, userId), eq(signedRecords.type, type)))
      .orderBy(desc(signedRecords.createdAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * The stored envelope for a content address, or `null`.
   *
   * Used by credential verification, which ALWAYS recomputes the canonical
   * signing input from the stored envelope rather than trusting a projection.
   * `record_id` is unique, so this is a single-row lookup.
   */
  async envelopeByRecordId(recordId: string): Promise<SignedRecordEnvelope | null> {
    const [row] = await getDb()
      .select({ envelope: signedRecords.envelope })
      .from(signedRecords)
      .where(eq(signedRecords.recordId, recordId))
      .limit(1);
    return row?.envelope ?? null;
  }

  /**
   * Whether a content address names a STORED record.
   *
   * The one read that distinguishes "the engine computed this address" from
   * "the ledger holds a row under it" — a v1 append returns an address it never
   * persists. Every projection that carries `record_id` as a foreign key relies
   * on the distinction; see `signedRecord.service.ts`'s `chain_required` policy.
   */
  async hasRecordId(recordId: string): Promise<boolean> {
    const [row] = await getDb()
      .select({ recordId: signedRecords.recordId })
      .from(signedRecords)
      .where(and(eq(signedRecords.recordId, recordId), isNotNull(signedRecords.recordId)))
      .limit(1);
    return row !== undefined;
  }
}

/** The singleton Oxy record store the chain adapter + repo-log glue drive. */
export const oxyRecordStore = new OxyRecordStoreImpl();

/** Build the subject DID for an Oxy `userId` (the store's subject key). */
export function subjectKeyForUser(userId: string): string {
  return buildUserDid(userId);
}
