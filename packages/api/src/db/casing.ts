/**
 * Column-Naming Authority
 *
 * Schema modules declare columns in camelCase and let drizzle derive the
 * snake_case SQL name. That derivation happens in THREE places that must agree
 * or queries reference columns the migrations never created: `drizzle()` in
 * `config/postgres.ts` (what queries reference), `drizzle-kit` in
 * `drizzle.config.ts` (what the DDL creates), and any code that needs the SQL
 * name for a catalogue lookup. All three read `DATABASE_CASING` from here, so
 * there is one setting rather than three copies to keep in lockstep.
 *
 * The trap this exists to close: `column.name` on a drizzle column is the
 * TypeScript PROPERTY name (`expiresAt`), not the SQL name (`expires_at`) —
 * casing is applied when SQL is built, not when the column is declared. Using
 * `column.name` in hand-written SQL produces `column "expiresAt" does not
 * exist` at runtime, and in a catalogue query it silently matches nothing.
 */

import type { Column } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import type { Casing } from 'drizzle-orm/utils';

/** The one naming convention, read by the runtime, the generator, and `sqlColumnName`. */
export const DATABASE_CASING: Casing = 'snake_case';

/** Drizzle's own converter, so this can never disagree with generated SQL. */
const casingCache = new CasingCache(DATABASE_CASING);

/**
 * The SQL name of a column — `expires_at` for a column declared as `expiresAt`.
 *
 * Honours an explicitly-named column (`text('legacy_name')`) exactly as drizzle
 * does, rather than re-deriving from the property name.
 */
export function sqlColumnName(column: Column): string {
  return casingCache.getColumnCasing(column);
}
