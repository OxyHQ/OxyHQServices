/**
 * `user_app_data` — a generic per-user key/value store, keyed by
 * `(user_id, namespace, key)`.
 *
 * Ported from `models/UserAppData.ts`. The first consumer is the Oxy Academy
 * progress tracker on the website, but the shape is intentionally generic so any
 * Oxy surface can persist small bits of cross-device app state against the
 * signed-in user without growing a bespoke schema. Sizing and abuse controls
 * live in the routes (body cap, per-user rate limit); the table enforces only
 * the structural invariants.
 *
 * ## `value` is the one honest `jsonb` in this batch
 *
 * It is `Schema.Types.Mixed` — genuinely shape-less by design, since the whole
 * point is that a caller stores whatever its feature needs. That is exactly the
 * case `CONVENTIONS.md` reserves `jsonb` for, and no CHECK constrains its type.
 *
 * **`{}` must survive the round trip.** Mongoose sets `minimize: false` on this
 * schema precisely so an empty object is STORED rather than stripped to
 * absent — a progress record that legitimately has no entries yet is not the
 * same thing as no record. `jsonb` preserves it natively; the pin is in
 * `__tests__/socialGraph.test.ts` so a future switch to `json`, `text` or an
 * application-side "empty means null" shortcut goes red.
 *
 * ## The identifier validators became CHECK constraints
 *
 * `namespace` and `key` carried `match: /^[a-z0-9_-]{1,64}$/u` in Mongoose, so
 * every stored value already satisfies it and the constraint cannot reject a
 * backfilled row. Encoding it here is not the trim/lowercase case
 * `CONVENTIONS.md` warns about — that warning is about SILENT normalization,
 * where a CHECK would turn a value the setter used to repair into a 500. This
 * was already a hard validator that REJECTED, so moving it into the schema
 * changes nothing except that a backfill or a `psql` session can no longer
 * bypass it.
 *
 * The pattern subsumes Mongoose's `trim`, `lowercase` and `maxlength: 64` in one
 * expression: no uppercase, no whitespace, and 1–64 characters are all
 * unrepresentable outside it.
 */

import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, updatedAt } from './columns';
import { users } from './users';

/**
 * Allowed characters for `namespace` and `key`: lowercase letters, digits, `-`,
 * `_`. Mirrors `APP_DATA_IDENTIFIER_PATTERN` in `models/UserAppData.ts`, which
 * stays authoritative for the route-level validation until that model is
 * deleted; `__tests__/socialGraph.test.ts` holds the two in agreement.
 *
 * Written for Postgres's POSIX regex, which has no `/u` flag and no anchoring
 * shorthand — `^`/`$` are explicit and `~` is the case-SENSITIVE operator, which
 * is what makes the lowercase requirement real.
 */
export const APP_DATA_IDENTIFIER_SQL_PATTERN = '^[a-z0-9_-]{1,64}$';

export const userAppData = pgTable(
  'user_app_data',
  {
    id: generatedId(),
    /** The owner. Their data goes when the account does. */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The owning surface, e.g. `academy`. */
    namespace: text().notNull(),
    /** The entry within that surface. */
    key: text().notNull(),
    /** Whatever the caller stored. Shape-less by design; `{}` is a real value. */
    value: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per (user, namespace, key).
    unique('user_app_data_user_id_namespace_key_key').on(t.userId, t.namespace, t.key),
    // Mongo also declared `{userId, namespace}` for listing a whole namespace.
    // Dropped as redundant: it is a leading prefix of the unique above, and a
    // btree serves any leading prefix — the same call `push_tokens` made.

    check(
      'user_app_data_namespace_check',
      sql`${t.namespace} ~ ${sql.raw(`'${APP_DATA_IDENTIFIER_SQL_PATTERN}'`)}`
    ),
    check(
      'user_app_data_key_check',
      sql`${t.key} ~ ${sql.raw(`'${APP_DATA_IDENTIFIER_SQL_PATTERN}'`)}`
    ),
  ]
);
