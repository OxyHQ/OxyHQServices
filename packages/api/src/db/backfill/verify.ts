/**
 * The verification pass.
 *
 * A verifier that cannot detect missing data is worse than none: it converts
 * "we did not check" into "we checked and it was fine". So this one is built to
 * FAIL, and its failure mode is a thrown error naming the collection, the
 * table and the discrepancy — never a summary someone skims and approves.
 *
 * `__tests__/roundTrip.test.ts` mutation-tests exactly that, three ways: it
 * makes the backfill skip a collection, deletes rows from a child table, and
 * corrupts one stored field — and asserts the verifier goes red AND names the
 * offender each time. A check that cannot distinguish success from failure is
 * the failure mode this whole file exists to avoid.
 *
 * ## Three independent checks, because they fail in three different ways
 *
 * 1. **Document count per primary table.** One Mongo document is one row. A
 *    mismatch means documents were dropped, double-counted, or refused. This
 *    catches a whole collection going missing, which the mutation test proves.
 * 2. **Element count per CHILD table.** A child table's expected row count is a
 *    number of ARRAY ELEMENTS, not of documents. This is the check that catches
 *    a decomposition emitting one row per document instead of one per element,
 *    which a count-of-documents check would pass — and the one that catches an
 *    `ord` collision silently swallowing rows via `ON CONFLICT DO NOTHING`.
 * 3. **Field fidelity, per collection.** Counts prove arity, not content: a
 *    transform that wrote `null` into every `subject` would pass both checks
 *    above. So a sample of real documents is re-read from BOTH stores and
 *    compared field by field, using the plan's own transform as the expectation
 *    — which means the comparison tests the COPY, not the transform's opinion
 *    of itself.
 *
 * ## What check 3 deliberately does not do
 *
 * It does not re-derive expected values independently of the transform. Doing
 * so would be a second implementation of the mapping, and a second
 * implementation drifts. What it CAN catch, and does, is every failure between
 * the transform and the stored row: a silently dropped column (drizzle's
 * unknown-key trap), a value mangled by the driver, a row that conflicted away,
 * a `jsonb` round-trip that lost something, a timestamp that shifted time zone.
 * Those are the failures that live in the gap this pass covers.
 */

