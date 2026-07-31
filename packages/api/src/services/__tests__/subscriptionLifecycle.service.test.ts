const mockFindOne = jest.fn();
const mockUpdateMany = jest.fn();
const mockDeleteMany = jest.fn();
const mockDeleteOne = jest.fn();
const mockFindOneAndDelete = jest.fn();

jest.mock('../../models/Subscription', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    // Present so a sweep that DELETED instead of expiring would still run — and
    // fail the "never deletes" assertions below with the offending call named,
    // rather than blowing up on an undefined method.
    deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    deleteOne: (...args: unknown[]) => mockDeleteOne(...args),
    findOneAndDelete: (...args: unknown[]) => mockFindOneAndDelete(...args),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import type { ISubscription } from '../../models/Subscription';
import {
  findCurrentSubscription,
  sweepSubscriptionStatuses,
} from '../subscriptionLifecycle.service';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const LAPSED = new Date('2026-06-30T12:00:00.000Z');
const RUNNING = new Date('2026-08-31T12:00:00.000Z');

interface FakeSubscription {
  userId: string;
  plan: string;
  status: 'active' | 'canceled' | 'expired';
  endDate: Date;
  save: jest.Mock;
}

function fakeSubscription(
  status: FakeSubscription['status'],
  endDate: Date,
): FakeSubscription {
  return {
    userId: 'user-1',
    plan: 'pro',
    status,
    endDate,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

/** `findOne(...).sort(...)` — the query shape the service uses. */
function sortsTo(document: FakeSubscription | null) {
  return { sort: jest.fn().mockResolvedValue(document) };
}

function asSubscription(document: FakeSubscription): ISubscription {
  return document as unknown as ISubscription;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
  // Deliberately shape-compatible with an update result: a sweep rewritten to
  // DELETE must run to completion and be caught by the explicit "never deleted"
  // assertion, naming the offending call — not die on an incidental TypeError
  // that would read the same whatever the implementation did.
  const deleteResult = { deletedCount: 0, modifiedCount: 0 };
  mockDeleteMany.mockResolvedValue(deleteResult);
  mockDeleteOne.mockResolvedValue(deleteResult);
  mockFindOneAndDelete.mockResolvedValue(null);
});

describe('sweepSubscriptionStatuses', () => {
  it('EXPIRES a subscription whose period has ended — it never deletes it', async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 3 });

    const result = await sweepSubscriptionStatuses(NOW);

    // Asserted FIRST so that a sweep which removed rows fails naming the delete
    // it performed, rather than failing on a missing update further down.
    // The whole point of the fix: a lapsed subscription becomes history, not a
    // hole where a paying customer's record used to be.
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockDeleteOne).not.toHaveBeenCalled();
    expect(mockFindOneAndDelete).not.toHaveBeenCalled();

    expect(mockUpdateMany).toHaveBeenCalledWith(
      { status: 'active', endDate: { $lte: NOW } },
      { $set: { status: 'expired' } },
    );
    expect(result.expired).toBe(3);
  });

  it('reactivates an expired row whose endDate was pushed forward by a renewal', async () => {
    await sweepSubscriptionStatuses(NOW);

    expect(mockUpdateMany).toHaveBeenCalledWith(
      { status: 'expired', endDate: { $gt: NOW } },
      { $set: { status: 'active' } },
    );
  });

  it('never touches a cancelled row', async () => {
    await sweepSubscriptionStatuses(NOW);

    for (const [filter] of mockUpdateMany.mock.calls) {
      expect(filter.status).not.toBe('canceled');
    }
  });

  it('is a no-op over already reconciled data', async () => {
    await expect(sweepSubscriptionStatuses(NOW)).resolves.toEqual({
      expired: 0,
      reactivated: 0,
    });
  });
});

describe('findCurrentSubscription', () => {
  it('expires a lapsed row on read (lazy expiry) instead of reporting it active', async () => {
    const lapsed = fakeSubscription('active', LAPSED);
    mockFindOne
      .mockReturnValueOnce(sortsTo(null)) // no in-force row
      .mockReturnValueOnce(sortsTo(lapsed)); // most recent row

    const current = await findCurrentSubscription('user-1', NOW);

    expect(current).toBe(asSubscription(lapsed));
    expect(lapsed.status).toBe('expired');
    expect(lapsed.save).toHaveBeenCalledTimes(1);
  });

  it('prefers the in-force row over retained history', async () => {
    const running = fakeSubscription('active', RUNNING);
    mockFindOne.mockReturnValueOnce(sortsTo(running));

    const current = await findCurrentSubscription('user-1', NOW);

    expect(current).toBe(asSubscription(running));
    expect(mockFindOne).toHaveBeenCalledTimes(1);
    expect(mockFindOne).toHaveBeenCalledWith({
      userId: 'user-1',
      status: { $ne: 'canceled' },
      endDate: { $gt: NOW },
    });
    // Already accurate — no write on the read path.
    expect(running.save).not.toHaveBeenCalled();
  });

  it('leaves a cancelled row cancelled', async () => {
    const cancelled = fakeSubscription('canceled', LAPSED);
    mockFindOne.mockReturnValueOnce(sortsTo(null)).mockReturnValueOnce(sortsTo(cancelled));

    await findCurrentSubscription('user-1', NOW);

    expect(cancelled.status).toBe('canceled');
    expect(cancelled.save).not.toHaveBeenCalled();
  });

  it('returns null when the user never had a subscription', async () => {
    mockFindOne.mockReturnValue(sortsTo(null));

    await expect(findCurrentSubscription('user-1', NOW)).resolves.toBeNull();
  });
});
