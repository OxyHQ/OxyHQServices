import type { SubscriptionLifecycleFields } from '../subscriptionStatus';
import {
  deriveSubscriptionStatus,
  inForceSubscriptionFilter,
  isSubscriptionInForce,
} from '../subscriptionStatus';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const YESTERDAY = new Date('2026-07-30T12:00:00.000Z');
const TOMORROW = new Date('2026-08-01T12:00:00.000Z');

function row(
  status: SubscriptionLifecycleFields['status'],
  endDate: Date,
): SubscriptionLifecycleFields {
  return { status, endDate };
}

describe('isSubscriptionInForce', () => {
  it('grants while the period is still running', () => {
    expect(isSubscriptionInForce(row('active', TOMORROW), NOW)).toBe(true);
  });

  it('does NOT grant once the period has ended, even while stored as active', () => {
    // The row keeps `status: 'active'` until the lifecycle sweep reconciles it.
    // Trusting that stored value is exactly how a lapsed subscription would keep
    // handing out paid entitlements.
    expect(isSubscriptionInForce(row('active', YESTERDAY), NOW)).toBe(false);
  });

  it('treats the instant of expiry as no longer in force', () => {
    expect(isSubscriptionInForce(row('active', NOW), NOW)).toBe(false);
  });

  it('never grants for a cancelled row, whatever its dates say', () => {
    expect(isSubscriptionInForce(row('canceled', TOMORROW), NOW)).toBe(false);
  });

  it('grants again when a renewal pushes endDate forward on an expired row', () => {
    expect(isSubscriptionInForce(row('expired', TOMORROW), NOW)).toBe(true);
  });

  it('does not grant when endDate is unusable', () => {
    const malformed = { status: 'active', endDate: new Date('not-a-date') } as SubscriptionLifecycleFields;
    expect(isSubscriptionInForce(malformed, NOW)).toBe(false);
  });
});

describe('deriveSubscriptionStatus', () => {
  it('reports a lapsed row as expired rather than echoing its stored status', () => {
    expect(deriveSubscriptionStatus(row('active', YESTERDAY), NOW)).toBe('expired');
  });

  it('reports a running row as active', () => {
    expect(deriveSubscriptionStatus(row('expired', TOMORROW), NOW)).toBe('active');
  });

  it('keeps cancelled terminal', () => {
    expect(deriveSubscriptionStatus(row('canceled', TOMORROW), NOW)).toBe('canceled');
    expect(deriveSubscriptionStatus(row('canceled', YESTERDAY), NOW)).toBe('canceled');
  });
});

describe('inForceSubscriptionFilter', () => {
  it('selects on dates and excludes cancelled rows', () => {
    expect(inForceSubscriptionFilter(NOW)).toEqual({
      status: { $ne: 'canceled' },
      endDate: { $gt: NOW },
    });
  });

  it('reads `now` rather than pinning a boot-time clock', () => {
    const later = new Date('2026-09-01T00:00:00.000Z');
    expect(inForceSubscriptionFilter(later)).toEqual({
      status: { $ne: 'canceled' },
      endDate: { $gt: later },
    });
  });
});
