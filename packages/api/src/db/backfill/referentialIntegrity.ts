/**
 * The referential-integrity audit: every foreign key in the schema, checked
 * against the SOURCE before a single row is inserted.
 *
 * ## The hole this closes
 *
 * The first production run of this backfill reported `--audit-only` CLEAN and
 * then died partway through level 2 of 6:
 *
 * ```
 * insert or update on table "bundles" violates foreign key constraint
 * "bundles_user_id_users_id_fk"
 * ```
 *
 * `users` is in level 1 and had already finished, so that was a real ORPHAN: a
 * `bundles` document naming a user the source does not hold. The audit phase had
 * checks for enums, for uniqueness and for the `files` owner sentinels, and
 * NOTHING for referential integrity — so the one class of failure the FK graph
 * makes certain was the one class it could not see. `bundles` is 44 documents;
 * there are 76 migrated collections and 165 foreign keys, so fixing that one
 * relation by hand would only have moved the failure to the next table.
 *
 * ## The relations are DERIVED, never listed
 *
 * Every relation comes from `getTableConfig(table).foreignKeys` — the same
 * drizzle metadata `order.ts` topologically sorts and `drizzle-kit` generates
 * the DDL from. A hand-written list would be a second source of truth for the
 * same fact and would drift the first time a foreign key was added, re-opening
 * exactly this hole. `__tests__/referentialIntegrity.test.ts` closes the loop by
 * comparing every derived constraint against `pg_constraint` in a real migrated
 * database, in BOTH directions.
 *
 * The constraint NAME is derived the way the DDL derives it — from the SQL
 * column names — and not from drizzle's `ForeignKey.getName()`, which builds it
 * from the TypeScript PROPERTY names and therefore answers
 * `bundles_userId_users_id_fk` where Postgres says `bundles_user_id_users_id_fk`.
 * Reporting a constraint name the operator cannot find in the error they are
 * holding would be worse than reporting none.
 *
 * ## The check runs the TRANSFORM, so it sees the rows Postgres will
 *
 * A foreign key constrains the ROW, not the source document, and a transform can
 * rename, drop, synthesize or default the very field the key is on
 * (`files.ownerUserId` splits into `owner_user_id` + `system_owner`;
 * `validation_requests.status` is rewritten by a documented resolution). So the
 * audit does not translate each FK back into a Mongo field path — it runs each
 * plan's own transform over the whole collection and reads the values off the
 * EMITTED rows, under the same {@link ResolutionContext} the copy will use.
 *
 * That also sidesteps the Mongo/SQL null asymmetry that has cost this migration
 * a cycle already: nothing here writes a `$ne: null` (which matches a MISSING
 * field in Mongo and would silently change the question). A reference is exempt
 * when the emitted value is `null` or the key is absent from the row — which is
 * precisely Postgres's MATCH SIMPLE rule, that a foreign key with any NULL
 * component is satisfied unconditionally.
 *
 * ## The referenced set is what the transform EMITS
 *
 * Not what the source collection holds. A plan that emits fewer rows than its
 * collection has documents (or emits into a table from several collections)
 * would make a collection-count answer wrong; running the transform makes it
 * right by construction. Plans are visited in `planLevels` order — the same
 * order the copy inserts in — so by the time a plan is checked, every table it
 * references outside its own has already contributed its full set. References
 * within a plan (`email_filter_conditions.filter_id`) and to its own table
 * (`users.parent_account_id`, `signed_records.prev`) are parked and re-checked
 * once that collection has been read end to end.
 *
 * ## Cost, and why it runs LAST and only when nothing else blocks
 *
 * This turns `--audit-only` from a handful of index-assisted `distinct` and
 * `$group` passes into a full read of every migrated collection plus a transform
 * per document — roughly the read half of a copy. That is the price of an exact
 * answer, and it is the right trade against a six-level run failing at level 2.
 *
 * Running the transform also means a document the schema refuses THROWS here,
 * where the other audits would merely have REPORTED it. That is why `runAudits`
 * runs this pass last and skips it when any other audit already blocks: a
 * `BackfillValueError` from the first bad document would otherwise replace the
 * enum/uniqueness/sentinel report the operator needs to fix that document. The
 * cost is one extra cycle in that case, and the report says NOT RUN rather than
 * printing a clean answer — see {@link referentialIntegrityNotRun}.
 *
 * ## An orphan is NOT one thing — and the two kinds have opposite fixes
 *
 * "The parent row does not exist" has two causes that look identical in the
 * `23503` and must never be reported as one:
 *
 * - **The source never held it.** The reference was already dangling in
 *   MongoDB, which simply never checked. Postgres is surfacing pre-existing
 *   debt, and the decision is what happens to the REFERENCING row — a
 *   documented resolution rule is a legitimate answer.
 * - **The COPY lost it.** The source holds the parent and the migration failed
 *   to produce its row. That is silent data loss inside the migration; the fix
 *   is in the TRANSFORM, and a resolution rule here would bury exactly the
 *   failure this audit exists to catch.
 *
 * The verdict is MEASURED, not assumed and not read off the transforms. While
 * streaming, each plan's emission fidelity is tallied ({@link PlanEmission}):
 * documents read, rows emitted into the primary table, and how many of those
 * carried the document's own `_id` as that table's primary key. When all three
 * agree, the primary key column IS the set of source `_id`s — so a value absent
 * from it is a document absent from the source, proven with no second query.
 * Anything short of that is {@link OrphanOrigin} `undetermined`, never
 * `absent-in-source`.
 *
 * A plan that emitted fewer primary rows than it read documents is its own
 * blocking finding (`dropped-document`) whether or not any foreign key points at
 * the lost rows — `plan.ts` states that invariant directly, and it is the one
 * finding class no resolution rule may ever answer.
 *
 * ## Every finding BLOCKS unless the offending rows provably never arrive
 *
 * A NULLABLE foreign key does not mean a dangling value is allowed: `NULL` is
 * accepted, a value naming no row is `23503` exactly as on a NOT NULL column. So
 * both block, and the difference is what the report RECOMMENDS — see
 * {@link OrphanResolvability}. Deciding that a nullable orphan becomes NULL is a
 * decision about production data, and it is surfaced rather than invented here.
 *
 * Ten relations DO carry such a decision now — `resolutions.ts`
 * {@link ORPHAN_RESOLUTIONS} — and the way one clears a finding is deliberately
 * narrow. The audit does not take the rule's word for anything:
 *
 * - References are read off the row the transform BUILT, so a rule that removes
 *   a row does not make its orphan disappear from this report. Every offending
 *   value, count and id is still printed.
 * - A finding is answered only when EVERY offending row is one that provably
 *   never reaches Postgres — dropped, or with the offending column nulled —
 *   and only when the origin is `absent-in-source`. A `dropped-by-the-copy` or
 *   `undetermined` orphan can never be answered, because a rule written against
 *   migration data loss would bury it.
 * - The rule's own tally is compared against the traversal's. A rule that acted
 *   on rows this pass found no orphan for is an OVERREACH — it fired on a row
 *   whose parent exists — and that is its own blocking finding, unanswerable by
 *   anything.
 */

import { is } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn, type UpdateDeleteAction } from 'drizzle-orm/pg-core';
import { sqlColumnName } from '@oxyhq/db';
import type { AuditFinding } from './audit';
import { streamCollection, type MongoSource } from './mongoSource';
import { planLevels } from './order';
import { planTables, singlePrimaryKeyProperty, tableName, type CollectionPlan } from './plan';
import {
  MissingParentKeysError,
  ORPHAN_RESOLUTIONS,
  transformDocument,
  type AppliedOrphanResolution,
  type OrphanRelation,
  type ParentKeys,
  type ResolutionContext,
  type ResolutionRule,
  type ResolvedRow,
} from './resolutions';
import { describeId, type MongoDocument } from './values';

/**
 * The separator inside a composite key.
 *
 * Written as the ESCAPE and never as the byte: a raw control character in a
 * source file makes GNU grep treat the whole file as binary, and
 * `__tests__/sourceControlCharacters.test.ts` is the gate that keeps it that
 * way. The runtime value is identical.
 */
const KEY_SEPARATOR = '\u0000';

/** How many offending ids the shared `AuditFinding.sampleIds` carries. */
const SAMPLE_LIMIT = 5;

/** How many distinct MISSING values one relation's detailed report quotes. */
export const MAX_REPORTED_ORPHAN_VALUES = 50;

/** How many referencing document ids are quoted per missing value. */
export const MAX_REPORTED_ORPHAN_DOCUMENT_IDS = 100;

/** Postgres's default when a foreign key declares no `ON DELETE`. */
const DEFAULT_ON_DELETE: UpdateDeleteAction = 'no action';

/**
 * The longest identifier Postgres stores — `NAMEDATALEN - 1`, default 63 bytes.
 *
 * Not a detail: `drizzle-kit` emits the FULL name in the `ADD CONSTRAINT`
 * statement and Postgres silently truncates it on creation, so eleven of this
 * schema's foreign keys are enforced under a name the DDL never spells. The
 * longest is 85 characters. A `23503` therefore quotes
 * `transparency_checkpoint_snapshot_entries_checkpoint_id_transpar`, and an
 * audit reporting the untruncated name would hand the operator a string that
 * appears nowhere in their error or in `pg_constraint`.
 *
 * All identifiers here are ASCII, so bytes and characters coincide; Postgres
 * truncates on a character boundary for multibyte names.
 */
