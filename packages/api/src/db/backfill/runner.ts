/**
 * The copy itself: Mongo → Postgres, batched, resumable, idempotent.
 *
 * ## Idempotence is structural, not bookkept
 *
 * Every insert is `ON CONFLICT DO NOTHING` with no conflict target, which
 * covers the primary key AND every unique constraint on the table. Because ids
 * are copied VERBATIM (`MIGRATION-CONTRACT.md`), a row that is already there
 * conflicts on its own id and is skipped. Re-running the whole backfill from
 * zero is therefore always safe — it is merely slower than resuming.
 *
 * That property is what makes the checkpoint an OPTIMISATION rather than a
 * correctness mechanism, which is the right way round: a checkpoint file can be
 * lost (a one-shot Fargate task has no durable local disk), and losing it must
 * cost time, never integrity.
 *
 * ## Batching
 *
 * `296,924 files in one transaction is not a plan`. Each batch is its own
 * transaction: bounded WAL, bounded lock duration, bounded memory, and a
 * failure loses at most one batch of work. The batch size is a knob because the
 * right value differs between `files` (15 narrow columns) and `messages` (42,
 * two of them full message bodies).
 *
 * ## Self-references are deferred, per collection
 *
 * Seven tables reference themselves and Postgres checks those keys immediately.
 * `users.parent_account_id` guarantees the problem is real rather than
 * theoretical: a sub-account created before its parent organisation sorts
 * earlier by `_id`. So pass A inserts every self-referencing column as NULL,
 * and pass B re-streams the SAME collection and fills them in once every row of
 * that table exists. Pass B is a second read rather than an in-memory buffer so
 * a collection with many self-references cannot blow the task's memory —
 * exactly the reason pass A is batched in the first place.
 */

