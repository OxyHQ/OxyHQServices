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
import { pushTokens } from './pushTokens';
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
 * `applications`, which has not landed yet.
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
  },
];