const MAX_IDENTIFIER_LENGTH = 63;

/** One column of a foreign key, in both the names that matter. */
export interface RelationColumn {
  /** The drizzle PROPERTY name — what an emitted row is keyed by. */
  readonly property: string;
  /** The SQL name — what Postgres and the constraint name use. */
  readonly sqlName: string;
  readonly notNull: boolean;
}

/** One foreign key, as the copy has to satisfy it. */
export interface Relation {
  /** The constraint name Postgres will quote in a `23503`. */
  readonly constraint: string;
  readonly table: PgTable;
  readonly tableName: string;
  /** The referencing columns, in key order. */
  readonly columns: readonly RelationColumn[];
  readonly targetTable: PgTable;
  readonly targetTableName: string;
  /** The referenced columns, in the same order. */
  readonly targetColumns: readonly RelationColumn[];
  /**
   * True when ANY referencing column is nullable.
   *
   * That is the right test rather than "all nullable": under MATCH SIMPLE a
   * single NULL component satisfies the whole constraint, so one nullable column
   * is enough to make NULL an available answer.
   */
  readonly nullable: boolean;
  /** Decided per relation in the schema; `no action` when left to the default. */
  readonly onDelete: UpdateDeleteAction;
}

/**
 * What the schema itself says about writing NULL instead of the orphan value.
 *
 * The distinction is `ON DELETE`, and it is not cosmetic. `SET NULL` on a
 * nullable column IS the schema's own written answer to losing the parent, so
 * writing NULL for an orphan lands the row exactly where the declared policy
 * would have put it. `CASCADE` says the opposite — that the row goes when the
 * parent goes — so NULL is a policy the schema never declared, and the
 * cascade-analogous action (dropping the row) is one this migration must never
 * take silently. Which is right is a decision; this only names the options.
 */
export type OrphanResolvability =
  /** No column is nullable: no value satisfies the constraint. */
  | 'not-null'
  /** Nullable AND `ON DELETE SET NULL`: NULL is the schema's own answer. */
  | 'nullable-set-null'
  /** Nullable, but `ON DELETE` says something other than NULL. */
  | 'nullable-other-action';

/**
 * WHERE the missing parent went — and the two answers have opposite fixes.
 *
 * This distinction is the difference between surfacing pre-existing debt and
 * hiding a bug in the migration itself, so the audit must never report an orphan
 * without it:
 *
 * - **`absent-in-source`** — MongoDB never held the parent. The reference was
 *   already dangling there and Mongo simply never checked; Postgres is
 *   surfacing debt that predates this work. The decision is what happens to the
 *   REFERENCING row, and a documented resolution rule is a legitimate answer.
 * - **`dropped-by-the-copy`** — the source HOLDS the parent and the migration
 *   failed to produce its row. That is silent DATA LOSS inside the migration.
 *   The fix belongs in the TRANSFORM; a resolution rule that nulled or dropped
 *   the reference would bury exactly the failure this audit exists to catch, so
 *   one must never be written for this class.
 * - **`parent-removed-by-rule`** — the source HOLDS the parent and a DOCUMENTED
 *   RULE removed it. Neither pre-existing debt nor a bug: it is a decision
 *   already taken and already reported by id under its own rule, and the only
 *   question left is whether anything was declared about the rows left behind.
 *   Distinguished from `undetermined` by MEASUREMENT — every missing value is
 *   one a rule is on record as having dropped — because "a rule did this" and
 *   "nobody knows" are opposite situations that a single `undetermined` verdict
 *   would merge.
 * - **`undetermined`** — the audit cannot tell them apart for this relation,
 *   and says so rather than guessing. Never treat it as the first kind.
 *
 * The verdict is measured, not assumed — see {@link PlanEmission}.
 */
export type OrphanOrigin =
  | 'absent-in-source'
  | 'dropped-by-the-copy'
  | 'parent-removed-by-rule'
  | 'undetermined';

/**
 * How faithfully one plan's transform reproduced its collection, MEASURED.
 *
 * `plan.ts` states the invariant this checks: "There is deliberately no 'skip
 * this document' return value — a silently dropped document is the failure this
 * whole migration exists to avoid." One source document must produce exactly one
 * row in the plan's PRIMARY table, keyed by that document's own `_id`.
 *
 * Measured rather than read off the transforms, because a static reading answers
 * a narrower question: an early `return` is greppable, an `emit` that ends up
 * inside a branch is not, and neither tells you what THIS data did.
 *
 * It is also what makes {@link OrphanOrigin} decidable without a second query.
 * When `primaryRowsKeyedByOwnId === documentsRead === primaryRowsEmitted`, the
 * primary table's KEY column is a faithful image of the source `_id`s — so a
 * value absent from it is a document absent from the SOURCE, proven rather than
 * assumed.
 *
 * The key is the table's own primary key, read from the schema, NOT hardcoded as
 * `id`: `user_credits` is keyed by `user_id`, because `UserCredits._id` is the
 * user id verbatim and the table is a 1:1 extension of `users` with no separate
 * id column. Assuming `id` reported that plan as unfaithful and would have
 * downgraded every verdict about it to `undetermined`.
 */
export interface PlanEmission {
  readonly collection: string;
  /** The plan's primary table — the one that owes one row per document. */
  readonly table: string;
  /**
   * The property holding that table's single-column primary key, or `null` when
   * it has a composite one (no single value to compare a document `_id` to).
   */
  readonly primaryKeyProperty: string | null;
  readonly documentsRead: number;
  /** Rows emitted into the primary table. */
  readonly primaryRowsEmitted: number;
  /** Of those, how many carried the source document's own `_id` as that key. */
  readonly primaryRowsKeyedByOwnId: number;
  /**
   * Rows a DOCUMENTED RULE removed — {@link ORPHAN_RESOLUTIONS} `drop-row`.
   *
   * Counted apart from `primaryRowsEmitted` so a deliberate, reported removal
   * is not indistinguishable from the transform silently losing a document.
   * {@link droppedDocuments} subtracts it, and the only thing that increments it
   * is a row a rule removed — which the same loop reports by id into the
   * resolution log. Those two are one step apart rather than one statement, so
   * `__tests__/orphanResolutions.test.ts` mutation-tests the pairing directly:
   * make the drop silent and the id report goes red while the count stays.
   */
  readonly primaryRowsDroppedByRule: number;
}

/**
 * A plan that emitted fewer primary rows than it read documents, EXCLUDING the
 * rows a documented rule removed on purpose.
 *
 * Only the unexplained shortfall is data loss. A rule-removed row is reported by
 * id under its own rule and is subtracted here rather than being reported twice
 * under two different names — but nothing else is subtracted, so the
 * `dropped-document` finding still fires for every row that went missing without
 * anyone deciding it should.
 */
export function droppedDocuments(emission: PlanEmission): number {
  return Math.max(
    0,
    emission.documentsRead - emission.primaryRowsEmitted - emission.primaryRowsDroppedByRule
  );
}

/**
 * True when this plan's primary `id` column provably equals the set of source
 * `_id`s — every document produced exactly one row, keyed by its own `_id`.
 *
 * Deliberately STRICT about rule-removed rows, unlike {@link droppedDocuments}:
 * a table a rule dropped rows from holds a SUBSET of the source ids, so "this
 * value is not in the table" no longer proves "no source document has this
 * `_id`". Every verdict about a relation pointing at such a table degrades to
 * `undetermined` — fail-closed, and the honest answer.
 */
export function emissionIsFaithful(emission: PlanEmission): boolean {
  return (
    emission.primaryRowsEmitted === emission.documentsRead &&
    emission.primaryRowsKeyedByOwnId === emission.documentsRead
  );
}

/** One value that names no row, and the documents that reference it. */
export interface OrphanValue {
  /** The referencing value, as the row carries it. Composite keys are joined. */
  readonly value: string;
  /** Referencing rows, in full. */
  readonly documents: number;
  /** Of those, how many a documented rule keeps out of Postgres. */
  readonly mootDocuments: number;
  /** Source `_id`s, capped at {@link MAX_REPORTED_ORPHAN_DOCUMENT_IDS}. */
  readonly documentIds: readonly string[];
}

/** Every orphan found on one relation. */
export interface RelationOrphans {
  readonly relation: Relation;
  /** The collection whose documents produce the referencing rows. */
  readonly collection: string;
  /** Referencing rows that name no row, in full. */
  readonly documents: number;
  /**
   * Of those, how many never reach Postgres because a documented rule removed
   * the row or nulled the offending column.
   *
   * A row that is not written cannot violate a constraint, so this is the
   * number that decides whether the finding still blocks — never the rule's
   * say-so. It is measured on the emitted rows, not read off the rule.
   */
  readonly mootDocuments: number;
  /** Distinct missing values, in full. */
  readonly distinctValues: number;
  /** Missing values, capped at {@link MAX_REPORTED_ORPHAN_VALUES}. */
  readonly values: readonly OrphanValue[];
  readonly resolvability: OrphanResolvability;
  /** Where the missing parent went. Two of the three answers have opposite fixes. */
  readonly origin: OrphanOrigin;
  /** How that verdict was reached, in the operator's words. */
  readonly originReason: string;
  /**
   * The documented rule that answers this finding, when one provably does.
   *
   * Set only when the origin is `absent-in-source` AND every offending row is
   * moot AND one rule accounts for all of them. Anything else leaves it unset
   * and the finding blocks.
   */
  readonly resolvedBy?: ResolutionRule;
  /**
   * True when NO plan in this run feeds the referenced table, so it will hold no
   * rows at all — every reference to it is an orphan for that reason alone.
   * Usually means the feeding collection is absent from the source, which
   * `Discovery.absent` reports separately.
   */
  readonly targetUnfed: boolean;
}

