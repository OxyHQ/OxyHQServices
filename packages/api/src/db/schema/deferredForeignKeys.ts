/**
 * Foreign Keys This Schema Cannot Declare Yet
 *
 * The migration is landing table by table, so a table can arrive before its
 * parent does — `blocks.user_id` points at `users`, which no module in this
 * schema defines yet. Drizzle cannot express a forward reference, so the column
 * ships without its constraint.
 *
 * "Add the FK when `users` lands" written in a comment is a convention nothing
 * checks, and those get violated. So it is written HERE as data, and
 * `__tests__/foreignKeys.test.ts` turns it into a gate: the moment the parent
 * table appears in the schema barrel, the test fails and names the exact column
 * whose constraint is now missing. The ledger deletes itself as the port
 * completes — an empty `DEFERRED_FOREIGN_KEYS` is the finish line.
 *
 * `ID_COLUMNS_WITHOUT_FOREIGN_KEY` is the separate, PERMANENT list: `*_id`
 * columns that will never carry a constraint, each with the reason. Between the
 * two lists plus the real constraints, every id-shaped column in the schema is
 * classified — which is what lets `foreignKeys.test.ts` fail on a NEW one
 * nobody decided about.
 */

import type { PgColumn, PgTable, UpdateDeleteAction } from 'drizzle-orm/pg-core';
import { blocks } from './blocks';
import { bookmarks } from './bookmarks';
import { appAffinitySeenEvents } from './appAffinitySeenEvents';
import { labels } from './labels';
import { pushTokens } from './pushTokens';
import { webauthnCredentials } from './webauthnCredentials';

/** A foreign key that is decided but not yet expressible. */
export interface DeferredForeignKey {
  readonly table: PgTable;
  readonly column: PgColumn;
  /** SQL name of the parent table, e.g. `users`. */
  readonly parentTable: string;
  /** Column on the parent, e.g. `id`. */
  readonly parentColumn: string;
  /** Decided per relation — never left to default. */
  readonly onDelete: UpdateDeleteAction;
  /** Why that `ON DELETE`, in one line. */
  readonly reason: string;
}

/** An id-shaped column that will never carry a foreign key. */
export interface IdColumnWithoutForeignKey {
  readonly table: PgTable;
  readonly column: PgColumn;
  readonly reason: string;
}

export const DEFERRED_FOREIGN_KEYS: readonly DeferredForeignKey[] = [
  {
    table: blocks,
    column: blocks.userId,
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'A deleted account cannot be blocking anyone.',
  },
  {
    table: blocks,
    column: blocks.blockedId,
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'A block on a deleted account has nothing left to enforce.',
  },
  {
    table: bookmarks,
    column: bookmarks.userId,
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'Bookmarks are private to their owner and outlive nothing.',
  },
  {
    table: pushTokens,
    column: pushTokens.userId,
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'A deleted account must stop receiving push notifications.',
  },
  {
    table: pushTokens,
    column: pushTokens.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason:
      'NULL here means "not scoped to any application", so SET NULL would ' +
      'promote a dead app\'s install into the unscoped delivery set instead of ' +
      'retiring it.',
  },
  {
    table: labels,
    column: labels.userId,
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'A label belongs to exactly one mailbox owner.',
  },
  {
    table: webauthnCredentials,
    column: webauthnCredentials.userId,
    parentTable: 'users',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'A passkey with no account behind it can never be asserted.',
  },
  {
    table: appAffinitySeenEvents,
    column: appAffinitySeenEvents.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'The ledger only dedupes ingest for an application that still exists.',
  },
];

export const ID_COLUMNS_WITHOUT_FOREIGN_KEY: readonly IdColumnWithoutForeignKey[] = [
  {
    table: bookmarks,
    column: bookmarks.postId,
    reason:
      '`Post` is Mention\'s model in Mention\'s database. There is no local ' +
      'table to reference, and the relation is enforced by neither store today.',
  },
  {
    table: pushTokens,
    column: pushTokens.deviceId,
    reason:
      'A central DEVICE id (the `DeviceSession.deviceId` id space), not the ' +
      'primary key of any row. Nothing to reference.',
  },
  {
    table: webauthnCredentials,
    column: webauthnCredentials.credentialID,
    reason:
      'The browser-supplied base64url WebAuthn credential handle. Id-shaped by ' +
      'name only — it identifies an authenticator credential, not an Oxy row.',
  },
  {
    table: appAffinitySeenEvents,
    column: appAffinitySeenEvents.eventId,
    reason:
      'An id minted by the CONSUMING application for its own event. Oxy stores ' +
      'it to dedupe and never resolves it to anything.',
  },
];
