/**
 * What a single Mongo collection becomes in Postgres.
 *
 * `schema/CONVENTIONS.md` names this file's obligation directly: "The backfill
 * therefore needs an explicit collection → table map; write it out, one entry
 * per table." A plan is one entry of that map, plus everything the copy needs
 * that a bare name→name pair cannot express.
 *
 * ## Why a plan is more than `{ collection, table }`
 *
 * - **Child tables.** Several Mongo subdocument arrays became real tables. One
 *   document therefore produces rows in several tables, and the count check
 *   for a child table is a count of ARRAY ELEMENTS, not of documents. A plan
 *   declares which tables it fills so the verifier can tell "this table is
 *   empty because nothing fed it" from "this table is empty because the copy
 *   silently produced nothing".
 * - **Enum audits.** Mongoose never ran `runValidators`, so a live document can
 *   hold a value its own schema forbids — confirmed in this repo, where
 *   `status: 'restricted'` was written against an enum declaring three other
 *   values. A Postgres CHECK is enforced, so those rows are rejected. The audit
 *   runs `distinct()` per enum-backed column BEFORE any insert and reports
 *   every value the CHECK would refuse.
 * - **Uniqueness audits.** The Postgres schema adds case-insensitive unique
 *   indexes Mongo lacked the collation for. Two names differing only by case
 *   collide, and a collision surfaces as a `23505` naming an index rather than
 *   the two rows. The audit finds and reports the pairs first.
 *
 * ## Insert order is derived, never declared
 *
 * A plan does NOT carry a position. The runner topologically sorts the tables
 * by their real foreign keys, read from the drizzle metadata, so the order
 * cannot drift from the schema it has to satisfy. Self-referencing columns
 * (`users.parent_account_id`, `signed_records.prev`, …) are deferred to a
 * second UPDATE pass by the same derivation.
 */

import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
// TYPE-ONLY, and it has to stay that way: `resolutions.ts` imports
// `allowedValues` from this file at runtime, so a value import here would close
// the cycle. `import type` is erased entirely, so there is none.
import type { ResolutionContext, ResolutionRule } from './resolutions';
import type { MongoDocument } from './values';

/** Collect a row for a table. Called once per row a document produces. */
export type Emit = (table: PgTable, row: Record<string, unknown>) => void;

/**
 * A closed value set to check a Mongo field against before inserting.
 *
 * `column` is the drizzle column; its allowed values are read from the column's
 * own `enumValues`, so the audit cannot drift from the CHECK it predicts.
 */
export interface EnumAudit {
  /** Dotted path of the field in the Mongo document. */
  readonly path: string;
  /** The Postgres column the value lands in. */
  readonly column: PgColumn;
  /**
   * The value an ABSENT field maps to, when the transform supplies a default.
   *
   * Declaring it means the audit does not report `null` as an illegal value for
   * a field the backfill is going to fill in — which would be a false positive
   * on every document written before the field existed.
   */
  readonly absentAs?: string;
  /**
   * The documented rule that says what the migration DOES with a value this
   * audit would otherwise block on.
   *
   * Declared here, against ONE path and ONE column, so a rule can never cover
   * a finding nobody attached it to. The audit still reports every offending
   * value with its count and ids — see `resolutions.ts` for why that is a
   * third way forward and not an override flag.
   */
  readonly resolvedBy?: ResolutionRule;
}

/**
 * How one column of a unique index is normalized before comparison.
 *
 * These are the three expressions this schema actually uses, and the audit has
 * to reproduce the RIGHT one per index rather than pick a default:
 *
 * | shape | example index |
 * |---|---|
 * | `exact` | `contacts_user_id_email_key` on `("user_id","email")` |
 * | `lower` | `labels_user_id_lower_name_key` on `("user_id",lower("name"))` |
 * | `lower-btrim` | `users_lower_email_key` on `(lower(btrim("email")))` |
 *
 * Guessing in either direction is harmful and asymmetric. Normalizing MORE than
 * the index does invents collisions and blocks a run over data Postgres would
 * accept — a gate that cries wolf gets disabled by whoever hits it next.
 * Normalizing LESS misses a real collision, and the run then fails on a `23505`
 * partway through, which is the outcome the audit exists to prevent.
 */
export type UniquenessNormalization = 'exact' | 'lower' | 'lower-btrim';

/** One column of a unique index, and how the index normalizes it. */
export interface UniquenessKeyPart {
  /** Dotted path of the field in the Mongo document. */
  readonly path: string;
  /** The expression wrapped around it in the index. */
  readonly normalize: UniquenessNormalization;
}