/**
 * What a documented rule's row-dropping could take WITH it.
 *
 * A dropped row is a parent as well as a child: nothing stops another table
 * referencing it. Reporting that here — rather than discovering it as a second
 * `23503` three hours into the copy — is the point. Computed from the SAME
 * derived foreign-key graph the rest of this file uses, so a schema that grows a
 * reference to one of these tables is covered without anyone remembering.
 */
export interface DropCascade {
  readonly rule: ResolutionRule;
  /** The table the rule removes rows from. */
  readonly table: string;
  /** How many rows it removed in this pass. */
  readonly rowsDropped: number;
  /** Constraints pointing AT that table — the ones a drop could orphan. */
  readonly inboundConstraints: readonly string[];
  /**
   * Rows that ARE orphaned by these drops, per constraint.
   *
   * Empty means the drops orphan nothing, measured rather than assumed: the
   * dropped ids were compared against the orphan values this pass found on
   * every inbound constraint. An entry carrying `resolvedBy` is one a declared
   * cascade follows; an entry WITHOUT one blocks, and is the case this
   * disclosure exists for.
   */
  readonly orphanedByDrop: readonly {
    readonly constraint: string;
    readonly documents: number;
    readonly resolvedBy?: ResolutionRule;
  }[];
}

/** What the referential audit inspected, whether or not it found anything. */
export interface ReferentialIntegrityReport {
  /**
   * Whether the pass ran at all.
   *
   * A pass that did not run reports zero orphans, and zero orphans is exactly
   * what a clean pass reports — so the two have to be distinguishable by
   * something other than the finding count. Every consumer must say NOT RUN
   * rather than print a clean answer.
   */
  readonly ran: boolean;
  /** Why it did not run, when it did not. `null` when it ran. */
  readonly skippedReason: string | null;
  readonly findings: readonly AuditFinding[];
  readonly orphans: readonly RelationOrphans[];
  /**
   * What each row-dropping rule removed, and what that could orphan.
   *
   * One entry per `drop-row` rule that fired, whether or not anything references
   * the table — "nothing points at `notifications`, so dropping one orphans
   * nothing" is an answer an operator needs, not an absence.
   */
  readonly dropCascades: readonly DropCascade[];
  /**
   * Referencing ROWS per origin — the split that decides where the fix belongs.
   *
   * Reported as counts beside the orphans so an operator can see at a glance
   * whether they are looking at pre-existing Mongo debt or at data the
   * migration itself lost.
   */
  readonly orphanRowsByOrigin: Readonly<Record<OrphanOrigin, number>>;
  /**
   * Every plan's measured emission fidelity, in collection order.
   *
   * Present whether or not anything is wrong: it is the evidence behind every
   * `absent-in-source` verdict, and a reader must be able to check it.
   */
  readonly emissions: readonly PlanEmission[];
  /** Foreign keys derived from the schema for the tables these plans write. */
  readonly relationsInspected: number;
  /**
   * Of those, how many the DATA actually exercised — at least one non-NULL
   * reference resolved through them.
   *
   * Reported beside `relationsInspected` because they answer different
   * questions and only one of them is about this database. Deriving 165
   * relations proves the traversal works; exercising 40 of them says the other
   * 125 hold no non-NULL reference in this source, which is a fact about the
   * data (an empty collection, an always-null optional column) and not a gap.
   */
  readonly relationsExercised: number;
  /** Collections streamed. Must equal the number of plans. */
  readonly collectionsInspected: number;
  readonly documentsInspected: number;
  /** Rows the transforms emitted, across every table. */
  readonly rowsInspected: number;
  /** Non-NULL references actually compared against a referenced set. */
  readonly referencesChecked: number;
}

/**
 * A report saying the pass did NOT run, with the reason.
 *
 * The one thing this exists to prevent is a skipped pass reading as a clean one.
 * It carries `ran: false` and zero counts, so any consumer that prints the
 * counts prints the evidence that nothing was inspected.
 */
export function referentialIntegrityNotRun(reason: string): ReferentialIntegrityReport {
  return {
    ran: false,
    skippedReason: reason,
    findings: [],
    orphans: [],
    dropCascades: [],
    orphanRowsByOrigin: {
      'absent-in-source': 0,
      'dropped-by-the-copy': 0,
      'parent-removed-by-rule': 0,
      undetermined: 0,
    },
    emissions: [],
    relationsInspected: 0,
    relationsExercised: 0,
    collectionsInspected: 0,
    documentsInspected: 0,
    rowsInspected: 0,
    referencesChecked: 0,
  };
}

/**
 * Raised when the referential audit did no work and therefore proves nothing.
 *
 * The vacuity floor, and the whole reason this file exists: the run that failed
 * on `bundles` was preceded by an audit that reported CLEAN because it had no
 * referential check at all. A traversal that finds zero relations, streams fewer
 * collections than it was given, or reads zero documents out of a non-empty
 * source would report exactly the same clean answer — so each of those is a
 * failure instead.
 */
export class VacuousReferentialIntegrityError extends Error {
  constructor(readonly report: ReferentialIntegrityReport, reason: string) {
    super(
      `The referential-integrity audit inspected nothing and therefore proves ` +
        `nothing: ${reason}. It derived ${report.relationsInspected} relation(s), ` +
        `exercised ${report.relationsExercised} of them, ` +
        `streamed ${report.collectionsInspected} collection(s), read ` +
        `${report.documentsInspected} document(s) and checked ` +
        `${report.referencesChecked} reference(s). A clean report from a check ` +
        'that never ran is the exact defect this audit was added to fix.'
    );
    this.name = 'VacuousReferentialIntegrityError';
  }
}

// ---------------------------------------------------------------------------
// deriving the relations
// ---------------------------------------------------------------------------

/**
 * Every foreign key on every table the given plans write.
 *
 * Deduplicated by constraint name and sorted, so the report is stable between
 * runs and a diff of two runs is readable.
 */
export function referentialRelations(plans: readonly CollectionPlan[]): Relation[] {
  const seen = new Set<string>();
  const relations: Relation[] = [];

  for (const plan of plans) {
    for (const table of planTables(plan)) {
      for (const foreignKey of getTableConfig(table).foreignKeys) {
        const relation = describeRelation(table, foreignKey.onDelete, foreignKey.reference());
        if (seen.has(relation.constraint)) continue;
        seen.add(relation.constraint);
        relations.push(relation);
      }
    }
  }

  return relations.sort((a, b) =>
    a.constraint < b.constraint ? -1 : a.constraint > b.constraint ? 1 : 0
  );
}

/** One drizzle `ForeignKey`, resolved into the names and nullability it implies. */
function describeRelation(
  table: PgTable,
  onDelete: UpdateDeleteAction | undefined,
  reference: {
    readonly name?: string;
    readonly columns: PgColumn[];
    readonly foreignTable: PgTable;
    readonly foreignColumns: PgColumn[];
  }
): Relation {
  if (!is(reference.foreignTable, PgTable)) {
    throw new Error(
      `The foreign key on ${tableName(table)} references something that is not a ` +
        'PgTable, so its referenced set cannot be determined. Skipping it would ' +
        'make this audit silently stop checking a real constraint.'
    );
  }

  const columns = reference.columns.map(toRelationColumn);
  const targetColumns = reference.foreignColumns.map(toRelationColumn);
  const sourceName = tableName(table);
  const targetName = tableName(reference.foreignTable);

  return {
    // The DDL names it from the SQL column names, so this must too — drizzle's
    // own `getName()` uses the TypeScript property names and answers a name that
    // appears nowhere in Postgres. An explicit `foreignKey({name})` wins, exactly
    // as it does in the generated migration. Then Postgres's own truncation, so
    // the name printed is the name the operator's `23503` carries.
    constraint: truncateIdentifier(
      reference.name ??
        [
          sourceName,
          ...columns.map((column) => column.sqlName),
          targetName,
          ...targetColumns.map((column) => column.sqlName),
          'fk',
        ].join('_')
    ),
    table,
    tableName: sourceName,
    columns,
    targetTable: reference.foreignTable,
    targetTableName: targetName,
    targetColumns,
    nullable: columns.some((column) => !column.notNull),
    onDelete: onDelete ?? DEFAULT_ON_DELETE,
  };
}

/**
 * An identifier as Postgres STORES it, truncated to {@link MAX_IDENTIFIER_LENGTH}.
 *
 * Exported because it is the answer to "why does the constraint in my error not
 * match the one in the migration file" for eleven relations in this schema.
 */
export function truncateIdentifier(name: string): string {
  return name.length <= MAX_IDENTIFIER_LENGTH ? name : name.slice(0, MAX_IDENTIFIER_LENGTH);
}

function toRelationColumn(column: PgColumn): RelationColumn {
  return {
    // `column.name` on a drizzle column is the TypeScript PROPERTY name — the
    // key an emitted row uses. `sqlColumnName` is the other half. Confusing the
    // two is the trap `@oxyhq/db`'s casing module exists to close.
    property: column.name,
    sqlName: sqlColumnName(column),
    notNull: column.notNull,
  };
}

