/**
 * Expiry Sweep — the replacement for Mongo TTL indexes
 *
 * Postgres has no TTL index. Fourteen models relied on one, so the mechanism is
 * defined ONCE here and every table that needs it adds a registry entry rather
 * than growing its own cleanup path.
 *
 * ## The shape
 *
 * A Mongo TTL index is `{ <field>: 1 }, { expireAfterSeconds: N }` — delete a
 * document once `<field>` is more than N seconds in the past. A registry entry
 * is exactly that pair, so no semantic can be lost in translation:
 *
 *   { table, column, retentionSeconds }  →  delete where column <= now() - N
 *
 * All three uses in the Mongo schema collapse into it:
 *
 *   - `expireAfterSeconds: 0` on `expiresAt` — the column IS the deadline
 *     (`retentionSeconds: 0`).
 *   - `expireAfterSeconds: N` on `createdAt`/`timestamp` — a retention window
 *     on a birth column.
 *   - `expireAfterSeconds: N` on `expiresAt` — a deliberate GRACE window: the
 *     row outlives its own deadline by N seconds so a read can still answer
 *     "expired" rather than "never existed". Same entry, different column.
 *
 * ## Coexistence with read paths — the part that must not be lost
 *
 * Mongo's TTL monitor runs about once a minute, so an expired document stays
 * readable for up to ~60s. A sweep has the same property. Two classes of read
 * path exist today and they are NOT interchangeable:
 *
 *   (A) Reads that filter on expiry themselves — `expiresAt: { $gt: new Date() }`
 *       in `session.controller.ts:297`, `authSession.service.ts:280`,
 *       `authLinking.ts:303`. For these the sweep is pure housekeeping;
 *       correctness never depends on it. **Port every one of those filters
 *       verbatim.** Dropping one because "the sweep handles it" turns a bounded
 *       lag into a live credential.
 *
 *   (B) Reads that do NOT filter and rely on the row already being gone —
 *       `senderAvatar.service.ts:179` and `:208` return the cached row with no
 *       expiry predicate and no application-side check. For those the sweep is
 *       a CORRECTNESS mechanism, not housekeeping, and the interval is how
 *       stale a served value can be. The right fix on port is to add the
 *       read-side filter and move them into class (A) — then the sweep is
 *       housekeeping everywhere and no table's correctness depends on a job
 *       running.
 *
 * ## Scheduling
 *
 * `sweepExpiredRows` is the mechanism; wiring it to a schedule belongs with the
 * call-site port, alongside the BullMQ repeatable jobs already in `src/queue/`
 * (env-gated on `REDIS_URL`, inline fallback when absent). Until then it is
 * callable and tested, and nothing reads a swept table yet.
 */

import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../config/postgres';
import { AFFINITY_EVENT_SEEN_TTL_SECONDS } from '../utils/recommendationWeights';
import { appAffinitySeenEvents } from './schema/appAffinitySeenEvents';
import { authChallenges } from './schema/authChallenges';

/**
 * Rows deleted per statement. Bounded so a large backlog cannot hold one long
 * transaction open — Mongo's TTL monitor deleted incrementally for the same
 * reason.
 */
const DEFAULT_BATCH_SIZE = 1000;

/**
 * Ceiling on batches per table per call, so one enormous table cannot starve
 * the others in the registry. The remainder is picked up on the next run.
 */
const DEFAULT_MAX_BATCHES = 50;

/** One table's expiry rule — the direct analogue of a Mongo TTL index. */
export interface ExpirySweepTarget {
  readonly table: PgTable;
  /** The date column the retention is measured from. Must be indexed. */
  readonly column: PgColumn;
  /** Seconds a row may survive past `column` before it is deleted. */
  readonly retentionSeconds: number;
  /** What the retention protects, in one line. */
  readonly reason: string;
}

/**
 * Every table that had a Mongo TTL index. A table with an expiry column but no
 * entry here is never swept.
 */
export const EXPIRY_SWEEP_TARGETS: readonly ExpirySweepTarget[] = [
  {
    table: authChallenges,
    column: authChallenges.expiresAt,
    retentionSeconds: 0,
    reason:
      'Housekeeping only — every read already filters `expires_at > now()`, ' +
      'so a challenge is unspendable the instant it expires.',
  },
  {
    table: appAffinitySeenEvents,
    column: appAffinitySeenEvents.createdAt,
    retentionSeconds: AFFINITY_EVENT_SEEN_TTL_SECONDS,
    reason:
      'Bounds the idempotency ledger. Deleting a marker reopens the dedup ' +
      'window for an event nobody is still retrying.',
  },
];

/** Outcome of one sweep, for the caller to log or assert on. */
export interface ExpirySweepResult {
  readonly table: string;
  readonly deleted: number;
  /** True when the batch ceiling was hit and rows remain for the next run. */
  readonly truncated: boolean;
}

export interface ExpirySweepOptions {
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

/**
 * `column <= now() - retentionSeconds`.
 *
 * The column is interpolated as a drizzle Column, not as
 * `sql.identifier(column.name)`: `column.name` is the TypeScript property name
 * (`expiresAt`), and only drizzle's own renderer applies the configured casing
 * to reach `expires_at` — see `db/casing.ts`.
 */
function expiredPredicate(target: ExpirySweepTarget): SQL {
  return sql`${target.column} <= now() - make_interval(secs => ${target.retentionSeconds})`;
}

/**
 * Delete every expired row from one target, in bounded batches.
 *
 * Batching goes through `ctid` (Postgres's physical row address) because
 * `DELETE ... LIMIT` is not valid SQL: the inner select takes the limit, the
 * outer delete removes exactly those rows.
 */
export async function sweepExpiredRows(
  db: Database,
  target: ExpirySweepTarget,
  options: ExpirySweepOptions = {}
): Promise<ExpirySweepResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const table = sql.identifier(getTableName(target.table));
  const expired = expiredPredicate(target);

  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await db.execute<{ ctid: string }>(sql`
      delete from ${table}
      where ctid in (
        select ctid from ${table} where ${expired} limit ${batchSize}
      )
      returning ctid
    `);

    deleted += rows.length;
    if (rows.length < batchSize) {
      return { table: getTableName(target.table), deleted, truncated: false };
    }
  }

  return { table: getTableName(target.table), deleted, truncated: true };
}

/**
 * Sweep every registered target. Runs them in sequence rather than in parallel:
 * this is background maintenance and should not contend with request traffic
 * for the connection pool.
 */
export async function sweepAllExpiredRows(
  db: Database,
  options: ExpirySweepOptions = {}
): Promise<ExpirySweepResult[]> {
  const results: ExpirySweepResult[] = [];
  for (const target of EXPIRY_SWEEP_TARGETS) {
    results.push(await sweepExpiredRows(db, target, options));
  }
  return results;
}
