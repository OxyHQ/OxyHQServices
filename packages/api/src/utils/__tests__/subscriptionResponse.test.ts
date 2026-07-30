import { formatSubscriptionResponse } from '../subscriptionResponse';
import type { IBillingSubscription } from '../../models/BillingSubscription';
import type { ISubscription } from '../../models/Subscription';

describe('formatSubscriptionResponse', () => {
  it('prefers an active billing subscription over legacy rows', () => {
    const billing = {
      userId: 'user-1',
      status: 'active' as const,
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      plan: { name: 'pro', creditsPerMonth: 1000, price: 1000, currency: 'usd' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } satisfies Pick<
      IBillingSubscription,
      | 'userId'
      | 'status'
      | 'currentPeriodStart'
      | 'currentPeriodEnd'
      | 'cancelAtPeriodEnd'
      | 'plan'
      | 'createdAt'
      | 'updatedAt'
    >;

    const legacy = {
      plan: 'basic',
      status: 'active',
      userId: 'user-1',
      toJSON: () => ({ plan: 'basic', status: 'active', userId: 'user-1' }),
    } as unknown as ISubscription;

    expect(formatSubscriptionResponse(billing, legacy)).toEqual({
      plan: 'pro',
      status: 'active',
      userId: 'user-1',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-02-01T00:00:00.000Z',
      autoRenew: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('maps trialing billing subscriptions to active status for Accounts UI', () => {
    const billing = {
      userId: 'user-1',
      status: 'trialing' as const,
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
      plan: { name: 'business', creditsPerMonth: 5000, price: 5000, currency: 'usd' },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } satisfies Pick<
      IBillingSubscription,
      | 'userId'
      | 'status'
      | 'currentPeriodStart'
      | 'currentPeriodEnd'
      | 'cancelAtPeriodEnd'
      | 'plan'
      | 'createdAt'
      | 'updatedAt'
    >;

    expect(formatSubscriptionResponse(billing, null)).toMatchObject({
      plan: 'business',
      status: 'active',
      autoRenew: false,
    });
  });

  it('falls back to legacy subscription rows when billing is absent', () => {
    const legacy = {
      plan: 'pro',
      status: 'active',
      userId: { toString: () => 'user-1' },
      startDate: new Date('2025-12-01T00:00:00.000Z'),
      endDate: new Date('2026-01-01T00:00:00.000Z'),
      autoRenew: true,
      toJSON() {
        return {
          plan: 'pro',
          status: 'active',
          userId: 'user-1',
          startDate: this.startDate,
          endDate: this.endDate,
          autoRenew: true,
        };
      },
    } as unknown as ISubscription;

    expect(formatSubscriptionResponse(null, legacy)).toMatchObject({
      plan: 'pro',
      status: 'active',
      userId: 'user-1',
      autoRenew: true,
    });
  });

  it('returns the basic fallback when neither billing nor legacy rows exist', () => {
    expect(formatSubscriptionResponse(null, null)).toEqual({ plan: 'basic' });
  });
});