/** How a relation's orphans could be answered, per the schema's own declaration. */
export function orphanResolvability(relation: Relation): OrphanResolvability {
  if (!relation.nullable) return 'not-null';
  return relation.onDelete === 'set null' ? 'nullable-set-null' : 'nullable-other-action';
}

// ---------------------------------------------------------------------------
// the documented rules, checked against the schema they claim to follow
// ---------------------------------------------------------------------------

/**
 * The single-column foreign key on one column, derived from the schema.
 *
 * Throws rather than returning null for a column that carries none: an orphan
 * rule declared on a column with no foreign key would answer a finding that
 * cannot exist, which is a rule nobody can ever check.
 */
export function relationForColumn(table: PgTable, property: string): Relation {
  const matches: Relation[] = [];
  for (const foreignKey of getTableConfig(table).foreignKeys) {
    const relation = describeRelation(table, foreignKey.onDelete, foreignKey.reference());
    if (relation.columns.length !== 1) continue;
    if (relation.columns[0]?.property === property) matches.push(relation);
  }
  const relation = matches[0];
  if (relation === undefined || matches.length > 1) {
    throw new Error(
      `${tableName(table)}.${property} carries ${matches.length} single-column ` +
        'foreign key(s), and a documented orphan resolution needs exactly one to ' +
        'answer. A rule on a column the schema does not constrain would answer a ' +
        'finding that cannot occur.'
    );
  }
  return relation;
}

/** Raised when a documented rule disagrees with the constraint it answers. */
export class OrphanResolutionMismatchError extends Error {
  constructor(readonly relation: OrphanRelation, reason: string) {
    super(
      `The documented resolution \`${relation.rule.id}\` does not match the ` +
        `schema it answers: ${reason}. Its decision is written FROM the ` +
        "constraint's own ON DELETE, so a constraint that no longer says that " +
        'makes the decision unjustified — re-decide it rather than letting the ' +
        'rule keep firing under a premise that changed.'
    );
    this.name = 'OrphanResolutionMismatchError';
  }
}

/**
 * Check every documented orphan rule against the constraint it answers.
 *
 * The decisions in `resolutions.ts` rest on exactly two schema facts — "NOT NULL
 * with ON DELETE CASCADE" for a drop, "nullable with ON DELETE SET NULL" for a
 * null — and this is the only place either is asserted. Nothing restates them,
 * so a schema change that invalidates a decision fails here instead of quietly
 * leaving a rule that deletes rows for a reason that stopped being true.
 *
 * Run at the START of every pass rather than on first use: a rule that fires on
 * no rows in this data is exactly the one nobody would notice had gone wrong.
 */