import { count as countRows, getTableColumns, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../../config/postgres';
import type { MongoSource } from './mongoSource';
import { planTables, tableName, type CollectionPlan } from './plan';
import { loadParentKeys } from './parentKeys';
import {
  createResolutionContext,
  parentTablesForRules,
  planResolutions,
  ResolutionLog,
  transformDocument,
  type ParentKeys,
  type ResolutionContext,
} from './resolutions';
import type { MongoDocument } from './values';

/**
 * A column as `getTableColumns` returns it — taken from the package ROOT, the
 * same module `inArray` comes from. See the note on `idColumnOf` in
 * `runner.ts`: the `pg-core` subpath resolves a structurally incompatible
 * declaration of the same type under `moduleResolution: nodenext`.
 */
type TableColumn = ReturnType<typeof getTableColumns>[string];

/** How many documents per collection to compare field by field. */
export const DEFAULT_SAMPLE_SIZE = 25;

/** One thing that does not match. */
export interface VerificationFailure {
  readonly collection: string;
  readonly table: string;
  readonly kind: 'row-count' | 'child-row-count' | 'field-fidelity' | 'missing-row';
  readonly detail: string;
}

/** What the verifier observed, whether or not it passed. */
export interface VerificationReport {
  readonly checkedCollections: number;
  readonly checkedTables: number;
  readonly comparedDocuments: number;
  readonly comparedFields: number;
  readonly failures: readonly VerificationFailure[];
}

/** Raised when verification finds anything wrong. Names every discrepancy. */
export class VerificationError extends Error {
  constructor(readonly report: VerificationReport) {
    super(
      `Backfill verification FAILED with ${report.failures.length} discrepancy(ies).\n` +
        report.failures
          .map((failure) => `  [${failure.kind}] ${failure.collection} → ${failure.table}: ${failure.detail}`)
          .join('\n') +
        `\n\nChecked ${report.checkedCollections} collection(s), ${report.checkedTables} table(s), ` +
        `${report.comparedDocuments} sampled document(s), ${report.comparedFields} field comparison(s).`
    );
    this.name = 'VerificationError';
  }
}

/**
 * Raised when the verifier itself did no work.
 *
 * A vacuity floor. Without it, a traversal bug that visits zero collections
 * reports zero failures and passes — the exact "check that answers a narrower
 * question" shape. Zero comparisons is never a pass.
 */
export class VacuousVerificationError extends Error {
  constructor(report: VerificationReport) {
    super(
      'Backfill verification compared NOTHING and therefore proves nothing: ' +
        `${report.checkedCollections} collection(s), ${report.comparedDocuments} ` +
        `document(s), ${report.comparedFields} field(s). A verifier that runs and ` +
        'checks zero things is worse than no verifier, because it reports success.'
    );
    this.name = 'VacuousVerificationError';
  }
}

/** Rows currently in a table. */
async function tableRowCount(db: Database, table: PgTable): Promise<number> {
  const [row] = await db.select({ value: countRows() }).from(table);
  return row?.value ?? 0;
}

/**
 * Expected rows for each of a plan's tables, computed from the SOURCE.
 *
 * The primary table expects one row per document. Each child table expects the
 * number of rows the plan's own transform emits for it — counted by running the
 * transform over the whole collection, which is affordable because the
 * transform is pure and in-memory and the rows are discarded immediately.
 *
 * Counting via the transform rather than via a hand-written `$size` sum is
 * deliberate: several child tables are NOT a single array (`message_recipients`
 * is three arrays into one table; `reputation_reviewing_reliability` is two
 * maps), so a `$size` expression would be a second, divergent description of
 * the decomposition. The transform is the one description there is.
 */
export async function expectedRowCounts(
  source: MongoSource,
  plan: CollectionPlan,
  batchSize: number,
  resolutions: ResolutionContext,
  parents: ParentKeys
): Promise<Record<string, number>> {
  const expected: Record<string, number> = {};
  for (const table of planTables(plan)) expected[tableName(table)] = 0;

  const cursor = source.collection(plan.collection).find({}, { batchSize });
  for await (const doc of cursor) {
    transformDocument(plan, doc as MongoDocument, resolutions, parents, (emitted) => {
      // A row a documented rule removes is not expected in Postgres, and this
      // check would otherwise read its absence as the copy losing it. The
      // removal is reported by id under its own rule, and the referential audit
      // refused the run unless it was provably answerable.
      if (emitted.written === null) return;
      const name = tableName(emitted.table);
      expected[name] = (expected[name] ?? 0) + 1;
    });
  }
  return expected;
}

/** A sample of documents, taken deterministically so a rerun compares the same rows. */
async function sampleDocuments(
  source: MongoSource,
  collection: string,
  size: number
): Promise<MongoDocument[]> {
  const docs = await source.collection(collection).find({}, { sort: { _id: 1 }, limit: size }).toArray();
  return docs as MongoDocument[];
}

/** The `id` column of a table, or null when it is keyed some other way. */
function idColumn(table: PgTable): TableColumn | null {
  return getTableColumns(table).id ?? null;
}

/**
 * Compare one expected row against what is actually stored.
 *
 * Values are compared after normalization, because the round trip legitimately
 * changes REPRESENTATION without changing meaning: `bigint` columns come back
 * as strings from postgres.js, `numeric` as strings, `timestamptz` as `Date`,
 * and `jsonb` reorders keys. Normalizing both sides the same way is what makes
 * the comparison test the DATA rather than the driver.
 */
function valuesAgree(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected instanceof Date) {
    return actual instanceof Date && expected.getTime() === actual.getTime();
  }
  if (Buffer.isBuffer(expected)) {
    return Buffer.isBuffer(actual) && expected.equals(actual);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    return expected.every((entry, index) => valuesAgree(entry, actual[index]));
  }
  if (typeof expected === 'number') {
    // `bigint` and `numeric` arrive as strings; `double precision` as a number.
    if (typeof actual === 'number') return Object.is(expected, actual);
    if (typeof actual === 'string') return Number(actual) === expected;
    return false;
  }
  if (typeof expected === 'object') {
    // jsonb: compare structurally, key order is not part of the value.
    return canonicalJson(expected) === canonicalJson(actual);
  }
  if (typeof expected === 'string' && typeof actual === 'string') return expected === actual;
  return Object.is(expected, actual);
}

/** Structural JSON with sorted keys at every level. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/**
 * Verify one collection: row counts for every table it feeds, plus a field-by-
 * field comparison of a sample of its primary rows.
 */
