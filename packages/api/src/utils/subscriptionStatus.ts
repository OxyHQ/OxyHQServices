import type { FilterQuery } from 'mongoose';
import type { ISubscription, SubscriptionStatus } from '../models/Subscription';

/**
 * The lifecycle rule for the legacy `Subscription` collection — the single
 * definition of "is this subscription in force right now", shared by the
 * entitlement lookup (`utils/subscriptionPlan.ts`), the response serializer
 * (`utils/subscriptionResponse.ts`), the owner-facing controller
 * (`controllers/subscription.controller.ts`) and the reconciliation sweep
 * (`services/subscriptionLifecycle.service.ts`).
 *
 * The rule is DERIVED FROM DATES, never read off the stored `status`. A row can
 * legitimately sit past its `endDate` with `status: 'active'` between sweeps, and
 * an entitlement check that trusted the stored value would hand out paid features
 * inside that window. `status` is a materialized projection of this rule kept
 * accurate for reporting and queries — it is never the authority.
 *
 * `canceled` is terminal and set by an explicit user action, so it is never
 * re-derived from dates.
 *
 * Pure module: it imports the model only for its TYPES, so importing it never
 * registers a Mongoose model or pulls a connection into a consumer.
 */

/** The fields the lifecycle rule reads — everything else about a row is irrelevant to it. */
export type SubscriptionLifecycleFields = Pick<ISubscription, 'status' | 'endDate'>;

/**
 * Whether the subscription grants its paid entitlements at `now`.
 *
 * A row with no usable `endDate` grants nothing: a subscription that cannot say
 * when it ends cannot be shown to be in force.
 */
export function isSubscriptionInForce(
  subscription: SubscriptionLifecycleFields,
  now: Date = new Date(),
): boolean {
  if (subscription.status === 'canceled') {
    return false;
  }
  const endsAt = new Date(subscription.endDate).getTime();
  return Number.isFinite(endsAt) && endsAt > now.getTime();
}

/** The status the row SHOULD hold at `now`, given its dates. */
export function deriveSubscriptionStatus(
  subscription: SubscriptionLifecycleFields,
  now: Date = new Date(),
): SubscriptionStatus {
  if (subscription.status === 'canceled') {
    return 'canceled';
  }
  return isSubscriptionInForce(subscription, now) ? 'active' : 'expired';
}

/**
 * Mongo filter selecting the rows that are in force at `now` — the query-side
 * twin of {@link isSubscriptionInForce}. Both must move together.
 */
export function inForceSubscriptionFilter(now: Date = new Date()): FilterQuery<ISubscription> {
  return { status: { $ne: 'canceled' }, endDate: { $gt: now } };
}