export function assertOrphanResolutionsMatchSchema(): void {
  for (const entry of ORPHAN_RESOLUTIONS) {
    const relation = relationForColumn(entry.table, entry.property);
    if (relation.targetTableName !== tableName(entry.targetTable)) {
      throw new OrphanResolutionMismatchError(
        entry,
        `it declares the parent table ${tableName(entry.targetTable)} but the ` +
          `constraint references ${relation.targetTableName}`
      );
    }
    // A cascade is the DECLARED CONSEQUENCE of another rule, so it has to name
    // that rule, and the rule it names has to be the one that removes rows from
    // the table this relation references. Without both, "cascade" would be a
    // free-standing licence to delete rather than the second half of a decision
    // someone made.
    if (entry.trigger === 'parent-dropped') {
      const trigger = entry.cascadesFrom;
      if (trigger === undefined) {
        throw new OrphanResolutionMismatchError(
          entry,
          'it cascades but names no rule to cascade FROM, so nothing ties it to ' +
            'a decision anyone made'
        );
      }
      if (tableName(trigger.table) !== relation.targetTableName) {
        throw new OrphanResolutionMismatchError(
          entry,
          `it cascades from \`${trigger.rule.id}\`, which removes rows from ` +
            `${tableName(trigger.table)} — but this relation references ` +
            `${relation.targetTableName}, so the removal it names is not the one ` +
            'that could orphan these rows'
        );
      }
      if (trigger.action !== 'drop-row') {
        throw new OrphanResolutionMismatchError(
          entry,
          `it cascades from \`${trigger.rule.id}\`, which does not REMOVE a row ` +
            'at all — nothing is lost, so nothing follows'
        );
      }
      if (entry.action !== 'drop-row') {
        throw new OrphanResolutionMismatchError(
          entry,
          'a cascade may only DROP. Writing NULL for a parent this migration ' +
            'itself removed would invent a state rather than follow one'
        );
      }
    }
    if (entry.action === 'drop-row') {
      // A drop on a NULLABLE column is a CHOICE between two available answers,
      // where a drop on a NOT NULL column is the only one left. The declaration
      // has to say which situation it is in, and say it correctly: a rule
      // written by copying one of the nine onto a nullable column is refused
      // here rather than quietly destroying rows NULL could have kept.
      if (relation.nullable && entry.whyNotNull === undefined) {
        throw new OrphanResolutionMismatchError(
          entry,
          `${relation.constraint} is NULLABLE, so NULL is available and dropping ` +
            'the row is a choice rather than the only answer — the declaration ' +
            'must say why NULL was not taken (`whyNotNull`)'
        );
      }
      if (!relation.nullable && entry.whyNotNull !== undefined) {
        throw new OrphanResolutionMismatchError(
          entry,
          `${relation.constraint} is NOT NULL, so NULL was never available and ` +
            'there is nothing for `whyNotNull` to justify — its presence means ' +
            'the declaration and the schema disagree about which column this is'
        );
      }
      if (relation.onDelete !== 'cascade') {
        throw new OrphanResolutionMismatchError(
          entry,
          `${relation.constraint} declares ON DELETE ${relation.onDelete}, not ` +
            'cascade, so "the schema already says this row goes with its parent" ' +
            'is no longer true'
        );
      }
      continue;
    }
    if (!relation.nullable) {
      throw new OrphanResolutionMismatchError(
        entry,
        `${relation.constraint} is NOT NULL, so the rule would write a value the ` +
          'column refuses'
      );
    }
    if (relation.onDelete !== 'set null') {
      throw new OrphanResolutionMismatchError(
        entry,
        `${relation.constraint} declares ON DELETE ${relation.onDelete}, not set ` +
          'null, so writing NULL invents a policy the schema does not declare'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// the pass
// ---------------------------------------------------------------------------

/** One collection of the run, with the document count discovery measured. */
export interface PlannedCollection {
  readonly plan: CollectionPlan;
  readonly documents: number;
}

/** A referenced `(table, columns)` pair and every value emitted for it. */
interface TargetSet {
  readonly tableName: string;
  readonly properties: readonly string[];
  readonly values: Set<string>;
}

/**
 * One relation with the two things the per-row check needs precomputed.
 *
 * Built once rather than derived per row: the inner loop runs once per emitted
 * row per outgoing relation, which on `users` alone is three relations across
 * every account.
 */
interface CheckedRelation {
  readonly relation: Relation;
  /** The referencing columns' property names, in key order. */
  readonly properties: readonly string[];
  /** The referenced set this relation must find its value in. */
  readonly target: TargetSet;
}

/** A reference not yet satisfied when its row was emitted. */
interface PendingReference {
  readonly relation: Relation;
  readonly collection: string;
  readonly target: TargetSet;
  readonly value: string;
  documents: number;
  /** Of those, the rows a documented rule keeps out of Postgres. */
  mootDocuments: number;
  /** The rules that made them moot. One member means one rule answers them all. */
  readonly mootRules: Map<string, ResolutionRule>;
  readonly documentIds: string[];
}

/** Accumulates one relation's orphans while the pass runs. */
interface OrphanAccumulator {
  readonly relation: Relation;
  readonly collection: string;
  documents: number;
  mootDocuments: number;
  readonly mootRules: Map<string, ResolutionRule>;
  distinctValues: number;
  /**
   * EVERY missing value with its row count, uncapped.
   *
   * The capped {@link OrphanValue} list is for the report; this is what the
   * rule's own tally is checked against and what the cascade check intersects
   * dropped ids with, and both of those have to be exact rather than a sample.
   */
  readonly documentsByValue: Map<string, number>;
  readonly values: OrphanValue[];
}

/**
 * What one documented rule actually did, measured on the emitted rows.
 *
 * Kept per RELATION rather than per rule so it can be compared against that
 * relation's orphans one-to-one. The comparison is the guard: a rule that acted
 * on rows the traversal found no orphan for fired on a row whose parent exists.
 */
interface AppliedTally {
  readonly relation: OrphanRelation;
  rows: number;
  readonly values: Set<string>;
  /** Primary-key values of the rows it removed, for the cascade check. */
  readonly droppedIds: Set<string>;
  readonly documentIds: string[];
}

/**
 * Check every foreign key of the run against the source.
 *
 * @param source Read-only MongoDB.
 * @param plans EVERY collection the run will copy, with its document count —
 *   `Discovery.migrated` verbatim. It has to be the complete set: a referenced
 *   table fed by a plan that is not here holds no rows, so a partial set turns
 *   healthy references into reported orphans.
 * @param resolutions The SAME documented decisions the copy will apply, so the
 *   rows this inspects are the rows that will be written.
 * @throws {VacuousReferentialIntegrityError} When the traversal inspected
 *   nothing and its clean answer would therefore mean nothing.
 */
export async function auditReferentialIntegrity(
  source: MongoSource,
  plans: readonly PlannedCollection[],
  resolutions: ResolutionContext,
  options: { readonly batchSize?: number } = {}
): Promise<ReferentialIntegrityReport> {
  // Before anything is read: the documented rules are checked against the
  // constraints they claim to answer. A rule whose premise the schema no longer
  // supports must never get as far as acting on a row.
  assertOrphanResolutionsMatchSchema();

  const batchSize = options.batchSize ?? 1000;
  const collectionPlans = plans.map((entry) => entry.plan);
  const relations = referentialRelations(collectionPlans);

  const fedTables = new Set<string>();
  for (const plan of collectionPlans) {
    for (const table of planTables(plan)) fedTables.add(tableName(table));
  }

  const { targetSetsByTable, checkedByTable } = indexRelations(relations);
  // The rules decide against the rows THIS PASS has emitted, which is what
  // Postgres will hold — nothing is written yet, so there is nothing else that
  // could be exact. Level order makes it complete: a parent collection is
  // streamed before any collection that references it, so by the time a child
  // row is built the set is whole. It is also the SAME set the traversal checks
  // references against, which is the point: the rule and the audit can no
  // longer disagree about what exists, because there is only one answer.
  const parents = auditParentKeys(targetSetsByTable);
  const orphans = new Map<string, OrphanAccumulator>();
  const applied = new Map<OrphanRelation, AppliedTally>();
  const counters: PassCounters = {
    collections: 0,
    documents: 0,
    rows: 0,
    references: 0,
    exercised: new Set<string>(),
  };

  const emissions = new Map<string, PlanEmission>();

  for (const level of planLevels(collectionPlans)) {
    for (const plan of level) {
      // Deduplicated on `(constraint, value)` while the collection streams, so a
      // self-reference across 296,924 rows costs one entry per DISTINCT
      // unresolved value rather than one per row.
      const pending = new Map<string, PendingReference>();
      const emission: EmissionTally = {
        primaryTable: tableName(plan.table),
        primaryKeyProperty: singlePrimaryKeyProperty(plan.table),
        documentsRead: 0,
        primaryRowsEmitted: 0,
        primaryRowsKeyedByOwnId: 0,
        primaryRowsDroppedByRule: 0,
      };

      for await (const documents of streamCollection(source, plan.collection, batchSize)) {
        counters.documents += documents.length;
        emission.documentsRead += documents.length;
        for (const doc of documents) {
          inspectDocument(plan, doc, resolutions, parents, {
            targetSetsByTable,
            checkedByTable,
            pending,
            applied,
            counters,
            emission,
          });
        }
      }

      emissions.set(emission.primaryTable, {
        collection: plan.collection,
        table: emission.primaryTable,
        primaryKeyProperty: emission.primaryKeyProperty,
        documentsRead: emission.documentsRead,
        primaryRowsEmitted: emission.primaryRowsEmitted,
        primaryRowsKeyedByOwnId: emission.primaryRowsKeyedByOwnId,
        primaryRowsDroppedByRule: emission.primaryRowsDroppedByRule,
      });

      // Re-checked only now: a reference INTO this plan's own tables — a child
      // row naming its parent, or a self-reference like `users.parent_account_id`
      // — may name a row this same collection produces later in `_id` order.
      for (const entry of pending.values()) {
        if (entry.target.values.has(entry.value)) continue;
        recordOrphan(orphans, entry);
      }
      counters.collections += 1;
    }
  }

  // What the rules REMOVED, per table — the evidence that separates "a rule
  // took this parent away" from "nobody knows where it went". Folded from the
  // per-relation tallies so it is the rules' own record rather than a second
  // count of the same thing.
  const droppedIdsByTable = new Map<string, Set<string>>();
  for (const tally of applied.values()) {
    if (tally.relation.action !== 'drop-row') continue;
    const existing = droppedIdsByTable.get(tally.relation.tableName);
    if (existing) for (const id of tally.droppedIds) existing.add(id);
    else droppedIdsByTable.set(tally.relation.tableName, new Set(tally.droppedIds));
  }

  const finished: RelationOrphans[] = [...orphans.values()]
    .sort((a, b) =>
      a.relation.constraint < b.relation.constraint
        ? -1
        : a.relation.constraint > b.relation.constraint
          ? 1
          : 0
    )
    .map((entry) => {
      const origin = classifyOrigin(
        entry.relation,
        emissions.get(entry.relation.targetTableName),
        fedTables.has(entry.relation.targetTableName),
        [...entry.documentsByValue.keys()],
        droppedIdsByTable
      );
      const resolvedBy = resolvingRule(entry, origin.origin);
      return {
        relation: entry.relation,
        collection: entry.collection,
        documents: entry.documents,
        mootDocuments: entry.mootDocuments,
        distinctValues: entry.distinctValues,
        values: entry.values,
        resolvability: orphanResolvability(entry.relation),
        origin: origin.origin,
        originReason: origin.reason,
        targetUnfed: !fedTables.has(entry.relation.targetTableName),
        ...(resolvedBy === undefined ? {} : { resolvedBy }),
      };
    });

  const orphanRowsByOrigin: Record<OrphanOrigin, number> = {
    'absent-in-source': 0,
    'dropped-by-the-copy': 0,
    'parent-removed-by-rule': 0,
    undetermined: 0,
  };
  for (const entry of finished) orphanRowsByOrigin[entry.origin] += entry.documents;

  const orderedEmissions = [...emissions.values()].sort((a, b) =>
    a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0
  );

  const dropCascades = describeDropCascades(
    applied,
    relations,
    orphans,
    new Map(finished.map((entry) => [entry.relation.constraint, entry.resolvedBy]))
  );

  const report: ReferentialIntegrityReport = {
    ran: true,
    skippedReason: null,
    findings: [
      ...orderedEmissions.filter((entry) => droppedDocuments(entry) > 0).map(describeDropFinding),
      ...describeOverreach(applied, orphans),
      ...finished.map(describeFinding),
    ],
    orphans: finished,
    dropCascades,
    orphanRowsByOrigin,
    emissions: orderedEmissions,
    relationsInspected: relations.length,
    relationsExercised: counters.exercised.size,
    collectionsInspected: counters.collections,
    documentsInspected: counters.documents,
    rowsInspected: counters.rows,
    referencesChecked: counters.references,
  };

  assertNotVacuous(report, plans);
  return report;
}

/** Mutable tallies the pass keeps, so the traversal can be a plain function. */
interface PassCounters {
  collections: number;
  documents: number;
  rows: number;
  references: number;
  /** Constraint names that resolved at least one non-NULL reference. */
  readonly exercised: Set<string>;
}

/** The running emission tally for the plan currently being streamed. */
interface EmissionTally {
  /** SQL name of the plan's primary table. */
  readonly primaryTable: string;
  /** Property of that table's single-column primary key, or `null`. */
  readonly primaryKeyProperty: string | null;
  documentsRead: number;
  primaryRowsEmitted: number;
  primaryRowsKeyedByOwnId: number;
  primaryRowsDroppedByRule: number;
}

/** Everything one document's inspection reads and writes. */
interface PassState {
  readonly targetSetsByTable: ReadonlyMap<string, readonly TargetSet[]>;
  readonly checkedByTable: ReadonlyMap<string, readonly CheckedRelation[]>;
  readonly pending: Map<string, PendingReference>;
  readonly applied: Map<OrphanRelation, AppliedTally>;
  readonly counters: PassCounters;
  readonly emission: EmissionTally;
}

/**
 * Group the relations by the table they are read from, and give each one the
 * referenced set it must find its value in.
 *
 * A referenced `(table, columns)` pair is SHARED by every relation pointing at
 * it — `users.id` is referenced 97 times and its set is collected once.
 */
function indexRelations(relations: readonly Relation[]): {
  targetSetsByTable: Map<string, TargetSet[]>;
  checkedByTable: Map<string, CheckedRelation[]>;
} {
  const targetSets = new Map<string, TargetSet>();
  const targetSetsByTable = new Map<string, TargetSet[]>();
  const checkedByTable = new Map<string, CheckedRelation[]>();

  for (const relation of relations) {
    const properties = relation.targetColumns.map((column) => column.property);
    const setKey = `${relation.targetTableName}${KEY_SEPARATOR}${properties.join(',')}`;
    let target = targetSets.get(setKey);
    if (target === undefined) {
      target = {
        tableName: relation.targetTableName,
        properties,
        values: new Set<string>(),
      };
      targetSets.set(setKey, target);
      push(targetSetsByTable, target.tableName, target);
    }
    push(checkedByTable, relation.tableName, {
      relation,
      properties: relation.columns.map((column) => column.property),
      target,
    });
  }

  return { targetSetsByTable, checkedByTable };
}

/**
 * The parent keys the AUDIT decides against: the rows it has emitted so far.
 *
 * Backed by the traversal's own target sets, so it is a LIVE view rather than a
 * copy — a set still filling as a collection streams is exactly right, because
 * level order guarantees it is complete before any collection that references it
 * is read. Nothing is in Postgres during an audit, so this is the only set that
 * can be exact; it is also the set the traversal itself checks against, which is
 * what stops the rule and the report from disagreeing.
 *
 * A table with no `(table, primary key)` target set is one nothing references,
 * so no rule can be deciding against it — asking is a bug, and it THROWS.
 */
function auditParentKeys(
  targetSetsByTable: ReadonlyMap<string, readonly TargetSet[]>
): ParentKeys {
  return {
    keysFor(table) {
      const key = singlePrimaryKeyProperty(table);
      const sets = targetSetsByTable.get(tableName(table)) ?? [];
      const primary =
        key === null
          ? undefined
          : sets.find((set) => set.properties.length === 1 && set.properties[0] === key);
      if (primary === undefined) {
        throw new MissingParentKeysError(tableName(table), [...targetSetsByTable.keys()]);
      }
      return primary.values;
    },
  };
}

/** Append to a `Map<string, T[]>`, creating the array on first use. */
function push<T>(index: Map<string, T[]>, key: string, entry: T): void {
  const existing = index.get(key);
  if (existing) existing.push(entry);
  else index.set(key, [entry]);
}

/** Run one document's transform and account for every row it emits. */
function inspectDocument(
  plan: CollectionPlan,
  doc: MongoDocument,
  resolutions: ResolutionContext,
  parents: ParentKeys,
  state: PassState
): void {
  const documentId = describeId(doc) ?? '(document has no _id)';
  transformDocument(plan, doc, resolutions, parents, (emitted) => {
    state.counters.rows += 1;
    const name = tableName(emitted.table);
    const key = state.emission.primaryKeyProperty;

    // The invariant `plan.ts` states: one document, one row in the PRIMARY
    // table, keyed by that document's own `_id`. Counted rather than assumed,
    // because it is what makes an `absent-in-source` verdict provable. A row a
    // documented rule REMOVED is counted apart — see `PlanEmission`.
    if (name === state.emission.primaryTable) {
      if (emitted.written === null) {
        state.emission.primaryRowsDroppedByRule += 1;
      } else {
        state.emission.primaryRowsEmitted += 1;
        if (key !== null && emitted.written[key] === documentId) {
          state.emission.primaryRowsKeyedByOwnId += 1;
        }
      }
    }

    // What the rules DID, tallied per relation on the emitted rows — the
    // measurement `resolvingRule` and `describeOverreach` compare against the
    // orphans this same pass finds, so the rule never gets to be its own judge.
    for (const application of emitted.applied) {
      recordApplication(state.applied, application, documentId, keyOf(emitted.source, application));
    }

    // Target sets take only rows that will EXIST. A row a rule removes cannot
    // satisfy anything that references it, and treating it as a live parent
    // would hide exactly the cascade `DropCascade` exists to report.
    if (emitted.written !== null) {
      for (const target of state.targetSetsByTable.get(name) ?? []) {
        const value = compositeKey(target.properties, emitted.written);
        if (value !== null) target.values.add(value);
      }
    }

    // References are read off the row the TRANSFORM BUILT, never off the
    // resolved one: a rule that made its own finding disappear would be a
    // silenced check. Whether the reference actually reaches Postgres is
    // recorded beside it (`moot`) and is what decides blocking.
    for (const checked of state.checkedByTable.get(name) ?? []) {
      const value = compositeKey(checked.properties, emitted.source);
      // A NULL in ANY component satisfies the constraint unconditionally
      // (Postgres MATCH SIMPLE), and an absent key means the column takes its
      // default, which for every nullable foreign key here is NULL.
      if (value === null) continue;
      state.counters.references += 1;
      state.counters.exercised.add(checked.relation.constraint);
      if (checked.target.values.has(value)) continue;
      park(state.pending, checked, plan.collection, value, documentId, mootnessOf(emitted, checked));
    }
  });
}

/**
 * Does this reference survive into the row Postgres receives?
 *
 * `null` when it does — an ordinary orphan that will be attempted and refused,
 * and one that still BLOCKS. Otherwise the rule responsible, which is what an
 * operator reads to find out why the row is not there.
 *
 * There are exactly two ways to be moot, and they are decided on the COLUMN
 * rather than on the value. Two columns of one row can hold the SAME missing
 * parent — `device_sessions.active_account_id` and `background_secret_account_id`
 * are the live example — and only one of them has a rule. Matching on the value
 * would mark the other one answered as well, which is a real orphan quietly
 * cleared.
 */
function mootnessOf(emitted: ResolvedRow, checked: CheckedRelation): ResolutionRule | null {
  if (emitted.applied.length === 0) return null;

  // Attribution, in both branches: the rule DECLARED on this relation when it
  // fired, so a finding is answered by the rule written for it wherever one
  // exists.
  const declared = emitted.applied.find((application) =>
    checked.properties.includes(application.relation.property)
  );

  if (emitted.written === null) {
    // The row does not exist, so NO reference it carried can be violated —
    // including a relation nobody wrote a rule for. Attributed to the declared
    // rule if there is one, else deterministically to the rule that removed the
    // row, so a re-run reports the same one.
    if (declared !== undefined) return declared.relation.rule;
    const [first] = [...emitted.applied].sort((a, b) =>
      a.relation.rule.id < b.relation.rule.id ? -1 : a.relation.rule.id > b.relation.rule.id ? 1 : 0
    );
    return first?.relation.rule ?? null;
  }

  // The row survives, so a reference is moot only if the RESOLVED row no longer
  // carries it — read off the two rows rather than inferred from the rule.
  const written = emitted.written;
  const removed = checked.properties.some(
    (property) => written[property] !== emitted.source[property]
  );
  if (!removed) return null;
  return declared?.relation.rule ?? null;
}

/** The primary-key value of a row, for the cascade check. `null` when it has none. */
function keyOf(row: Record<string, unknown>, application: AppliedOrphanResolution): string | null {
  const key = singlePrimaryKeyProperty(application.relation.table);
  if (key === null) return null;
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

/** Fold one rule application into its relation's tally. */
function recordApplication(
  applied: Map<OrphanRelation, AppliedTally>,
  application: AppliedOrphanResolution,
  documentId: string,
  rowId: string | null
): void {
  let tally = applied.get(application.relation);
  if (tally === undefined) {
    tally = {
      relation: application.relation,
      rows: 0,
      values: new Set<string>(),
      droppedIds: new Set<string>(),
      documentIds: [],
    };
    applied.set(application.relation, tally);
  }
  tally.rows += 1;
  tally.values.add(application.value);
  if (application.relation.action === 'drop-row' && rowId !== null) tally.droppedIds.add(rowId);
  if (tally.documentIds.length < MAX_REPORTED_ORPHAN_DOCUMENT_IDS) {
    tally.documentIds.push(documentId);
  }
}

/**
 * The vacuity floor.
 *
 * A run with no collections to copy legitimately inspects nothing — discovery
 * has already said so — and is the one case that is not a failure.
 */
function assertNotVacuous(
  report: ReferentialIntegrityReport,
  plans: readonly PlannedCollection[]
): void {
  if (plans.length === 0) return;

  if (report.relationsInspected === 0) {
    throw new VacuousReferentialIntegrityError(
      report,
      `${plans.length} collection(s) were given but no foreign key was derived ` +
        'from the tables they write, and this schema declares many'
    );
  }
  if (report.collectionsInspected !== plans.length) {
    throw new VacuousReferentialIntegrityError(
      report,
      `${plans.length} collection(s) were given but only ` +
        `${report.collectionsInspected} were streamed, so some were never checked`
    );
  }
  const expected = plans.reduce((total, entry) => total + entry.documents, 0);
  if (expected > 0 && report.documentsInspected === 0) {
    throw new VacuousReferentialIntegrityError(
      report,
      `the source holds ${expected} document(s) across those collections but the ` +
        'traversal read none of them'
    );
  }
}

/** Remember a reference that had no target when its row was emitted. */
function park(
  pending: Map<string, PendingReference>,
  checked: CheckedRelation,
  collection: string,
  value: string,
  documentId: string,
  moot: ResolutionRule | null
): void {
  const key = `${checked.relation.constraint}${KEY_SEPARATOR}${value}`;
  const existing = pending.get(key);
  if (existing === undefined) {
    pending.set(key, {
      relation: checked.relation,
      collection,
      target: checked.target,
      value,
      documents: 1,
      mootDocuments: moot === null ? 0 : 1,
      mootRules: moot === null ? new Map() : new Map([[moot.id, moot]]),
      documentIds: [documentId],
    });
    return;
  }
  existing.documents += 1;
  if (moot !== null) {
    existing.mootDocuments += 1;
    existing.mootRules.set(moot.id, moot);
  }
  if (existing.documentIds.length < MAX_REPORTED_ORPHAN_DOCUMENT_IDS) {
    existing.documentIds.push(documentId);
  }
}

/** Fold one confirmed orphan into its relation's accumulator. */
function recordOrphan(
  orphans: Map<string, OrphanAccumulator>,
  entry: PendingReference
): void {
  let accumulator = orphans.get(entry.relation.constraint);
  if (accumulator === undefined) {
    accumulator = {
      relation: entry.relation,
      collection: entry.collection,
      documents: 0,
      mootDocuments: 0,
      mootRules: new Map(),
      distinctValues: 0,
      documentsByValue: new Map(),
      values: [],
    };
    orphans.set(entry.relation.constraint, accumulator);
  }
  accumulator.documents += entry.documents;
  accumulator.mootDocuments += entry.mootDocuments;
  for (const [ruleId, rule] of entry.mootRules) accumulator.mootRules.set(ruleId, rule);
  accumulator.distinctValues += 1;
  accumulator.documentsByValue.set(
    entry.value,
    (accumulator.documentsByValue.get(entry.value) ?? 0) + entry.documents
  );
  if (accumulator.values.length < MAX_REPORTED_ORPHAN_VALUES) {
    accumulator.values.push({
      value: entry.value,
      documents: entry.documents,
      mootDocuments: entry.mootDocuments,
      documentIds: entry.documentIds,
    });
  }
}

/**
 * The rule that ANSWERS this relation's orphans, or `undefined`.
 *
 * Three conditions, and all three are measurements rather than declarations:
 *
 * 1. The origin is `absent-in-source`. A `dropped-by-the-copy` or
 *    `undetermined` orphan can never be answered — a rule written against
 *    migration data loss would bury it, which is the one thing this audit
 *    exists to prevent.
 * 2. EVERY offending row is moot: the row is not written, or the offending
 *    value is not on the row that is. A single row that still reaches Postgres
 *    carries a `23503` with it, so a partial answer is no answer.
 * 3. Exactly ONE rule accounts for them, so the report can name it. Several is
 *    fail-closed rather than picking one to print.
 *
 * The fourth condition — that the rule acted on exactly these rows and NO
 * others — cannot be seen from one relation, because a rule firing on a row
 * whose parent EXISTS leaves no orphan here to notice.
 * {@link describeOverreach} checks that direction against the rule's own tally.
 */
function resolvingRule(
  entry: OrphanAccumulator,
  origin: OrphanOrigin
): ResolutionRule | undefined {
  // `parent-removed-by-rule` is answerable for the same reason
  // `absent-in-source` is: both say the parent is provably not coming, and
  // neither is data the MIGRATION lost by accident. `dropped-by-the-copy` and
  // `undetermined` remain unanswerable.
  if (origin !== 'absent-in-source' && origin !== 'parent-removed-by-rule') return undefined;
  if (entry.documents === 0 || entry.mootDocuments !== entry.documents) return undefined;
  if (entry.mootRules.size !== 1) return undefined;
  return [...entry.mootRules.values()][0];
}

/** The value a row carries for an ordered set of columns, or null when any is absent. */
function compositeKey(
  properties: readonly string[],
  row: Record<string, unknown>
): string | null {
  const parts: string[] = [];
  for (const property of properties) {
    const value = row[property];
    if (value === null || value === undefined) return null;
    parts.push(typeof value === 'string' ? value : String(value));
  }
  return parts.join(KEY_SEPARATOR);
}

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

/**
 * Decide WHERE the missing parent went, from what the pass measured.
 *
 * The whole verdict rests on one measured property of the plan that feeds the
 * referenced table: did every source document produce exactly one primary row,
 * keyed by its own `_id`? When it did, that table's `id` column IS the set of
 * source `_id`s, so a value missing from it is a document missing from the
 * SOURCE — proven, not assumed, and with no second query.
 *
 * Everything that does not clear that bar is `undetermined`, never
 * `absent-in-source`. Reporting pre-existing debt where the migration actually
 * lost data is the one error that must not happen here: it invites a resolution
 * rule to bury the loss.
 */
function classifyOrigin(
  relation: Relation,
  emission: PlanEmission | undefined,
  targetFed: boolean,
  /** Every value this relation could not resolve, uncapped. */
  missingValues: readonly string[],
  /** Primary keys documented rules removed, per table. */
  droppedIdsByTable: ReadonlyMap<string, ReadonlySet<string>>
): { origin: OrphanOrigin; reason: string } {
  if (!targetFed || emission === undefined) {
    return {
      origin: 'undetermined',
      reason:
        `No collection in this run feeds ${relation.targetTableName}, so the ` +
        'audit has nothing to compare against and cannot say whether the parent ' +
        'is absent from MongoDB or simply not being migrated. Check whether the ' +
        'feeding collection is missing from the source.',
    };
  }

  // A rule that REMOVED rows from this table leaves its ids a strict subset of
  // the source ids, so a value missing from it no longer proves the document is
  // missing from Mongo. Checked before the drop test below because the two have
  // opposite meanings and only this one is deliberate.
  if (emission.primaryRowsDroppedByRule > 0) {
    const removed = droppedIdsByTable.get(emission.table) ?? new Set<string>();
    const accounted = missingValues.filter((value) => removed.has(value));
    // ALL of them, or none of the certainty. A relation whose missing values are
    // a MIX of rule-removed parents and something else cannot be answered by
    // pointing at the rule, so it stays undetermined and blocks.
    if (missingValues.length > 0 && accounted.length === missingValues.length) {
      return {
        origin: 'parent-removed-by-rule',
        reason:
          `Every one of the ${missingValues.length} missing ` +
          `${emission.table} id(s) is a row a documented rule REMOVED in this ` +
          'run — the source holds the parent; this migration is what takes it ' +
          'away. That is a decision already made and already reported by id ' +
          'under its own rule, not pre-existing debt and not data loss. What is ' +
          'left to decide is only what happens to the rows pointing at it.',
      };
    }
    return {
      origin: 'undetermined',
      reason:
        `A documented rule removed ${emission.primaryRowsDroppedByRule} row(s) ` +
        `from ${emission.table}, so its ids are a SUBSET of the ` +
        `\`${emission.collection}\` document ids — but only ${accounted.length} of ` +
        `the ${missingValues.length} missing value(s) here are ids that rule is ` +
        'on record as removing. The rest are missing for some other reason, so ' +
        'this cannot be read as either pre-existing debt or a known removal.',
    };
  }

  const dropped = droppedDocuments(emission);
  if (dropped > 0) {
    return {
      origin: 'dropped-by-the-copy',
      reason:
        `The \`${emission.collection}\` transform read ${emission.documentsRead} ` +
        `document(s) and emitted only ${emission.primaryRowsEmitted} row(s) into ` +
        `${emission.table}, so ${dropped} document(s) were DROPPED by the ` +
        'migration itself. That is data loss, not pre-existing debt: fix the ' +
        'TRANSFORM. A resolution rule here would bury the loss.',
    };
  }

  // The referenced column has to BE the target table's primary key for the
  // source-`_id` argument to hold at all — that is the column the emission
  // measurement proved carries the document `_id`. Eleven relations in this
  // schema reference a non-key column (`signed_records.record_id`,
  // `update_assets.sha256`, `app_updates.update_id`,
  // `moderation_policies.policy_version`).
  const targetsPrimaryKey =
    emission.primaryKeyProperty !== null &&
    relation.targetColumns.length === 1 &&
    relation.targetColumns[0]?.property === emission.primaryKeyProperty;
  if (!targetsPrimaryKey) {
    const column = relation.targetColumns.map((entry) => entry.sqlName).join(', ');
    return {
      origin: 'undetermined',
      reason:
        `This relation references ${relation.targetTableName}.${column}, which is ` +
        'not the row\'s primary key, so "no row carries this value" does not ' +
        'reduce to "no source document has this `_id`". Every ' +
        `${emission.collection} document did produce its row, so nothing was ` +
        'dropped — but a parent the transform DERIVED a different value for ' +
        'would look identical to an absent one. Check by hand which it is.',
    };
  }

  if (!emissionIsFaithful(emission)) {
    return {
      origin: 'undetermined',
      reason:
        `The \`${emission.collection}\` transform emitted one row per document ` +
        `(${emission.primaryRowsEmitted} of ${emission.documentsRead}) but only ` +
        `${emission.primaryRowsKeyedByOwnId} of them carried the document's own ` +
        '`_id` as `id`, so the primary key column is not a faithful image of the ' +
        'source ids and a missing value cannot be read as a missing document.',
    };
  }

  return {
    origin: 'absent-in-source',
    reason:
      `Every one of the ${emission.documentsRead} \`${emission.collection}\` ` +
      `document(s) produced exactly one ${emission.table} row keyed by its own ` +
      '`_id`, so that table\'s ids ARE the source ids — and this value is not ' +
      'among them. MongoDB does not hold the parent and never checked; the ' +
      'reference was already dangling there. Nothing was lost by the migration: ' +
      'the decision is what happens to the REFERENCING row.',
  };
}

/** A plan that silently dropped documents. Its own finding, because it is its own bug. */
function describeDropFinding(emission: PlanEmission): AuditFinding {
  const dropped = droppedDocuments(emission);
  return {
    collection: emission.collection,
    kind: 'dropped-document',
    detail:
      `The ${emission.collection} transform read ${emission.documentsRead} ` +
      `document(s) and emitted only ${emission.primaryRowsEmitted} row(s) into ` +
      `${emission.table}: ${dropped} document(s) would be SILENTLY LOST by the ` +
      'copy. `plan.ts` states the invariant this breaks — "there is deliberately ' +
      'no skip-this-document return value; a silently dropped document is the ' +
      'failure this whole migration exists to avoid". This is a bug in the ' +
      'TRANSFORM, not in the data, and no resolution rule may answer it.',
    documents: dropped,
    // Which documents were skipped is not knowable from a count, and inventing
    // a sample would be worse than an honest none — the transform is where to
    // look, and the transform is named above.
    sampleIds: [],
  };
}

/**
 * A documented rule that acted on rows this pass found NO orphan for.
 *
 * The guard against a widened predicate. A rule is supposed to fire only on a
 * reference whose parent the source does not hold, and this pass builds the set
 * of such references independently — from the rows the transforms emit, not
 * from the pre-pass the rule consults. When the rule acted on more rows than
 * that set contains, or on a value that is not in it, it fired on a row whose
 * parent EXISTS: it is deleting or altering live data.
 *
 * That is a finding no rule may ever answer, for the same reason
 * `dropped-document` is: a rule clearing it would be the migration agreeing with
 * itself.
 */
function describeOverreach(
  applied: ReadonlyMap<OrphanRelation, AppliedTally>,
  orphansByConstraint: ReadonlyMap<string, OrphanAccumulator>
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const tally of applied.values()) {
    const relation = relationForColumn(tally.relation.table, tally.relation.property);
    const orphans = orphansByConstraint.get(relation.constraint);
    const orphanRows = orphans?.documents ?? 0;
    const unexplained = [...tally.values].filter(
      (value) => !(orphans?.documentsByValue.has(value) ?? false)
    );
    if (tally.rows <= orphanRows && unexplained.length === 0) continue;

    findings.push({
      collection: tally.relation.collection,
      kind: 'resolution-overreach',
      detail:
        `\`${tally.relation.rule.id}\` acted on ${tally.rows} row(s) of ` +
        `${relation.constraint}, but this pass found only ${orphanRows} row(s) ` +
        'whose parent is actually missing' +
        (unexplained.length === 0
          ? ''
          : ` — and ${unexplained.length} of the values it acted on name a ` +
            `${relation.targetTableName} row the migration DOES produce, e.g. ` +
            `${unexplained.slice(0, SAMPLE_LIMIT).map((value) => JSON.stringify(value)).join(', ')}`) +
        '. The rule fired on a row whose parent EXISTS, which means it is ' +
        'removing or altering live production data. Its predicate is wrong, or ' +
        'the parent set it reads is. No resolution rule may answer this: the ' +
        'copy is refused until the two agree.',
      documents: tally.rows,
      sampleIds: tally.documentIds.slice(0, SAMPLE_LIMIT),
    });
  }

  return findings.sort((a, b) => (a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0));
}

/**
 * What each row-dropping rule removed, and what its removals could orphan.
 *
 * "Dropping a `bundles` row orphans nothing" is a claim about the FK graph, so
 * it is answered from the graph this file already derives rather than from
 * memory — and the rows are then checked against the orphans this same pass
 * found, so a drop that DOES orphan something is named here instead of arriving
 * as a second `23503` at copy time.
 */
function describeDropCascades(
  applied: ReadonlyMap<OrphanRelation, AppliedTally>,
  relations: readonly Relation[],
  orphansByConstraint: ReadonlyMap<string, OrphanAccumulator>,
  /** The rule answering each constraint, where one does. */
  answeredBy: ReadonlyMap<string, ResolutionRule | undefined>
): DropCascade[] {
  const cascades: DropCascade[] = [];

  for (const tally of applied.values()) {
    if (tally.relation.action !== 'drop-row') continue;
    const inbound = relations.filter(
      (relation) => relation.targetTableName === tally.relation.tableName
    );
    const orphanedByDrop: {
      constraint: string;
      documents: number;
      resolvedBy?: ResolutionRule;
    }[] = [];
    for (const relation of inbound) {
      const orphans = orphansByConstraint.get(relation.constraint);
      if (orphans === undefined) continue;
      let documents = 0;
      for (const [value, rows] of orphans.documentsByValue) {
        if (tally.droppedIds.has(value)) documents += rows;
      }
      if (documents === 0) continue;
      const resolvedBy = answeredBy.get(relation.constraint);
      orphanedByDrop.push({
        constraint: relation.constraint,
        documents,
        ...(resolvedBy === undefined ? {} : { resolvedBy }),
      });
    }
    cascades.push({
      rule: tally.relation.rule,
      table: tally.relation.tableName,
      rowsDropped: tally.rows,
      inboundConstraints: inbound.map((relation) => relation.constraint),
      orphanedByDrop,
    });
  }

  return cascades.sort((a, b) => (a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0));
}

/** The relation as an operator reads it: `bundles.user_id -> users.id`. */
export function describeRelationColumns(relation: Relation): string {
  const from = relation.columns.map((column) => column.sqlName).join(', ');
  const to = relation.targetColumns.map((column) => column.sqlName).join(', ');
  const wrap = relation.columns.length > 1;
  return (
    `${relation.tableName}.${wrap ? `(${from})` : from} -> ` +
    `${relation.targetTableName}.${wrap ? `(${to})` : to}`
  );
}

/**
 * What the schema's own `ON DELETE` says about answering these orphans, and
 * therefore what is on the table.
 *
 * Never a resolution, and deliberately never phrased as one. The audit's job is
 * to put the decision in front of a human with the facts attached.
 */
function recommendation(orphans: RelationOrphans): string {
  const relation = orphans.relation;
  switch (orphans.resolvability) {
    case 'not-null':
      return (
        `Every referencing column is NOT NULL, so NO value satisfies this ` +
        'constraint — NULL is not available and the named row does not exist. ' +
        'The ways forward are to restore the missing parent rows in the source, ' +
        'or to write down what happens to these rows as a documented rule. Both ' +
        'are decisions, which is why there is no override flag.'
      );
    case 'nullable-set-null':
      return (
        `The column is NULLABLE and this relation declares ON DELETE SET NULL, so ` +
        'NULL is already the schema\'s own written answer to losing the parent: ' +
        'writing NULL for these rows would land them exactly where the declared ' +
        'policy puts a row whose parent is deleted. That is still a decision ' +
        'about production data and it is NOT applied here — encode it as a ' +
        'ResolutionRule if it is the one you want.'
      );
    case 'nullable-other-action':
      return (
        `The column is NULLABLE, so NULL is representable — but this relation ` +
        `declares ON DELETE ${relation.onDelete}, which says the opposite: losing ` +
        'the parent takes the row with it (or refuses), never leaves it behind ' +
        'holding NULL. Writing NULL here would invent a policy the schema does ' +
        'not declare, and the action this ON DELETE is analogous to would DROP ' +
        'rows — which this migration must never do silently. A human has to say ' +
        'which of the two it is.'
      );
  }
}

/** One relation's orphans, in the shape the other audits report in. */
function describeFinding(orphans: RelationOrphans): AuditFinding {
  const relation = orphans.relation;
  const quoted = orphans.values
    .slice(0, SAMPLE_LIMIT)
    .map((value) => JSON.stringify(value.value))
    .join(', ');
  const elided =
    orphans.distinctValues > SAMPLE_LIMIT
      ? ` (and ${orphans.distinctValues - SAMPLE_LIMIT} more distinct value(s))`
      : '';

  return {
    collection: orphans.collection,
    kind: 'referential-integrity',
    detail:
      // Nullability rides in the header rather than only in the recommendation
      // below: it is the fact that decides what answers are even available, and
      // an ANSWERED finding prints no recommendation.
      `${describeRelationColumns(relation)} (${relation.constraint}, ` +
      `${relation.nullable ? 'NULLABLE' : 'NOT NULL'}, ON DELETE ` +
      `${relation.onDelete}): ${orphans.documents} row(s) built from ` +
      `${orphans.collection} name a ${relation.targetTableName} row the migration ` +
      `does not produce, across ${orphans.distinctValues} distinct value(s) — ` +
      `e.g. ${quoted}${elided}. ` +
      (orphans.targetUnfed
        ? `No collection in this run feeds ${relation.targetTableName}, so it will ` +
          'hold no rows at all and EVERY reference to it dangles. '
        : '') +
      `Postgres would reject these rows with a 23503 naming ${relation.constraint}. ` +
      // WHERE the parent went comes before what to do about it, because it
      // decides whether "what to do about it" is even the right question: a
      // parent the MIGRATION lost is fixed in the transform, never here.
      `ORIGIN ${orphans.origin}: ${orphans.originReason} ` +
      // The recommendation is for a decision nobody has made yet. Printing
      // "write down what happens to these rows as a documented rule" under a
      // finding a documented rule already answers would read as advice to do
      // something that is done.
      (orphans.resolvedBy !== undefined
        ? `DECIDED: \`${orphans.resolvedBy.id}\` answers this — its decision, and ` +
          'every row it acts on, are reported with the rule rather than repeated here.'
        : orphans.origin === 'absent-in-source'
          ? recommendation(orphans)
          : orphans.origin === 'parent-removed-by-rule'
            ? // The origin is SETTLED here — what is missing is a decision. Saying
              // "settle the origin first" would send the operator to look for
              // something already known.
              'The parent is removed by a documented rule, so the origin is not in ' +
              'doubt: what is missing is a decision about THESE rows. The schema ' +
              `declares ON DELETE ${orphans.relation.onDelete} for this relation, ` +
              'which is what a cascade rule would follow — but a cascade is ' +
              'declared per relation and deliberately never general, so one has to ' +
              'be written for this one or the removal itself reconsidered.'
            : 'No resolution rule may be written for this until the origin is ' +
              'settled — one written against migration data loss would hide it.') +
      // What the rules actually DID to these rows, measured on the emitted rows
      // rather than taken from the rule. A partial answer is printed as one: it
      // is exactly the shape that would otherwise look resolved and then fail.
      (orphans.mootDocuments === 0
        ? ''
        : ` ${orphans.mootDocuments} of the ${orphans.documents} row(s) never ` +
          'reach Postgres — a documented rule removes the row or nulls the ' +
          'column' +
          (orphans.mootDocuments === orphans.documents
            ? '.'
            : `, and the remaining ${orphans.documents - orphans.mootDocuments} ` +
              'WOULD still be attempted, so this finding still BLOCKS.')),
    documents: orphans.documents,
    sampleIds: orphans.values.flatMap((value) => value.documentIds).slice(0, SAMPLE_LIMIT),
    ...(orphans.resolvedBy === undefined ? {} : { resolvedBy: orphans.resolvedBy }),
  };
}