export async function verifyCollection(
  db: Database,
  source: MongoSource,
  plan: CollectionPlan,
  options: {
    sampleSize: number;
    batchSize: number;
    resolutions: ResolutionContext;
    parents: ParentKeys;
  }
): Promise<{ failures: VerificationFailure[]; comparedDocuments: number; comparedFields: number }> {
  const failures: VerificationFailure[] = [];
  const expected = await expectedRowCounts(
    source,
    plan,
    options.batchSize,
    options.resolutions,
    options.parents
  );

  for (const table of planTables(plan)) {
    const name = tableName(table);
    const actual = await tableRowCount(db, table);
    const want = expected[name] ?? 0;
    if (actual === want) continue;
    const isChild = name !== tableName(plan.table);
    failures.push({
      collection: plan.collection,
      table: name,
      kind: isChild ? 'child-row-count' : 'row-count',
      detail:
        `expected ${want} row(s) from ${plan.collection}, found ${actual}. ` +
        (actual < want
          ? `${want - actual} row(s) did not arrive — they were dropped, refused, or ` +
            'conflicted away by ON CONFLICT DO NOTHING.'
          : `${actual - want} extra row(s) are present — the copy ran twice ` +
            'non-idempotently, or another source writes this table.'),
    });
  }

  // Field fidelity on the primary table only: the child tables' contents are
  // covered by their element COUNTS plus the constraints (`ord` uniqueness, the
  // FKs, the CHECKs), and a per-child sample would need a key to match rows on
  // that several of them deliberately do not have.
  const idCol = idColumn(plan.table);
  let comparedDocuments = 0;
  let comparedFields = 0;

  if (idCol !== null) {
    const documents = await sampleDocuments(source, plan.collection, options.sampleSize);
    const expectedRows = new Map<string, Record<string, unknown>>();
    for (const doc of documents) {
      transformDocument(plan, doc, options.resolutions, options.parents, (emitted) => {
        if (tableName(emitted.table) !== tableName(plan.table)) return;
        if (emitted.written === null) return;
        const rowId = emitted.written.id;
        if (typeof rowId === 'string') expectedRows.set(rowId, emitted.written);
      });
    }

    if (expectedRows.size > 0) {
      const stored = await db
        .select()
        .from(plan.table)
        .where(inArray(idCol, [...expectedRows.keys()]));
      const storedById = new Map<string, Record<string, unknown>>();
      for (const row of stored) {
        const record = row as Record<string, unknown>;
        const rowId = record.id;
        if (typeof rowId === 'string') storedById.set(rowId, record);
      }

      for (const [rowId, want] of expectedRows) {
        const actual = storedById.get(rowId);
        if (!actual) {
          failures.push({
            collection: plan.collection,
            table: tableName(plan.table),
            kind: 'missing-row',
            detail: `document _id ${rowId} produced no row at all`,
          });
          continue;
        }
        comparedDocuments += 1;
        for (const [column, wantValue] of Object.entries(want)) {
          comparedFields += 1;
          if (valuesAgree(wantValue, actual[column])) continue;
          failures.push({
            collection: plan.collection,
            table: tableName(plan.table),
            kind: 'field-fidelity',
            detail:
              `row ${rowId}, column ${column}: expected ` +
              `${JSON.stringify(wantValue)} but stored ${JSON.stringify(actual[column])}`,
          });
        }
      }
    }
  }

  return { failures, comparedDocuments, comparedFields };
}

/**
 * Verify every collection the run was supposed to copy.
 *
 * @throws {VerificationError} On any discrepancy.
 * @throws {VacuousVerificationError} When nothing was compared at all.
 */
export async function verifyBackfill(
  db: Database,
  source: MongoSource,
  plans: readonly CollectionPlan[],
  options: { sampleSize?: number; batchSize?: number } = {}
): Promise<VerificationReport> {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const batchSize = options.batchSize ?? 500;

  // The expectation is the transform's own output, so the verifier has to run
  // it under the SAME documented resolutions the copy did — otherwise every
  // demoted validation request reads as a `field-fidelity` failure on `status`.
  //
  // Recomputed here rather than passed in, and that is sound precisely because
  // nothing ever writes to MongoDB: the pre-pass is a pure function of source
  // documents that cannot have moved, so it cannot disagree with the copy's.
  // Making it an option would create a way to verify against decisions the
  // copy never made.
  const resolutions = createResolutionContext(await planResolutions(source), new ResolutionLog());
  // The SAME set the copy decided against — read from the database being
  // verified, after it was written. Recomputing the expectation from a Mongo
  // snapshot would compare the copy against a different decision than the one
  // it made, and report every correctly-removed row as a missing one.
  const parents = await loadParentKeys(db, parentTablesForRules());

  const failures: VerificationFailure[] = [];
  let checkedTables = 0;
  let comparedDocuments = 0;
  let comparedFields = 0;

  for (const plan of plans) {
    const result = await verifyCollection(db, source, plan, {
      sampleSize,
      batchSize,
      resolutions,
      parents,
    });
    failures.push(...result.failures);
    checkedTables += planTables(plan).length;
    comparedDocuments += result.comparedDocuments;
    comparedFields += result.comparedFields;
  }

  const report: VerificationReport = {
    checkedCollections: plans.length,
    checkedTables,
    comparedDocuments,
    comparedFields,
    failures,
  };

  // The vacuity floor comes FIRST: a run that compared nothing has not earned
  // the right to report "no failures".
  if (plans.length === 0 || checkedTables === 0) throw new VacuousVerificationError(report);
  if (failures.length > 0) throw new VerificationError(report);
  return report;
}
