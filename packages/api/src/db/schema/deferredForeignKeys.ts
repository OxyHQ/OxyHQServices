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
import { billingSubscriptions } from './billingSubscriptions';
import { billingTransactions } from './billingTransactions';
import { bookmarks } from './bookmarks';
import { appAffinitySeenEvents } from './appAffinitySeenEvents';
import { authCodes } from './authCodes';
import { authSessions } from './authSessions';
import { devicePairingSessions } from './devicePairingSessions';
import { deviceSessionAccounts } from './deviceSessionAccounts';
import { deviceSessions } from './deviceSessions';
import { identityBindings } from './identityBindings';
import { conductStrikes } from './conductStrikes';
import { moderationEffects } from './moderationEffects';
import { notifications } from './notifications';
import { pushTokens } from './pushTokens';
import { securityActivities } from './securityActivities';
import { sessions } from './sessions';
import { transactions } from './transactions';
import { userAuthMethods } from './userAuthMethods';
import { userCredits } from './userCredits';
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
    table: authCodes,
    column: authCodes.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason:
      'An authorization code is a grant TO an application. With the ' +
      'application gone there is nobody to exchange it, and the code is ' +
      'unusable within five minutes anyway.',
  },
  {
    table: authSessions,
    column: authSessions.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason:
      'The whole approval screen — name, icon, scopes — is resolved from the ' +
      'application. A request that can no longer name who is asking must not ' +
      'be approvable.',
  },
  {
    table: identityBindings,
    column: identityBindings.applicationId,
    parentTable: 'applications',
    parentColumn: 'id',
    onDelete: 'cascade',
    reason:
      'A binding is scoped to one application and never cross-application, so ' +
      'it proves nothing once that application is gone. Note applications are ' +
      "SOFT-deleted (`status: 'deleted'`) on the normal path, so this fires " +
      'only on a hard delete.',
  },
  {
    table: identityBindings,
    column: identityBindings.credentialId,
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
      'AUDIT pointer only, deliberately not part of the binding check — a ' +
      'credential rotation must not invalidate a binding the user consented ' +
      'to. NULL already means "not recorded", so SET NULL loses the audit ' +
      'trail and nothing else; CASCADE would delete the evidence a past ' +
      'moderation effect rests on.',
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

  // ---- the auth/session cluster ------------------------------------------
  //
  // Three distinct shapes live below, and they are not interchangeable:
  //   (a) a row's OWN natural key, id-shaped by name only;
  //   (b) the central DEVICE id space, which names a device rather than a row;
  //   (c) a reference by natural key whose lifecycle is INDEPENDENT on purpose,
  //       where every available ON DELETE would change behaviour.
  {
    table: sessions,
    column: sessions.sessionId,
    reason:
      "(a) This row's own public handle — the UUID minted for it and embedded " +
      'in every access token. Other tables reference it; it references nothing.',
  },
  {
    table: sessions,
    column: sessions.deviceId,
    reason:
      '(b) The central DEVICE id space (`device_sessions.device_id`), not the ' +
      'primary key of any row. A session is routinely created before that ' +
      'device has a `device_sessions` row at all.',
  },
  {
    table: deviceSessions,
    column: deviceSessions.deviceId,
    reason:
      "(a) The device's own identifier — per web origin, per native app group. " +
      'It is this row\'s natural key, which is why it is UNIQUE here and a ' +
      'loose value everywhere else.',
  },
  {
    table: deviceSessionAccounts,
    column: deviceSessionAccounts.sessionId,
    reason:
      '(c) Names a `sessions` row by its natural key, with lifecycles that are ' +
      'independent BY DESIGN: the application never deletes a session (only ' +
      'the expiry sweep does), and when one goes the entry must SURVIVE so the ' +
      'mint path answers "dead session" instead of the device\'s account set ' +
      'silently shrinking — a shrink that would also skip the `revision` bump ' +
      'every real membership change makes. CASCADE would cause exactly that ' +
      'shrink; RESTRICT would stop the sweep.',
  },
  {
    table: authCodes,
    column: authCodes.deviceId,
    reason:
      '(b) Central device id, threaded so the token exchange lands on the ' +
      'device the flow started from. Not a row id.',
  },
  {
    table: authSessions,
    column: authSessions.deviceId,
    reason:
      '(b) Central device id of the browser that STARTED the request, resolved ' +
      'from an optional device token. Not a row id.',
  },
  {
    table: authSessions,
    column: authSessions.authorizedSessionId,
    reason:
      '(c) The `sessions.session_id` of the session minted on approval. Same ' +
      'independent lifecycle as `device_session_accounts.session_id`, on a row ' +
      'that is itself swept an hour later.',
  },
  {
    table: authSessions,
    column: authSessions.finalizedAuthCodeId,
    reason:
      '(c) A RESERVATION, not a reference: `finalizeCommonsOAuth` mints the id ' +
      'and writes it in the SAME atomic update that spends the request, before ' +
      'the `auth_codes` row exists — and the mint may then fail, leaving an id ' +
      'that never becomes a row. A constraint would reject that write and ' +
      'destroy the single-use guarantee; SET NULL would be worse, resurrecting ' +
      "a spent request as un-finalized when the code's own 5-minute sweep ran " +
      'and letting it mint a SECOND authorization code.',
  },
  {
    table: devicePairingSessions,
    column: devicePairingSessions.pairingId,
    reason:
      "(a) This row's own single-use QR handle, which doubles as the HKDF salt " +
      'for the transfer key. Id-shaped by name only.',
  },
  {
    table: identityBindings,
    column: identityBindings.localPrincipalId,
    reason:
      "The APPLICATION's own identifier for a person, in the application's own " +
      'id space. Oxy stores it to match a claim against a binding and never ' +
      'resolves it to anything local.',
  },
  {
    table: securityActivities,
    column: securityActivities.deviceId,
    reason:
      '(b) Central device id the event happened on. An audit trail must keep ' +
      'naming the device that was removed, which is precisely one of the ' +
      'events it records.',
  {
    table: transactions,
    column: transactions.itemId,
    reason:
      'What was purchased, in the CONSUMING application\'s id space. There is ' +
      'no local table to reference, and `item_type` — also free-form — is what ' +
      'names the space it belongs to.',
  },
  {
    table: userCredits,
    column: userCredits.stripeCustomerId,
    reason:
      "Stripe's identifier for the customer. Oxy stores it to talk to Stripe " +
      'and resolves it only back to this same row.',
  },
  {
    table: billingSubscriptions,
    column: billingSubscriptions.stripeCustomerId,
    reason: "Stripe's identifier for the customer. Not a row in this database.",
  },
  {
    table: billingSubscriptions,
    column: billingSubscriptions.stripeSubscriptionId,
    reason:
      "Stripe's identifier for the subscription. This table IS the local " +
      'mirror of it; the authority is Stripe.',
  },
  {
    table: billingSubscriptions,
    column: billingSubscriptions.stripePriceId,
    reason:
      "Stripe's identifier for the price. The catalogue it belongs to is a code " +
      'constant (`billing.ts:74`), not a table.',
  },
  {
    table: billingTransactions,
    column: billingTransactions.stripeCustomerId,
    reason: "Stripe's identifier for the customer. Not a row in this database.",
  },
  {
    table: billingTransactions,
    column: billingTransactions.stripePaymentIntentId,
    reason:
      "Stripe's identifier for the payment intent. Not a row in this database.",
  },
  {
    table: billingTransactions,
    column: billingTransactions.stripeSubscriptionId,
    // This one COULD be a foreign key — `billing_subscriptions.stripe_subscription_id`
    // is unique, and Postgres will reference a unique column. It deliberately is
    // not: `billing_subscriptions` is a MIRROR that may legitimately be missing a
    // subscription (one created before the mirror existed, or under a price id
    // this deployment does not recognise), and a record of money actually
    // charged must never be refused because a local mirror is incomplete.
    reason:
      "Stripe's identifier for the subscription this payment covers. Pointing " +
      'it at the local mirror would let an incomplete mirror reject a real ' +
      'payment record; Stripe is the authority for both.',
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
