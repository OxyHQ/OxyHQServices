import type { IBillingSubscription } from '../models/BillingSubscription';
import type { ISubscription, SubscriptionStatus } from '../models/Subscription';
import type { SubscriptionPlanTier } from './subscriptionPlan';
import { deriveSubscriptionStatus } from './subscriptionStatus';

export interface SubscriptionResponse {
  plan: SubscriptionPlanTier;
  status?: SubscriptionStatus;
  userId?: string;
  startDate?: string;
  endDate?: string;
  autoRenew?: boolean;
  paymentMethod?: string;
  latestInvoice?: string;
  features?: ISubscription['features'];
  createdAt?: string;
  updatedAt?: string;
}

function normalizePlanName(planName: string | undefined | null): SubscriptionPlanTier {
  const normalized = planName?.trim().toLowerCase();
  if (normalized === 'pro') return 'pro';
  if (normalized === 'business') return 'business';
  return 'basic';
}

function mapBillingStatus(
  status: IBillingSubscription['status'],
): SubscriptionResponse['status'] {
  if (status === 'canceled') return 'canceled';
  if (status === 'active' || status === 'trialing') return 'active';
  return 'active';
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Normalize billing + legacy subscription rows into the legacy
 * `GET /subscription/:userId` response shape consumed by Accounts.
 *
 * Stripe writes to `BillingSubscription`; the legacy `Subscription` collection
 * may still hold rows from before the billing cutover. Billing wins.
 *
 * A legacy row's reported `status` is DERIVED from its dates rather than echoed
 * from storage, so a row that lapsed since the last lifecycle reconciliation is
 * reported as `expired` rather than as still active.
 */
export function formatSubscriptionResponse(
  billing: Pick<
    IBillingSubscription,
    | 'plan'
    | 'status'
    | 'userId'
    | 'currentPeriodStart'
    | 'currentPeriodEnd'
    | 'cancelAtPeriodEnd'
    | 'createdAt'
    | 'updatedAt'
  > | null,
  legacy: ISubscription | null,
  now: Date = new Date(),
): SubscriptionResponse {
  if (billing) {
    return {
      plan: normalizePlanName(billing.plan?.name),
      status: mapBillingStatus(billing.status),
      userId: billing.userId,
      startDate: toIsoString(billing.currentPeriodStart),
      endDate: toIsoString(billing.currentPeriodEnd),
      autoRenew: !billing.cancelAtPeriodEnd,
      createdAt: toIsoString(billing.createdAt),
      updatedAt: toIsoString(billing.updatedAt),
    };
  }

  if (legacy) {
    const json = typeof legacy.toJSON === 'function' ? legacy.toJSON() : legacy;
    return {
      plan: normalizePlanName(json.plan),
      status: deriveSubscriptionStatus(
        { status: json.status, endDate: json.endDate },
        now,
      ),
      userId: json.userId?.toString?.() ?? String(json.userId),
      startDate: toIsoString(json.startDate),
      endDate: toIsoString(json.endDate),
      autoRenew: json.autoRenew,
      paymentMethod: json.paymentMethod,
      latestInvoice: json.latestInvoice,
      features: json.features,
      createdAt: toIsoString(json.createdAt),
      updatedAt: toIsoString(json.updatedAt),
    };
  }

  return { plan: 'basic' };
}