/**
 * A uniqueness constraint Postgres now enforces that Mongo did not, checked
 * against the live data before the copy.
 *
 * ## Rows with a NULL in any key part are EXCLUDED
 *
 * Postgres unique indexes are `NULLS DISTINCT` by default, so a row with a NULL
 * in any indexed column never conflicts — no matter how many other rows share
 * that shape. An audit that coalesced absent values to `''` would report every
 * such row as colliding with every other, which is a false positive on
 * precisely the columns most likely to be sparse (`users.public_key` on any
 * account without a Commons key). Measured: it fired on three of four fixture
 * accounts before this was fixed.
 */
export interface UniquenessAudit {
  /** The index this predicts, for the report. */
  readonly index: string;
  /** The columns forming the key, each with its own normalization. */
  readonly key: readonly UniquenessKeyPart[];
  /**
   * A PARTIAL index's predicate, written as a Mongo `$match` fragment over the
   * SOURCE documents — omit it for a total index.
   *
   * Without it the audit answers a WIDER question than the index asks: it groups
   * every document sharing the key, including rows the partial predicate
   * excludes, so a pair Postgres would happily accept is reported as a
   * collision. That is not merely noisy. A `resolvedBy` rule clears a group only
   * by acting on all but one of its rows, so the extra rows make a rule that
   * correctly handles the real collision fail to cover the group — and the
   * migration blocks on data that was never a problem. That is exactly what
   * `validation_requests_open_source_action_key` did.
   *
   * It must describe the rows as they will be AFTER the transform, not as the
   * source stores them, since that is what ends up in the index. Derive it from
   * the same constant the schema's predicate uses so the two cannot drift.
   */
  readonly where?: Readonly<Record<string, unknown>>;
  /**
   * The documented rule that decides which of the colliding rows survives.
   *
   * Declaring it is not enough: the audit asks the resolution whether the rule
   * actually acts on all but ONE of a given group's rows, so a group the rule
   * does not cover still blocks. Fail-closed, because a collision nobody wrote
   * a rule for is exactly the case a human has to look at.
   */
  readonly resolvedBy?: ResolutionRule;
}

/** One Mongo collection and everything the backfill needs to move it. */
export interface CollectionPlan {
  /**
   * The LIVE collection name, as `db.listCollections()` reports it.
   *
   * Mongoose derived most of these by pluralising the model name rather than
   * declaring them (`appaffinityeventseens` is not a word), so these are the
   * derived names, verified against the model registry — never a guess from
   * the table name.
   */
  readonly collection: string;
  /** The table this collection's documents become, one row per document. */
  readonly table: PgTable;
  /** Tables filled from this collection's subdocument arrays. */
  readonly childTables?: readonly PgTable[];
  /** Closed value sets to check before inserting. */
  readonly enumAudits?: readonly EnumAudit[];
  /** Uniqueness Postgres now enforces and Mongo did not. */
  readonly uniquenessAudits?: readonly UniquenessAudit[];
  /**
   * Build every row one document produces.
   *
   * Throwing is the sanctioned way to refuse a document: the runner catches it,
   * names the collection and the `_id`, and aborts. There is deliberately no
   * "skip this document" return value — a silently dropped document is the
   * failure this whole migration exists to avoid.
   *
   * `resolutions` carries the documented decisions (`resolutions.ts`) plus the
   * channel a transform REPORTS a degraded document through. It is declared on
   * the type even though most transforms ignore it, so every CALLER is forced
   * to supply one: the verifier computes its expectation by re-running this
   * transform, and a verifier running it with different resolutions than the
   * copy did would report every resolved row as a field-fidelity failure.
   */
  readonly transform: (doc: MongoDocument, emit: Emit, resolutions: ResolutionContext) => void;
}

/** A collection that is deliberately NOT migrated, and why. */
export interface ExcludedCollection {
  /** The live collection name. */
  readonly collection: string;
  /**
   * Why no data moves.
   *
   * An unexplained exclusion is how data goes missing quietly, so this is
   * required and is printed in the run report next to the document count the
   * collection actually holds.
   */
  readonly reason: string;
}

/** Every table a plan writes to — its own plus its children. */
export function planTables(plan: CollectionPlan): PgTable[] {
  return [plan.table, ...(plan.childTables ?? [])];
}

/** A table's SQL name. */
export function tableName(table: PgTable): string {
  return getTableConfig(table).name;
}

/** The allowed values of an enum-backed column, from the column itself. */
export function allowedValues(column: PgColumn): readonly string[] {
  const values = (column as unknown as { enumValues?: readonly string[] }).enumValues;
  if (!values || values.length === 0) {
    throw new Error(
      `Column ${column.name} has no enumValues — an EnumAudit on it would ` +
        'check nothing at all and pass vacuously'
    );
  }
  return values;
}
