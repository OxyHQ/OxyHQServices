/**
 * authSession.service tests
 *
 * Unit coverage for `claimAuthSession`. The route-level happy path lives
 * in `routes/__tests__/sessionClaim.test.ts`; this file isolates the
 * service so we can assert each status-transition branch independently
 * and the atomic single-use claim against `findOneAndUpdate`.
 */

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

import { claimAuthSession } from '../authSession.service';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('claimAuthSession', () => {
  it('returns not_found when the sessionToken does not exist', async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const result = await claimAuthSession({ sessionToken: 'nope' });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns pending when the sessionToken has not yet been authorized', async () => {
    mockFindOne.mockResolvedValueOnce({
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimAuthSession({ sessionToken: 'pending-token' });

    expect(result).toEqual({ ok: false, reason: 'pending' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns cancelled when the user denied the authorization', async () => {
    mockFindOne.mockResolvedValueOnce({
      status: 'cancelled',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimAuthSession({ sessionToken: 'cancelled-token' });

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns already_consumed when the sessionToken has been used', async () => {
    mockFindOne.mockResolvedValueOnce({
      status: 'consumed',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimAuthSession({ sessionToken: 'used-token' });

    expect(result).toEqual({ ok: false, reason: 'already_consumed' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns expired when the AuthSession TTL has elapsed', async () => {
    mockFindOne.mockResolvedValueOnce({
      status: 'authorized',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const result = await claimAuthSession({ sessionToken: 'expired-token' });

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns expired when the status is already expired', async () => {
    mockFindOne.mockResolvedValueOnce({
      status: 'expired',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimAuthSession({ sessionToken: 'stale-token' });

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('atomically claims an authorized AuthSession on the happy path', async () => {
    const peek = {
      _id: 'object-id',
      status: 'authorized',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const claimed = {
      ...peek,
      status: 'consumed',
      consumedAt: new Date(),
      authorizedSessionId: 'sess-new',
    };
    mockFindOne.mockResolvedValueOnce(peek);
    mockFindOneAndUpdate.mockResolvedValueOnce(claimed);

    const result = await claimAuthSession({ sessionToken: 'good-token' });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      // Only an `authorized` row can be transitioned — the atomicity is
      // anchored on this filter.
      { _id: 'object-id', status: 'authorized' },
      { $set: expect.objectContaining({ status: 'consumed' }) },
      { new: true }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authSession).toBe(claimed);
    }
  });

  it('returns already_consumed when the atomic claim loses a race', async () => {
    mockFindOne.mockResolvedValueOnce({
      _id: 'object-id',
      status: 'authorized',
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Concurrent claim won — the atomic findOneAndUpdate returns null.
    mockFindOneAndUpdate.mockResolvedValueOnce(null);

    const result = await claimAuthSession({ sessionToken: 'good-token' });

    expect(result).toEqual({ ok: false, reason: 'already_consumed' });
  });
});
