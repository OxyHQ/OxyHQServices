/**
 * Foreign Keys This Schema Cannot Declare Yet
 *
 * The migration is landing table by table, so a table can arrive before its
 * parent does — `push_tokens.application_id` points at `applications`, which no
 * module in this schema defines yet. Drizzle cannot express a forward reference,
 * so the column ships without its constraint.
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
import { bookmarks } from './bookmarks';
import { appAffinitySeenEvents } from './appAffinitySeenEvents';
import { conductStrikes } from './conductStrikes';
import { moderationEffects } from './moderationEffects';
import { notifications } from './notifications';
import { pushTokens } from './pushTokens';
import { userAuthMethods } from './userAuthMethods';
import { userLocations } from './userLocations';
import { users } from './users';
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

/**
 * `users` landed, so every entry that owed it a constraint has been converted to
 * a real `.references()` and deleted from this list — `blocks.user_id`,
 * `blocks.blocked_id`, `bookmarks.user_id`, `push_tokens.user_id`,
 * `labels.user_id` and `webauthn_credentials.user_id`. What remains is owed to
 * four tables that have not landed yet: `applications`,
 * `application_credentials`, `identity_bindings` and `reputation_transactions`.
 */
export const DEFERRED_FOREIGN_KEYS: readonly DeferredForeignKey[] = [
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
    table: appAffinitySeenEvents,
    column: appAffinitySeenEvents.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason: 'The ledger only dedupes ingest for an application that still exists.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'restrict',
    reason:
      'The emitting application is resolved from its credential and is part of ' +
      'the provenance an effect exists to record. Deleting it must fail rather ' +
      'than erase or orphan the audit trail of what it caused.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.credentialId,
    parentTable: 'application_credentials',
    parentColumn: 'id',
    onDelete: 'set null',
    reason:
      'Which credential the event arrived on is provenance detail, not the ' +
      'effect itself; NULL already means "not recorded" on rows predating the ' +
      'field. Unlike `application_id`, a rotated-out credential may legitimately ' +
      'be removed without invalidating the effect.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.bindingId,
    parentTable: 'identity_bindings',
    parentColumn: 'id',
    onDelete: 'restrict',
    reason:
      'The binding is what PROVED the identity the effect landed on — no ' +
      'binding, no effect. An effect whose proof of identity vanished is ' +
      'unauditable, so the binding cannot be deleted while one cites it.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.transactionId,
    parentTable: 'reputation_transactions',
    parentColumn: 'id',
    onDelete: 'restrict',
    reason:
      'The ledger row the effect wrote. The ledger is append-only and reverses ' +
      'rather than deletes, so a delete here would mean the points moved with ' +
      'no record of it.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.reversalTransactionId,
    parentTable: 'reputation_transactions',
    parentColumn: 'id',
    onDelete: 'restrict',
    reason:
      'The compensating entry an appeal produced. `SET NULL` would make a ' +
      'reversed effect read as never-reversed, which is a worse lie than a ' +
      'refused delete; the ledger never deletes anyway.',
  },
  {
    table: conductStrikes,
    column: conductStrikes.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'set null',
    reason:
      'Which application\'s report started the incident is attribution, and the ' +
      'column is already nullable — a strike stands on its own decision, so an ' +
      'unattributed one is a real state rather than a corrupted one.',
  },
  {
    table: conductStrikes,
    column: conductStrikes.transactionId,
    parentTable: 'reputation_transactions',
    parentColumn: 'id',
    onDelete: 'restrict',
    reason:
      'The ledger transaction the strike accompanies. Same reasoning as the ' +
      'effect: the ledger reverses rather than deletes.',
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
  {
    table: users,
    column: users.federationActorId,
    reason:
      "`FederatedActor._id` in the CONSUMING app's database (Mention's), not " +
      'in this one. Oxy stores it and never resolves it.',
  },
  {
    table: userAuthMethods,
    column: userAuthMethods.methodCredentialId,
    reason:
      'The browser-supplied base64url WebAuthn credential handle, mirrored ' +
      'from `webauthn_credentials.credential_id`. It identifies an ' +
      'authenticator credential, not an Oxy row.',
  },
  {
    table: userLocations,
    column: userLocations.placeId,
    reason:
      "A third-party geocoder's identifier for a place (Nominatim, Google " +
      'Places). Opaque, external, and never dereferenced by Oxy.',
  },
  {
    table: userLocations,
    column: userLocations.osmId,
    reason:
      'An OpenStreetMap element id, meaningful only together with `osm_type`. ' +
      'External to Oxy entirely.',
  },
  {
    table: notifications,
    column: notifications.entityId,
    reason:
      'Polymorphic, discriminated by `entity_type`. Two of the three types ' +
      '(`post`, `reply`) name rows in MENTION\'s database; the third ' +
      '(`profile`) names a user, but a foreign key cannot be conditional on a ' +
      'sibling column\'s value.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.eventId,
    reason:
      "The emitting moderation system's transport event id. Oxy stores it to " +
      'answer a redelivery and never resolves it to a row here.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.incidentId,
    reason:
      'The CROSS-TENANT incident id. The incident is the moderation service\'s ' +
      'own unit and has no table in this database — that is the point of it ' +
      'being cross-tenant.',
  },
  {
    table: moderationEffects,
    column: moderationEffects.caseId,
    reason: "A case in the moderation service's own store. Not a row here.",
  },
  {
    table: moderationEffects,
    column: moderationEffects.decisionId,
    reason:
      'The published decision. Its CONTENTS are deliberately not stored here — ' +
      '`proof_hash` is the provenance — so there is nothing to reference.',
  },
  {
    table: conductStrikes,
    column: conductStrikes.incidentId,
    reason: 'Same cross-tenant incident id as on `moderation_effects`.',
  },
  {
    table: conductStrikes,
    column: conductStrikes.decisionId,
    reason: 'Same external decision id as on `moderation_effects`.',
  },
];
