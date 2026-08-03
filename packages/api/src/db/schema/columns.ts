/**
 * Shared Column Builders
 *
 * The handful of column shapes that repeat across every table. They exist so a
 * decision made once (ids are `text`, timestamps are `timestamptz`, `updated_at`
 * is maintained in the application) is expressed once and cannot drift table to
 * table — see `CONVENTIONS.md` for the reasoning behind each.
 *
 * Nothing here is a wrapper for its own sake: each is used by many tables, and
 * each encodes a rule that a hand-written column could silently get wrong.
 */

import type { PgColumn } from 'drizzle-orm/pg-core';
import { customType, text, timestamp } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/**
 * The row type a named-column selection object produces.
 *
 * ```ts
 * const COLUMNS = { id: users.id, avatar: users.avatar } as const;
 * type Row = SelectedRow<typeof COLUMNS>;   // { id: string; avatar: string | null }
 * ```
 *
 * Exists because the obvious spelling is WRONG in the dangerous direction:
 * `column['_']['data']` is the non-null data type, so a hand-written
 * `{ [K in keyof T]: T[K]['_']['data'] }` silently declares every nullable
 * column non-nullable — a `null` then flows into code that was type-checked as
 * if it could not, and `tsc` never says a word. Nullability lives in the
 * separate `notNull` flag, which is what this reads.
 */
export type SelectedRow<T extends Record<string, PgColumn>> = {
  [K in keyof T]: T[K]['_']['notNull'] extends true
    ? T[K]['_']['data']
    : T[K]['_']['data'] | null;
};

/**
 * `timestamptz`, always, handed back to TypeScript as a `Date`.
 *
 * `timestamp` WITHOUT a time zone would reinterpret the stored value in the
 * session's `TimeZone` on every read; Mongo `Date` is an absolute UTC instant,
 * so anything but `timestamptz` silently changes what the value means.
 */
export const timestamptz = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * `created_at` — set by the database on insert, never updated.
 *
 * Both Mongoose shapes (`timestamps: true` and a hand-declared
 * `createdAt: { default: Date.now }`) map here: the distinction is a Mongoose
 * implementation detail with no Postgres counterpart.
 */
export const createdAt = () => timestamptz().notNull().defaultNow();

/**
 * `updated_at` — maintained by the APPLICATION on every `db.update()`, matching
 * what Mongoose did. Deliberately not a trigger: a trigger is invisible in this
 * schema, and it would also fire during backfill/maintenance writes and
 * overwrite the historical value we are trying to preserve.
 */
export const updatedAt = () =>
  timestamptz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * Primary key: `text` holding a 24-char ObjectId hex for every row that existed
 * before the cutover, and a uuid v7 for every row created after it.
 *
 * The id is generated HERE rather than by a database `DEFAULT` because Postgres
 * 17 has no native `uuidv7()` (it lands in 18); the alternatives are the
 * `pg_uuidv7` extension or a hand-maintained plpgsql function, both of which
 * would have to be installed identically in dev, CI and RDS before the first
 * migration could run. Generating in the application also means the id is known
 * before the insert round-trip, so a parent and its children can be built in one
 * batch.
 *
 * Rows inserted by raw SQL get no id — intended: the backfill supplies `_id`
 * verbatim, which is exactly how every existing foreign key survives.
 */
export const generatedId = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * `bytea` — raw bytes.
 *
 * postgres.js decodes `bytea` to a `Uint8Array`; every consumer in this codebase
 * (and `@simplewebauthn/server`) works in `Buffer`, which IS a `Uint8Array`, so
 * writes pass straight through and reads are wrapped once here rather than at
 * each call site.
 */
export const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (value) => value,
  fromDriver: (value) => Buffer.from(value),
});

/**
 * `tsvector` — the replacement for a Mongo text index.
 *
 * Drizzle has no built-in for it. Every use is a GENERATED column plus a GIN
 * index, never a value the application writes, so the TypeScript type is the
 * `string` Postgres renders it as and there is no `toDriver` direction to get
 * wrong. Declared here because "Mongo text index becomes `tsvector` + GIN" is a
 * schema-wide rule, not one table's detail — a `LIKE '%…%'` scan is not the
 * port of a text index.
 *
 * The generating expression MUST use the two-argument
 * `to_tsvector('<config>', …)` with a literal configuration: the one-argument
 * form reads `default_text_search_config` at runtime and is therefore STABLE,
 * which Postgres refuses in a generated column.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => 'tsvector',
});

/**
 * A `const` tuple rendered as the value list of a SQL `in (...)`.
 *
 * Every closed value set in this schema is `text` plus a CHECK derived from the
 * SAME tuple that types the column (`CONVENTIONS.md`, "Closed value sets"), so
 * the two cannot drift. The values must be SQL literals rather than bound
 * parameters — a CHECK constraint cannot carry a parameter — which is why they
 * go through `sql.raw`; the COLUMN is always interpolated as a drizzle Column so
 * its SQL name still comes from the casing setting rather than being spelled out
 * here.
 *
 * Safe only because every caller passes a locally-declared `as const` tuple of
 * identifier-shaped literals. It is not an escaping routine and must never be
 * handed a runtime value.
 */
export function inList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * A `const` tuple rendered as a SQL `array[…]::text[]` literal — the ARRAY
 * analogue of {@link inList}, for a `text[]` column whose elements come from a
 * closed value set. The CHECK is written `<@` (containment), so an empty array
 * trivially satisfies it.
 *
 * It lives here rather than beside its first caller because `users` needs it
 * too, and `schema/applications.ts` — where it used to live — imports `users`.
 * Same safety contract as {@link inList}: `const` tuples only, never a runtime
 * value.
 */
export function textArrayLiteral(values: readonly string[]): string {
  return `array[${inList(values)}]::text[]`;
}
