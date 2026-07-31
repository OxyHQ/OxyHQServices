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
 * 4. **`__tests__/protectedColumns.test.ts` is the gate.** It holds the `users`
 *    entry against the exact set Mongoose marked `select: false`, refuses a
 *    stale entry, checks the runtime filter, and scans `src/` for the two shapes
 *    that return every column implicitly — a bare `select()` and the relational
 *    `db.query.<table>` API — against any table in this registry.
 *
 * ## Scope: the title, not the Mongoose keyword
 *
 * `select: false` is where this started, and `users` is held to that exact set.
 * It is not the boundary. The subject is the module title, and a column can
 * qualify without Mongoose ever having marked it — `sessions.access_token` and
 * `auth_sessions.session_token` are live bearer credentials that Mongoose left
 * fully selectable, and Mongo's call sites only avoided leaking them by
 * hand-building each DTO field by field. Drizzle's `select()` does not, so the
 * port is where the guard has to be added rather than inherited. Each entry
 * below says which it is.
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
import { authSessions } from './authSessions';
import { messages } from './messages';
import { sessions } from './sessions';
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
 * `sessions` columns holding a LIVE BEARER CREDENTIAL.
 *
 * These were NOT `select: false` in Mongoose — nothing was, on that model — and
 * they are here anyway, because the registry's subject is the module title
 * ("columns that must not reach a client"), not the Mongoose keyword that used
 * to approximate it. `users.refresh_token` is already protected for exactly this
 * reason ("a bearer credential; serializing it hands over the account"); the
 * same value on `sessions` is the same credential.
 *
 * The reason this matters MORE after the port than before: the Mongo call sites
 * build device DTOs field by field from a `Session` document
 * (`devices.controller.ts:73-90`), and the natural drizzle transliteration of
 * that is `db.select().from(sessions)` followed by a `.map(...)` — which now
 * carries two live tokens into whatever the mapper forgets to drop.
 */
export const SESSIONS_PROTECTED_COLUMNS = [
  'accessToken',
  'refreshToken',
  'previousRefreshToken',
] as const;

/**
 * `auth_sessions` columns holding a LIVE BEARER CREDENTIAL.
 *
 * `session_token` is the 128-bit secret the originating client alone holds, and
 * `POST /auth/session/claim` takes NO bearer — possession of this value is the
 * whole authorization. The sibling `authorize_code` is deliberately absent from
 * this list: it is the PUBLIC handle that travels in the QR, and approving with
 * it is separately key-signed.
 */
export const AUTH_SESSIONS_PROTECTED_COLUMNS = ['sessionToken'] as const;

/**
 * `messages` columns that must not reach a client.
 *
 * The first four were `select: false` in `models/Message.ts`. The fifth was
 * not, and could not have been — Mongo's text index was a separate structure,
 * not a field on the document. `search_vector` is GENERATED from `text`, and a
 * `tsvector` stores every lexeme with its position, so returning it hands back a
 * largely reconstructable copy of the very body the other four entries exist to
 * withhold. A protection that covers the source but not its derivative is not a
 * protection.
 */
export const MESSAGES_PROTECTED_COLUMNS = [
  'text',
  'html',
  'headers',
  'encryptedBody',
  'searchVector',
] as const;

/**
 * The registry, keyed by SQL table name.
 */
export const PROTECTED_COLUMNS_BY_TABLE = {
  users: USERS_PROTECTED_COLUMNS,
  sessions: SESSIONS_PROTECTED_COLUMNS,
  auth_sessions: AUTH_SESSIONS_PROTECTED_COLUMNS,
  messages: MESSAGES_PROTECTED_COLUMNS,
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
  {
    table: sessions,
    column: sessions.accessToken,
    reason:
      "This session's live bearer token. Serializing it hands the account to " +
      'whoever reads the response.',
  },
  {
    table: sessions,
    column: sessions.refreshToken,
    reason:
      'The refresh half of the same credential, and the longer-lived one — it ' +
      'mints fresh access tokens for as long as the session lives.',
  },
  {
    table: sessions,
    column: sessions.previousRefreshToken,
    reason:
      'Still accepted during the rotation grace window, so it is a live ' +
      'credential too — being superseded is not being revoked.',
  },
  {
    table: authSessions,
    column: authSessions.sessionToken,
    reason:
      'The secret claim credential for a pending authorization. ' +
      '`POST /auth/session/claim` requires no bearer, so this value alone ' +
      "exchanges an approved request for the approving account's access token.",
  },
  {
    table: messages,
    column: messages.text,
    reason:
      'The plain-text body. A list view returns hundreds of rows and needs ' +
      'none of it; shipping it turns every inbox page into a full mail export.',
  },
  {
    table: messages,
    column: messages.html,
    reason: 'The HTML body — same exposure as the plain-text one, same size problem.',
  },
  {
    table: messages,
    column: messages.headers,
    reason:
      'Every header as received, including the third-party SMTP `Received:` ' +
      'IPs this column is the one sanctioned place to retain. Never a default read.',
  },
  {
    table: messages,
    column: messages.encryptedBody,
    reason:
      'Body ciphertext. Handing it out gives an offline target to anyone who ' +
      'later obtains the recipient key.',
  },
  {
    table: messages,
    column: messages.searchVector,
    reason:
      'Generated FROM `text`. A tsvector carries every lexeme with its ' +
      'position, so returning it largely reconstructs the body the entry above withholds.',
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
