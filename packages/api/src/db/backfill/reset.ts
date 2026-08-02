/**
 * Emptying the target before a copy — the one destructive thing this tool does.
 *
 * ## Why it has to exist: idempotent is not convergent
 *
 * `bulkLoad.ts` inserts with `ON CONFLICT DO NOTHING`, and its header's claim is
 * true: a re-run never duplicates a row and never fails on a conflict, so a
 * crashed run is cheap to resume. But "safe to re-run" and "ends up matching the
 * source" are DIFFERENT properties, and only the first one follows. A row that
 * is already there is left exactly as an earlier run wrote it — so a copy over a
 * partially-populated target produces a database that is silently a MIXTURE of
 * two points in time.
 *
 * That is not theoretical. The production rehearsal completed all six levels and
 * then the verifier reported it:
 *
 * - all ELEVEN `reputation_rules` rows carried `updated_at 2026-08-01T13:33:35`,
 *   written by an EARLIER attempt, against the value the source holds now;
 * - `applications.last_used_at` / `updated_at` stored `19:13` from a previous
 *   run where the source said `23:54`.
 *
 * Nothing had gone wrong in the transform. The rows simply predated the run and
 * `DO NOTHING` will never refresh them. The cutover — freeze writes, copy,
 * verify, deploy — needs a target that holds THIS run's data and nothing else,
 * and that is the gap this closes.
 *
 * ## Why the fix is not an upsert
 *
 * Turning the insert path into `ON CONFLICT DO UPDATE` would converge, and it
 * would also make every resumed run rewrite every row it already got right —
 * turning a cheap resume into a full rewrite, and taking the write amplification
 * with it. `DO NOTHING` is what makes a crashed run recoverable. So the default
 * path is untouched and the convergence requirement is met the other way: start
 * from nothing, once, deliberately.
 *
 * ## What it will not do
 *
 * - It covers EXACTLY the tables the plans write ({@link planTables}), never
 *   "everything in the schema". The applied-migration ledger lives in the
 *   `drizzle` schema and is not one of them; {@link resetToEmpty} re-reads it
 *   afterwards and REFUSES if it moved, because a reset that took the ledger
 *   with it would make the next run re-apply every migration.
 * - It truncates WITHOUT `CASCADE`. If some table outside the list references
 *   one inside it, Postgres refuses and names it — which is the right answer,
 *   because cascading into a table nobody listed is exactly the silent
 *   over-reach this is trying not to be.
 * - It reports what it is about to destroy, with counts, BEFORE destroying it.
 */

import { sql } from 'drizzle-orm';
import type { Database } from '../../config/postgres';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from '../migrationLedger';
import { planTables, tableName, type CollectionPlan } from './plan';

/** The modes a reset may not be combined with, as the CLI parses them. */
export interface ResetRequest {
  readonly startFromEmpty: boolean;
  readonly auditOnly: boolean;
  readonly verifyOnly: boolean;
}

/** Raised when a destructive reset was asked for in a read-only mode. */
export class ResetNotAllowedError extends Error {
  constructor(mode: string) {
    super(
      `--start-from-empty cannot be combined with ${mode}: that mode inspects ` +
        'and writes nothing BY CONTRACT, and --start-from-empty DESTROYS every ' +
        'row in every table the plans write. The two are not a precedence ' +
        'question — run them separately, audit first.'
    );
    this.name = 'ResetNotAllowedError';
  }
}

/**
 * Refuse a reset asked for in a mode that touches nothing.
 *
 * Extracted from the CLI so it can be checked without running a script whose
 * module top level connects to two databases — and so the refusal is one
 * function rather than a condition someone later re-reads and "simplifies".
 *
 * @throws {ResetNotAllowedError} When combined with `--audit-only`/`--verify-only`.
 */
export function assertResetIsAllowed(request: ResetRequest): void {
  if (!request.startFromEmpty) return;
  if (request.auditOnly) throw new ResetNotAllowedError('--audit-only');
  if (request.verifyOnly) throw new ResetNotAllowedError('--verify-only');
}

/** One table of the target, and what it holds right now. */
export interface TableCensus {
  readonly table: string;
  readonly rows: number;
}

