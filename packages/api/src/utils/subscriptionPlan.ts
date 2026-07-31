import type { Types } from 'mongoose';
import BillingSubscription from '../models/BillingSubscription';
import Subscription from '../models/Subscription';
import { inForceSubscriptionFilter } from './subscriptionStatus';

export type SubscriptionPlanTier = 'basic' | 'pro' | 'business';

const PREMIUM_PLANS: ReadonlySet<SubscriptionPlanTier> = new Set(['pro', 'business']);

function normalizePlanName(planName: string | undefined | null): SubscriptionPlanTier {
  const normalized = planName?.trim().toLowerCase();
  if (normalized === 'pro') return 'pro';
  if (normalized === 'business') return 'business';
  return 'basic';
}

/**
 * Resolve the user's effective subscription plan tier.
 *
 * Stripe writes to `BillingSubscription`; the legacy `Subscription` collection
 * may still hold rows from before the billing cutover. Check billing first, then
 * fall back to legacy so premium gates stay accurate for paying subscribers.
 *
 * The legacy lookup filters on DATES (`inForceSubscriptionFilter`), never on the
 * stored `status`: a lapsed row keeps `status: 'active'` until the lifecycle sweep
 * reconciles it, and trusting that value would grant paid entitlements — premium
 * profile colour, the larger storage quota — inside that window.
 */
export async function resolveUserSubscriptionPlan(
  userId: string | Types.ObjectId,
  now: Date = new Date(),
): Promise<SubscriptionPlanTier> {
  const userIdString = String(userId);

  const billingSubscription = await BillingSubscription.findOne({
    userId: userIdString,
    status: { $in: ['active', 'trialing'] },
  })
    .select('plan.name')
    .lean<{ plan?: { name?: string } }>();

  if (billingSubscription?.plan?.name) {
    return normalizePlanName(billingSubscription.plan.name);
  }

  try {
    const legacySubscription = await Subscription.findOne({
      userId,
      ...inForceSubscriptionFilter(now),
      plan: { $in: ['pro', 'business'] },
    })
      .select('plan')
      .lean<{ plan?: SubscriptionPlanTier }>();

    if (legacySubscription?.plan) {
      return normalizePlanName(legacySubscription.plan);
    }
  } catch {
    // Non-ObjectId user ids should not throw through premium gates.
  }

  return 'basic';
}

/** Whether the plan tier unlocks premium-only profile features (e.g. oxy color). */
export function isPremiumSubscriptionPlan(plan: SubscriptionPlanTier): boolean {
  return PREMIUM_PLANS.has(plan);
}