import { eq, getTableColumns, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { getPostgresClient, type Database } from '../../config/postgres';
import { FILE_SYSTEM_OWNERS } from '../schema';
import {
  auditEnums,
  auditFileSystemOwners,
  auditUniqueness,
  auditWouldBlockCopy,
  type AuditFinding,
} from './audit';
import { analyzeTables, copyRowsInto } from './bulkLoad';
import { classifyCollection, COLLECTION_PLANS, NOT_MIGRATED } from './collectionMap';
import {
  checkpointOf,
  streamCollection,
  type Checkpoint,
  type MongoSource,
} from './mongoSource';
import { planLevels, selfReferencingColumns } from './order';
import { planTables, tableName, type CollectionPlan } from './plan';
import {
  auditReferentialIntegrity,
  referentialIntegrityNotRun,
  type ReferentialIntegrityReport,
} from './referentialIntegrity';
import {
  createResolutionContext,
  planResolutions,
  ResolutionLog,
  type ResolutionContext,
  type ResolutionPlan,
  type ResolutionSummary,
} from './resolutions';
import type { MongoDocument } from './values';

/** How many documents to transform and load per COPY batch. */
export const DEFAULT_BATCH_SIZE = 5000;

/**
 * How many collections of one FK level to copy concurrently.
 *
 * Below the default Postgres pool of 20 with room for the verifier and the
 * deferred-reference pass to hold connections at the same time.
 */
export const DEFAULT_CONCURRENCY = 8;

/** Where a run left off, per collection. Persisted between runs. */
export interface BackfillState {
  /** Collection name → the last `_id` committed. */
  readonly checkpoints: Record<string, Checkpoint>;
  /** Collections whose copy AND self-reference pass both finished. */
  readonly completed: readonly string[];
}

/** An empty state — what a first run starts from. */
export function emptyState(): BackfillState {
  return { checkpoints: {}, completed: [] };
}

/** What the discovery phase found. */
export interface Discovery {
  /** Live collections with a plan, and how many documents each holds. */
  readonly migrated: ReadonlyArray<{ plan: CollectionPlan; documents: number }>;
  /** Live collections deliberately excluded, with their document counts. */
  readonly excluded: ReadonlyArray<{ collection: string; reason: string; documents: number }>;
  /** Live collections in NEITHER list. Any entry here is a hard failure. */
  readonly unknown: readonly string[];
  /** Mapped collections that do not exist in the source at all. */
  readonly absent: readonly string[];
}

/** Raised when the source holds a collection the map has never heard of. */
export class UnknownCollectionError extends Error {
  constructor(readonly collections: readonly string[]) {
    super(
      `MongoDB holds ${collections.length} collection(s) that are neither mapped ` +
        `nor explicitly excluded: ${collections.join(', ')}. Every collection must ` +
        'be one or the other — add a plan in db/backfill/plans/, or an entry in ' +
        'NOT_MIGRATED with the reason its data does not move. An unexplained ' +
        'collection is how data goes missing quietly.'
    );
    this.name = 'UnknownCollectionError';
  }
}

/** Raised when an audit found rows the schema would refuse. */
export class AuditBlockedError extends Error {
  constructor(readonly findings: readonly AuditFinding[]) {
    super(
      `${findings.length} audit finding(s) describe production rows the Postgres ` +
        'schema would REJECT. The copy is refused rather than started and aborted ' +
        'partway. Fix the data or widen the schema — both are decisions, which is ' +
        'why there is no override flag.\n\n' +
        findings
          .map(
            (finding) =>
              `  [${finding.kind}] ${finding.detail}\n` +
              `      ${finding.documents} document(s); e.g. ${finding.sampleIds.join(', ') || '(none sampled)'}`
          )
          .join('\n')
    );
    this.name = 'AuditBlockedError';
  }
}

/**
 * Compare the live collection list against the map.
 *
 * The `unknown` bucket is the point of this phase. `db.listCollections()` is
 * the authority because Mongoose derived most collection names by pluralising a
 * model name rather than declaring them, and because several live collections
 * belong to models that no longer exist — neither is derivable from the code as
 * it stands today.
 */
export async function discover(source: MongoSource): Promise<Discovery> {
  const live = await source.listCollections();
  const migrated: Array<{ plan: CollectionPlan; documents: number }> = [];
  const excluded: Array<{ collection: string; reason: string; documents: number }> = [];
  const unknown: string[] = [];

  for (const collection of live) {
    // Mongo's own bookkeeping namespaces are not application data and are not a
    // migration decision. `system.*` is reserved by the server.
    if (collection.startsWith('system.')) continue;
    const classification = classifyCollection(collection);
    if (classification.kind === 'migrated') {
      migrated.push({ plan: classification.plan, documents: await source.count(collection) });
    } else if (classification.kind === 'excluded') {
      excluded.push({
        collection,
        reason: classification.exclusion.reason,
        documents: await source.count(collection),
      });
    } else {
      unknown.push(collection);
    }
  }

  const liveSet = new Set(live);
  const absent = [
    ...COLLECTION_PLANS.map((plan) => plan.collection),
    ...NOT_MIGRATED.map((entry) => entry.collection),
  ]
    .filter((name) => !liveSet.has(name))
    .sort();

  return { migrated, excluded, unknown, absent };
}

/**
 * Run every audit for every mapped, non-empty collection.
 *
 * `resolutions` is what lets a finding report as ANSWERED rather than blocking.
 * It is a required parameter rather than something this function computes, so
 * the audit phase and the copy phase provably share ONE set of decisions — the
 * `--audit-only` report would otherwise be able to disagree with what the copy
 * then does.
 *
 * The referential-integrity audit runs LAST and once, over everything. It is
 * also the expensive one: it streams every mapped collection and runs its
 * transform, so this phase now costs roughly the read half of a copy rather
 * than a handful of index-assisted aggregations. That is deliberate — the run
 * it exists to prevent got three levels in before a `23503` stopped it.
 */
export async function runAudits(
  source: MongoSource,
  discovery: Discovery,
  resolutions: ResolutionContext,
  options: { readonly batchSize?: number } = {}
): Promise<{
  findings: AuditFinding[];
  fileOwnerCensus: Record<string, number>;
  referentialIntegrity: ReferentialIntegrityReport;
}> {
  const findings: AuditFinding[] = [];
  let fileOwnerCensus: Record<string, number> = {};

  for (const { plan, documents } of discovery.migrated) {
    // An empty collection has nothing to audit and `distinct` on one returns
    // `[]`, so skipping is not a shortcut that could hide anything.
    if (documents === 0) continue;
    findings.push(...(await auditEnums(source, plan)));
    findings.push(...(await auditUniqueness(source, plan, resolutions)));
    if (plan.collection === 'files') {
      const owners = await auditFileSystemOwners(source, plan.collection, FILE_SYSTEM_OWNERS);
      findings.push(...owners.findings);
      fileOwnerCensus = owners.census;
    }
  }

  // ONE pass over EVERY mapped collection, empty ones included, and outside the
  // loop above on purpose: a foreign key is a relation between two collections,
  // so it cannot be answered one collection at a time. The complete set is
  // required — a referenced table fed by a plan that is not here holds no rows,
  // and healthy references to it would then read as orphans.
  //
  // LAST, and only when nothing else blocks: this pass runs the plans' own
  // transforms, and a transform THROWS on a document the schema refuses. Running
  // it over data an earlier audit already reported on would replace that report
  // with the first `BackfillValueError` — losing the enum value or the colliding
  // pair the operator has to act on. The copy is refused either way; the report
  // says NOT RUN rather than printing a clean answer.
  const blocked = findings.filter(auditWouldBlockCopy);
  const referentialIntegrity =
    blocked.length > 0
      ? referentialIntegrityNotRun(
          `${blocked.length} earlier finding(s) already block the copy, and this ` +
            'pass runs the transforms — which refuse exactly those documents. ' +
            'Fix them and re-run: referential integrity is UNKNOWN, not clean.'
        )
      : await auditReferentialIntegrity(source, discovery.migrated, resolutions, {
          batchSize: options.batchSize,
        });
  findings.push(...referentialIntegrity.findings);

  return { findings, fileOwnerCensus, referentialIntegrity };
}

/** Per-collection copy result. */
export interface CopyResult {
  readonly collection: string;
  readonly documentsRead: number;
  readonly rowsByTable: Record<string, number>;
  readonly selfReferencesFilled: number;
  /**
   * Wall-clock for this collection, so the report quotes a MEASURED rate rather
   * than an estimate. Set by `runBackfill`; `copyCollection` on its own reports
   * 0 because it does not own the clock.
   */
  readonly elapsedMs: number;
}

/** Everything a run needs, so the runner itself opens no connections. */
export interface RunnerOptions {
  readonly db: Database;
  readonly source: MongoSource;
  readonly batchSize?: number;
  /**
   * How many collections of one level to copy at once.
   *
   * Bounded by the Postgres pool (`PG_MAX_POOL_SIZE`, default 20) because a
   * `COPY` holds its connection for the whole stream, and each concurrent
   * collection also holds a Mongo cursor.
   */
  readonly concurrency?: number;
  /**
   * The documented decisions, and the log they report through.
   *
   * `runBackfill` builds ONE for the whole run so the report counts each
   * degraded document once. A caller reaching `copyCollection` directly may
   * omit it; the pre-pass is then run for that collection and its records go
   * to a throwaway log, which is correct but reports nothing.
   */
  readonly resolutions?: ResolutionContext;
  /** Called after each committed batch, so a caller can persist the checkpoint. */
  readonly onCheckpoint?: (collection: string, checkpoint: Checkpoint) => Promise<void> | void;
  /** Progress reporting. Never the place for data — see `logger` usage in the CLI. */
  readonly onProgress?: (message: string) => void;
}

/**
 * The tables one plan writes, ordered so a parent is inserted before its
 * children.
 *
 * Within a plan the graph is trivially a tree (children reference the parent),
 * but it is derived rather than assumed so a child that gains a reference to
 * another child is ordered correctly without anyone remembering to reorder a
 * literal.
 */
export function orderPlanTables(plan: CollectionPlan): PgTable[] {
  const tables = planTables(plan);
  const names = new Set(tables.map(tableName));
  const ordered: PgTable[] = [];
  const placed = new Set<string>();

  let progressed = true;
  while (ordered.length < tables.length && progressed) {
    progressed = false;
    for (const table of tables) {
      const name = tableName(table);
      if (placed.has(name)) continue;
      const config = getTableConfig(table);
      const blocked = config.foreignKeys.some((foreignKey) => {
        const target = foreignKey.reference().foreignTable;
        if (!is(target, PgTable)) return false;
        const targetName = getTableConfig(target).name;
        return targetName !== name && names.has(targetName) && !placed.has(targetName);
      });
      if (blocked) continue;
      ordered.push(table);
      placed.add(name);
      progressed = true;
    }
  }
  // A cycle among a plan's own tables would be a schema bug, not a data one;
  // appending the remainder keeps the copy honest rather than dropping rows.
  for (const table of tables) if (!placed.has(tableName(table))) ordered.push(table);
  return ordered;
}

/**
 * Copy one collection.
 *
 * Pass A streams, transforms and inserts in batches. Pass B fills in the
 * deferred self-referencing columns, and only runs for a plan whose tables have
 * any.
 */
export async function copyCollection(
  plan: CollectionPlan,
  options: RunnerOptions,
  resumeFrom?: Checkpoint
): Promise<CopyResult> {
  const { db, source } = options;
  const client = getPostgresClient();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const resolutions =
    options.resolutions ??
    createResolutionContext(await planResolutions(source), new ResolutionLog());
  const tables = orderPlanTables(plan);
  const deferredByTable = new Map<string, readonly string[]>();
  for (const table of tables) {
    const columns = selfReferencingColumns(table);
    if (columns.length > 0) deferredByTable.set(tableName(table), columns);
  }

  const rowsByTable: Record<string, number> = {};
  for (const table of tables) rowsByTable[tableName(table)] = 0;
  let documentsRead = 0;

  for await (const documents of streamCollection(source, plan.collection, batchSize, resumeFrom)) {
    const collected = new Map<string, { table: PgTable; rows: Record<string, unknown>[] }>();
    for (const table of tables) {
      collected.set(tableName(table), { table, rows: [] });
    }

    for (const doc of documents) {
      plan.transform(
        doc,
        (table, row) => {
          const name = tableName(table);
          const bucket = collected.get(name);
          if (!bucket) {
            throw new Error(
              `Plan for ${plan.collection} emitted a row for ${name}, which it does ` +
                'not declare in `table`/`childTables`. Declare it: the verifier uses ' +
                'that declaration to tell "empty because nothing fed it" from ' +
                '"empty because the copy produced nothing".'
            );
          }
          const deferred = deferredByTable.get(name);
          bucket.rows.push(deferred ? withoutDeferred(row, deferred) : row);
        },
        resolutions
      );
    }
    documentsRead += documents.length;

    // Tables in FK order, each loaded with COPY → staging → INSERT … SELECT …
    // ON CONFLICT DO NOTHING. NOT wrapped in one transaction across tables: the
    // order already guarantees a parent lands before its child, and a batch-wide
    // transaction would hold every table's locks for the whole batch while
    // buying nothing — the copy is idempotent, so a partial batch is re-done
    // rather than rolled back.
    for (const table of tables) {
      const bucket = collected.get(tableName(table));
      if (!bucket || bucket.rows.length === 0) continue;
      rowsByTable[tableName(table)] += await copyRowsInto(client, table, bucket.rows);
    }

    const last = documents[documents.length - 1];
    if (last !== undefined && options.onCheckpoint) {
      await options.onCheckpoint(plan.collection, checkpointOf(last));
    }
  }

  const selfReferencesFilled =
    deferredByTable.size === 0
      ? 0
      : await fillSelfReferences(plan, options, tables, deferredByTable, resolutions);

  return {
    collection: plan.collection,
    documentsRead,
    rowsByTable,
    selfReferencesFilled,
    elapsedMs: 0,
  };
}

/** A copy of `row` with the deferred columns removed, so they insert as NULL. */
function withoutDeferred(
  row: Record<string, unknown>,
  deferred: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (deferred.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Pass B: re-stream the collection and fill in the deferred self-references.
 *
 * Only rows that actually HAVE a self-reference are updated, so the write
 * volume is the number of sub-accounts, chained records and rotated
 * credentials — not the row count. A row whose every deferred column is null
 * needs no statement at all, which is why this is affordable as a second pass.
 *
 * It re-runs the transform, so it takes the SAME resolutions pass A used —
 * both because a re-decided resolution could write a different value here, and
 * because {@link ResolutionLog} keys on `(rule, document)` so this second run
 * over the same documents cannot double-count what the report says was changed.
 */
async function fillSelfReferences(
  plan: CollectionPlan,
  options: RunnerOptions,
  tables: readonly PgTable[],
  deferredByTable: ReadonlyMap<string, readonly string[]>,
  resolutions: ResolutionContext
): Promise<number> {
  const { db, source } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const tableByName = new Map(tables.map((table) => [tableName(table), table]));
  let filled = 0;

  for await (const documents of streamCollection(source, plan.collection, batchSize)) {
    const updates: Array<{ table: PgTable; id: string; values: Record<string, unknown> }> = [];

    for (const doc of documents) {
      plan.transform(
        doc,
        (table, row) => {
        const name = tableName(table);
        const deferred = deferredByTable.get(name);
        if (!deferred) return;
        const values: Record<string, unknown> = {};
        for (const column of deferred) {
          const value = row[column];
          if (value === null || value === undefined) continue;
          values[column] = value;
        }
        if (Object.keys(values).length === 0) return;

        // Re-assert every `$onUpdate` column from the SOURCE row.
        //
        // Drizzle applies `$onUpdate` to any `db.update(...)`, so this pass —
        // which exists only to fill in a foreign key — would stamp
        // `updated_at = now()` onto the row and destroy the historical value.
        // `CONVENTIONS.md` names that exact hazard as the reason `updated_at` is
        // maintained by the application and NOT by a trigger: "it would fire
        // during backfill and maintenance writes and overwrite the historical
        // value the migration exists to preserve".
        //
        // The verifier caught this on the first full run
        // (`users.updated_at` came back as the migration's own clock), which is
        // what a field-fidelity check is for.
        for (const [property, column] of Object.entries(getTableColumns(table))) {
          if (typeof column.onUpdateFn !== 'function') continue;
          const original = row[property];
          if (original === undefined) continue;
          values[property] = original;
        }

        const rowId = row.id;
        if (typeof rowId !== 'string') {
          throw new Error(
            `${name} has self-referencing columns (${deferred.join(', ')}) but the ` +
              'emitted row carries no string `id`, so the deferred update cannot be ' +
              'keyed. Every self-referencing table in this schema has a text `id` ' +
              'primary key; if that changed, this pass needs the new key.'
          );
        }
        const resolved = tableByName.get(name);
        if (resolved) updates.push({ table: resolved, id: rowId, values });
        },
        resolutions
      );
    }

    if (updates.length === 0) continue;
    await db.transaction(async (tx) => {
      for (const update of updates) {
        const idColumn = idColumnOf(update.table);
        await tx.update(update.table).set(update.values).where(eq(idColumn, update.id));
      }
    });
    filled += updates.length;
  }

  return filled;
}

/**
 * The `id` column of a table, for keying a deferred update.
 *
 * All seven self-referencing tables have a text `id` primary key. Reached
 * through `getTableColumns` from `drizzle-orm` rather than
 * `getTableConfig(...).columns` from `drizzle-orm/pg-core`, and the distinction
 * is not cosmetic: under `moduleResolution: nodenext` drizzle ships CJS and ESM
 * declarations of `PgColumn` that are structurally incompatible (`Types have
 * separate declarations of a private property 'shouldInlineParams'`), so a
 * column obtained from the `pg-core` subpath is not assignable to `eq`, which
 * comes from the package root. Taking both from the root keeps them the same
 * type.
 */
function idColumnOf(table: PgTable): ReturnType<typeof getTableColumns>[string] {
  const column = getTableColumns(table).id;
  if (!column) {
    throw new Error(
      `${tableName(table)} has no \`id\` column to key a deferred update on`
    );
  }
  return column;
}

/** The whole run: discover, audit, copy in FK order. */
export interface RunSummary {
  readonly discovery: Discovery;
  readonly findings: readonly AuditFinding[];
  readonly fileOwnerCensus: Record<string, number>;
  /**
   * What the referential-integrity audit inspected, orphans or not.
   *
   * Carried whole rather than folded into `findings` alone, because the COUNTS
   * are the evidence that the check ran: `0 orphans` means something only next
   * to the number of relations, documents and references it looked at.
   */
  readonly referentialIntegrity: ReferentialIntegrityReport;
  readonly copies: readonly CopyResult[];
  /**
   * What the documented resolutions were GOING to do, decided before the copy.
   *
   * Reported alongside `resolutions` so an operator can compare intent against
   * effect: a planned demotion that never appears in the applied summary means
   * that collection was not copied in this run.
   */
  readonly resolutionPlan: ResolutionPlan;
  /**
   * What the documented resolutions ACTUALLY did, per rule, with the ids.
   *
   * Always present for every declared rule — a rule reporting zero documents
   * says the rule is live and this data did not need it.
   */
  readonly resolutions: readonly ResolutionSummary[];
}

/**
 * Run the backfill.
 *
 * @param options Database and source handles, plus batching/checkpoint hooks.
 * @param state Where a previous run left off.
 * @param only Restrict the copy to these collections. Used by tests and by an
 *   operator re-running one collection; the discovery and audit phases still
 *   cover EVERYTHING, because a restricted copy must not narrow the check that
 *   nothing is unaccounted for.
 */
export async function runBackfill(
  options: RunnerOptions,
  state: BackfillState = emptyState(),
  only?: readonly string[]
): Promise<RunSummary> {
  const report = options.onProgress ?? (() => undefined);
  const discovery = await discover(options.source);

  if (discovery.unknown.length > 0) throw new UnknownCollectionError(discovery.unknown);

  // ONE pre-pass and ONE log for the whole run: the audit phase and the copy
  // phase then share the same decisions by construction, and each degraded
  // document is counted once no matter how many times its transform re-runs.
  const resolutionLog = new ResolutionLog();
  const resolutionPlan = await planResolutions(options.source);
  const resolutions = createResolutionContext(resolutionPlan, resolutionLog);

  const { findings, fileOwnerCensus, referentialIntegrity } = await runAudits(
    options.source,
    discovery,
    resolutions,
    { batchSize: options.batchSize }
  );
  const blocking = findings.filter(auditWouldBlockCopy);
  if (blocking.length > 0) throw new AuditBlockedError(blocking);

  const selected = discovery.migrated
    .map((entry) => entry.plan)
    .filter((plan) => only === undefined || only.includes(plan.collection));

  // LEVELS, not a flat order: within a level no plan depends on another, so
  // they run concurrently; between levels the parents-before-children rule is
  // absolute. `files` is more than half the job and shares a level with dozens
  // of small collections, which is exactly the shape that benefits.
  const levels = planLevels(selected);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const copies: CopyResult[] = [];

  for (const [index, level] of levels.entries()) {
    const pending = level.filter((plan) => {
      if (!state.completed.includes(plan.collection)) return true;
      report(`${plan.collection}: already completed, skipping`);
      return false;
    });
    if (pending.length === 0) continue;

    report(
      `level ${index + 1}/${levels.length}: ${pending.length} collection(s), ` +
        `up to ${concurrency} at a time`
    );

    // A simple worker pool over the level's queue. Bounded because the
    // Postgres pool is bounded (PG_MAX_POOL_SIZE, default 20) and a COPY holds
    // a connection for its whole stream.
    const queue = [...pending];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let plan = queue.shift(); plan !== undefined; plan = queue.shift()) {
        const startedAt = Date.now();
        report(`${plan.collection}: copying`);
        const result = await copyCollection(
          plan,
          { ...options, resolutions },
          state.checkpoints[plan.collection]
        );
        copies.push({ ...result, elapsedMs: Date.now() - startedAt });
      }
    });
    await Promise.all(workers);
  }

  // Statistics describe an empty table until this runs, so the first queries
  // after cutover would plan against `n_distinct` values that are simply wrong.
  const touched = new Set<string>();
  for (const plan of selected) for (const table of planTables(plan)) touched.add(tableName(table));
  await analyzeTables(getPostgresClient(), [...touched]);

  return {
    discovery,
    findings,
    fileOwnerCensus,
    referentialIntegrity,
    copies,
    resolutionPlan,
    resolutions: resolutionLog.summary(),
  };
}