/** What a reset would destroy, measured before anything is destroyed. */
export interface ResetPlan {
  /** Every table the plans write, in name order, with its live row count. */
  readonly tables: readonly TableCensus[];
  /** Rows across all of them — the number the operator is authorising. */
  readonly totalRows: number;
  /**
   * Rows in the applied-migration ledger, which must SURVIVE.
   *
   * Read before and after, and compared: it is the one piece of state whose
   * loss would be invisible until the next run silently re-applied every
   * migration against a schema that already has them.
   */
  readonly ledgerRows: number;
}

/** Raised when a reset did not leave the target empty. */
export class ResetIncompleteError extends Error {
  constructor(readonly remaining: readonly TableCensus[]) {
    super(
      `The reset ran but ${remaining.length} table(s) still hold rows: ` +
        `${remaining.map((entry) => `${entry.table} (${entry.rows})`).join(', ')}. ` +
        'The copy is refused rather than started against a target that is still ' +
        'a mixture of two points in time, which is the state the reset exists to ' +
        'remove.'
    );
    this.name = 'ResetIncompleteError';
  }
}

/** Raised when a reset disturbed the applied-migration ledger. */
export class ResetLedgerError extends Error {
  constructor(before: number, after: number) {
    super(
      `The applied-migration ledger held ${before} row(s) before the reset and ` +
        `${after} after. It must survive untouched: it lives in the ` +
        `\`${MIGRATIONS_SCHEMA}\` schema precisely so a data reset cannot reach ` +
        'it, and losing it would make the next run re-apply every migration ' +
        'against a schema that already has them.'
    );
    this.name = 'ResetLedgerError';
  }
}

/**
 * Count what a reset would destroy, without destroying anything.
 *
 * Exact counts, not `reltuples` estimates: this number is what an operator
 * authorises a destructive action against, and an estimate in that sentence
 * would be worse than no number at all.
 */
export async function planReset(
  db: Database,
  plans: readonly CollectionPlan[]
): Promise<ResetPlan> {
  const names = resetTableNames(plans);
  const tables: TableCensus[] = [];
  for (const table of names) {
    tables.push({ table, rows: await countRows(db, table) });
  }
  return {
    tables,
    totalRows: tables.reduce((total, entry) => total + entry.rows, 0),
    ledgerRows: await countLedgerRows(db),
  };
}

/**
 * Empty every table the plans write, and prove it.
 *
 * @param plan The census {@link planReset} took — passed in rather than
 *   recomputed so the numbers reported to the operator are the numbers this
 *   acts on, not a second reading that could have moved between them.
 * @throws {ResetIncompleteError} When any table still holds rows afterwards.
 * @throws {ResetLedgerError} When the migration ledger changed.
 */
export async function resetToEmpty(
  db: Database,
  plans: readonly CollectionPlan[],
  plan: ResetPlan
): Promise<void> {
  const names = resetTableNames(plans);

  // ONE statement over the whole list, and deliberately no CASCADE. Postgres
  // requires every table referencing a truncated one to be in the same
  // statement, so a table outside this list that references one inside it is a
  // hard error naming itself — rather than a silent reach into data nobody
  // listed. `RESTART IDENTITY` is not used because no table here owns a
  // sequence: every primary key is a text id the application generates.
  await db.execute(
    sql.raw(`truncate table ${names.map((name) => `"${name}"`).join(', ')}`)
  );

  const remaining: TableCensus[] = [];
  for (const table of names) {
    const rows = await countRows(db, table);
    if (rows > 0) remaining.push({ table, rows });
  }
  if (remaining.length > 0) throw new ResetIncompleteError(remaining);

  const ledgerRows = await countLedgerRows(db);
  if (ledgerRows !== plan.ledgerRows) {
    throw new ResetLedgerError(plan.ledgerRows, ledgerRows);
  }
}

/**
 * The tables a reset covers: exactly what the plans write.
 *
 * Derived from {@link planTables} — the same declaration the verifier uses to
 * tell "empty because nothing fed it" from "empty because the copy produced
 * nothing" — so a table nobody copies is never emptied, and a table a new plan
 * writes is covered without anyone remembering to add it here.
 */
export function resetTableNames(plans: readonly CollectionPlan[]): string[] {
  const names = new Set<string>();
  for (const plan of plans) for (const table of planTables(plan)) names.add(tableName(table));
  return [...names].sort();
}

async function countRows(db: Database, table: string): Promise<number> {
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)}`
  );
  return row?.count ?? 0;
}

/** Rows in the applied-migration ledger, or 0 when it does not exist yet. */
async function countLedgerRows(db: Database): Promise<number> {
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`
  );
  return row?.count ?? 0;
}
