/**
 * Columns That Must Not Reach a Client
 *
 * Mongoose had `select: false`: a column so marked was absent from every query
 * result unless a caller asked for it BY NAME. Eleven columns across `User` and
 * `Message` relied on it, and two of them (`hashedEmail`, `hashedPhone`) carried
 * a SECOND guard — a `delete` in both `toJSON` transforms.
 *
 * Drizzle enumerates columns explicitly, so a naive port keeps NEITHER guard:
 * `db.select().from(users)` returns the raw phone number, the contact-discovery
 * hashes and the refresh token. This module is the single global replacement,
 * decided once for every table and every repo rather than per model.
 *
 * ## The mechanism
 *
 * 1. **The registry is data** (`PROTECTED_COLUMNS_BY_TABLE`), one entry per
 *    column with the reason it is protected — the same shape as
 *    `deferredForeignKeys.ts`, and for the same reason: a rule written only in a
 *    comment is a rule nothing checks.
 *
 * 2. **`publicColumns(table)` is the sanctioned read.**
 *    `db.select(publicColumns(users)).from(users)` omits every protected column
 *    AT THE TYPE LEVEL — the resulting row type has no `phone` property at all,
 *    so a serializer that tries to read one fails `tsc` rather than shipping it.
 *    That is the part a convention cannot give you.
 *
 * 3. **Opting in is explicit and greppable.** A path that legitimately needs a
 *    protected column names it:
 *    `db.select({ id: users.id, phone: users.phone }).from(users)`. There is
 *    deliberately no helper for this — the whole point is that it reads
 *    differently from an ordinary select.
 *
 * 4. **`__tests__/protectedColumns.test.ts` is the gate.** It holds the registry
 *    against the exact set Mongoose marked `select: false`, refuses a stale
 *    entry, checks the runtime filter, and scans `src/` for the two shapes that
 *    return every column implicitly — a bare `select()` and the relational
 *    `db.query.<table>` API — against any table in this registry.
 *
 * ## What this does NOT replace
 *
 * The `toJSON` transform is the API RESPONSE contract (`ret.id = _id`, and the
 * deletes of `password`, `_id`, `hashedEmail`, `hashedPhone`). It must be
 * reproduced at the serializer, and it is the second of the two guards
 * `hashedEmail` / `hashedPhone` have always had. This module restores the first.
 */

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `users` columns that were `select: false` in `models/User.ts`.
 *
 * TypeScript PROPERTY names, because that is what a drizzle selection object is
 * keyed by — `sqlColumnName` is for talking to the catalogue, not for this.
 */
export const USERS_PROTECTED_COLUMNS = [
  'phone',
  'hashedEmail',
  'hashedPhone',
  'refreshToken',
  'emailSignature',
  'autoForwardTo',
  'autoForwardKeepCopy',
] as const;

/**
 * The registry, keyed by SQL table name.
 *
 * `Message` adds four more entries when it lands; the shape is already here so
 * that port is one line and cannot invent a second mechanism.
 */
export const PROTECTED_COLUMNS_BY_TABLE = {
  users: USERS_PROTECTED_COLUMNS,
} as const;

/** A protected column, with the reason it is one. */
export interface ProtectedColumn {
  readonly table: PgTable;
  readonly column: PgColumn;
  /** Why it must not appear in a default read, in one line. */
  readonly reason: string;
}

/**
 * The same registry as objects, with reasons — what the gate reports and what a
 * reader consults. `PROTECTED_COLUMNS_BY_TABLE` is the machine-readable half;
 * the test asserts the two agree, so neither can drift.
 */
export const PROTECTED_COLUMNS: readonly ProtectedColumn[] = [
  {
    table: users,
    column: users.phone,
    reason:
      'The raw phone number. Private to its owner; public profile endpoints ' +
      'match on the hash instead and must never see this.',
  },
  {
    table: users,
    column: users.hashedEmail,
    reason:
      'Contact-discovery matching token. Returning it would turn every ' +
      'profile response into an offline dictionary attack on the email.',
  },
  {
    table: users,
    column: users.hashedPhone,
    reason:
      'Same as the email hash, and worse — the phone number space is small ' +
      'enough to enumerate outright.',
  },
  {
    table: users,
    column: users.refreshToken,
    reason: 'A bearer credential. Serializing it hands over the account.',
  },
  {
    table: users,
    column: users.emailSignature,
    reason:
      "The owner's private mail configuration. Visible to them, never on " +
      'anyone else\'s view of the profile.',
  },
  {
    table: users,
    column: users.autoForwardTo,
    reason:
      'Discloses a second address the owner controls, and that their mail is ' +
      'being forwarded at all.',
  },
  {
    table: users,
    column: users.autoForwardKeepCopy,
    reason:
      'Only meaningful next to `auto_forward_to`, and leaks the same fact — ' +
      'that forwarding is configured.',
  },
];

/** SQL names of the tables that own at least one protected column. */
export type ProtectedTableName = keyof typeof PROTECTED_COLUMNS_BY_TABLE;

/** The protected property names of `T`, or `never` if it owns none. */
type ProtectedNameOf<T extends PgTable> = T['_']['name'] extends ProtectedTableName
  ? (typeof PROTECTED_COLUMNS_BY_TABLE)[T['_']['name']][number]
  : never;

/** `T`'s columns with every protected one removed, at the type level. */
export type PublicColumns<T extends PgTable> = Omit<T['_']['columns'], ProtectedNameOf<T>>;

/**
 * Every column of `table` a client may see.
 *
 * ```ts
 * const rows = await db.select(publicColumns(users)).from(users);
 * rows[0].phone; // Property 'phone' does not exist — a compile error, not a leak
 * ```
 *
 * A table with no registry entry gets all of its columns, so this is safe to use
 * everywhere and stays correct the moment a column is added to the registry.
 */
export function publicColumns<T extends PgTable>(table: T): PublicColumns<T> {
  const name = getTableName(table);
  const withheld = new Set<string>(
    isProtectedTableName(name) ? PROTECTED_COLUMNS_BY_TABLE[name] : []
  );

  const selection: Record<string, PgColumn> = {};
  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (withheld.has(property)) continue;
    selection[property] = column;
  }

  // The one cast in this module: the loop above removes exactly the keys
  // `PublicColumns<T>` removes, which the type system cannot follow through
  // `Object.entries`. `__tests__/protectedColumns.test.ts` re-checks the
  // equivalence at runtime so the cast cannot quietly become a lie.
  return selection as PublicColumns<T>;
}

/** Whether `name` is a table in the registry. */
function isProtectedTableName(name: string): name is ProtectedTableName {
  return name in PROTECTED_COLUMNS_BY_TABLE;
}
