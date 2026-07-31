import Subscription, { type ISubscription } from '../models/Subscription';
import {
  deriveSubscriptionStatus,
  inForceSubscriptionFilter,
} from '../utils/subscriptionStatus';
import { logger } from '../utils/logger';

/**
 * Subscription lifecycle (legacy `Subscription` collection).
 *
 * A lapsed subscription is EXPIRED, never deleted — the row is the only record
 * that a user ever held a paid plan, and billing disputes, renewals and analytics
 * all read it. (This collection used to carry a TTL index on `endDate`, which
 * deleted the document outright the moment the period ended; see the note in
 * `models/Subscription.ts`.)
 *
 * Two mechanisms keep the stored `status` honest, mirroring `DevicePairingSession`:
 *
 *   1. LAZY EXPIRY ON READ — {@link findCurrentSubscription} persists the derived
 *      status whenever it reads a row whose stored value has drifted, so an
 *      owner-facing read never reports a stale status and never has to wait for a
 *      sweep tick.
 *   2. THE SWEEP — {@link sweepSubscriptionStatuses} reconciles rows nobody reads,
 *      so reporting queries that filter on `status` stay accurate.
 *
 * Neither is load-bearing for ENTITLEMENTS: every entitlement check derives from
 * `endDate` vs now (`utils/subscriptionStatus.ts`), so there is no window in which
 * a not-yet-reconciled row grants paid features.
 */

/** How often the reconciliation sweep runs (see `server.ts`). */
export const SUBSCRIPTION_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Persist the derived status when the stored one has drifted (lazy expiry on
 * read). Returns the same document, with an accurate `status`.
 */
async function reconcileStoredStatus(
  subscription: ISubscription,
  now: Date,
): Promise<ISubscription> {
  const derived = deriveSubscriptionStatus(subscription, now);
  if (subscription.status !== derived) {
    subscription.status = derived;
    await subscription.save();
  }
  return subscription;
}

/**
 * The subscription row that represents a user's current standing: the in-force
 * one if there is any, otherwise the most recent by `endDate`.
 *
 * Rows are retained now that lapsing no longer deletes them, so a plain
 * `findOne({ userId })` can surface an ancient lapsed row while a live one
 * exists — this picks deliberately instead.
 */
export async function findCurrentSubscription(
  userId: string,
  now: Date = new Date(),
): Promise<ISubscription | null> {
  const current =
    (await Subscription.findOne({ userId, ...inForceSubscriptionFilter(now) }).sort({
      endDate: -1,
    })) ?? (await Subscription.findOne({ userId }).sort({ endDate: -1 }));

  return current ? reconcileStoredStatus(current, now) : null;
}

export interface SubscriptionSweepResult {
  /** Rows whose period had ended while still marked `active`. */
  expired: number;
  /** Rows marked `expired` whose `endDate` now lies in the future (a renewal). */
  reactivated: number;
}

/**
 * Reconcile stored `status` with the derived truth for every drifted row.
 *
 * Idempotent — a second run over reconciled data modifies nothing — and it only
 * ever moves rows between `active` and `expired`. `canceled` is terminal and is
 * never touched, and no row is ever removed.
 */
export async function sweepSubscriptionStatuses(
  now: Date = new Date(),
): Promise<SubscriptionSweepResult> {
  const [lapsed, renewed] = await Promise.all([
    Subscription.updateMany(
      { status: 'active', endDate: { $lte: now } },
      { $set: { status: 'expired' } },
    ),
    Subscription.updateMany(
      { status: 'expired', endDate: { $gt: now } },
      { $set: { status: 'active' } },
    ),
  ]);

  const result: SubscriptionSweepResult = {
    expired: lapsed.modifiedCount,
    reactivated: renewed.modifiedCount,
  };

  if (result.expired > 0 || result.reactivated > 0) {
    logger.info('Subscription status sweep reconciled rows', {
      expired: result.expired,
      reactivated: result.reactivated,
    });
  }

  return result;
}
