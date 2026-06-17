/**
 * Reputation Mixin Tests (Oxy Trust)
 *
 * Exercises the typed helpers around `/reputation/...`. We stub `makeRequest`
 * so the tests run without a network or a database — what we care about here is
 * request shape (method, URL, query params, body, cache options), the response
 * envelope handling (direct object vs `{ data }` paginated vs `{ rules }` /
 * `{ transaction }` / `{ dispute }` wrappers), default fallbacks on missing
 * fields, path-segment URL-encoding, and cache invalidation on writes.
 */

import { OxyServices } from '../../OxyServices';
import type {
  ReputationBalance,
  ReputationTransaction,
  ReputationDispute,
  ReputationRule,
  ReputationLeaderboardEntry,
  ReputationInfluenceResult,
} from '../OxyServices.reputation';

const setAccessTokenForTest = (oxy: OxyServices): void => {
  oxy.httpService.setTokens('test-token');
};

const balanceFixture: ReputationBalance = {
  userId: 'u1',
  total: 120,
  positive: 150,
  negative: -30,
  breakdown: {
    content: 80,
    social: 40,
    trust: 0,
    moderation: 0,
    physical: 0,
    penalties: 30,
  },
  trustTier: 'trusted',
  influence: {
    defaultWeight: 1.0,
    reportWeight: 1.0,
    moderationWeight: 1.0,
    rankingFeedbackWeight: 0.8,
  },
  reliability: {
    accurateReports: 2,
    rejectedReports: 0,
    reportAccuracyScore: 1,
    abuseScore: 0,
  },
  recalculatedAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const transactionFixture: ReputationTransaction = {
  id: 't1',
  userId: 'u1',
  points: 10,
  actionType: 'post_created',
  category: 'content',
  status: 'active',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const disputeFixture: ReputationDispute = {
  id: 'd1',
  transactionId: 't1',
  userId: 'u1',
  reason: 'I did not do this',
  status: 'open',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const ruleFixture: ReputationRule = {
  id: 'r1',
  actionType: 'post_created',
  points: 10,
  category: 'content',
  description: 'Created a post',
  cooldownInMinutes: 0,
  isEnabled: true,
};

describe('OxyServices.reputation', () => {
  let oxy: OxyServices;
  let makeRequestSpy: jest.SpyInstance;
  let clearCacheSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    setAccessTokenForTest(oxy);
    makeRequestSpy = jest.spyOn(oxy, 'makeRequest');
    clearCacheSpy = jest.spyOn(oxy, 'clearCacheByPrefix');
  });

  afterEach(() => {
    makeRequestSpy.mockRestore();
    clearCacheSpy.mockRestore();
  });

  describe('getReputationBalance', () => {
    it('returns the balance object directly and caches the read', async () => {
      makeRequestSpy.mockResolvedValue(balanceFixture);

      const result = await oxy.getReputationBalance('u1');

      expect(result).toEqual(balanceFixture);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/u1/balance',
        undefined,
        expect.objectContaining({ cache: true }),
      );
    });

    it('URL-encodes the userId path segment', async () => {
      makeRequestSpy.mockResolvedValue(balanceFixture);
      await oxy.getReputationBalance('a b/c');
      expect(makeRequestSpy.mock.calls[0][1]).toBe('/reputation/a%20b%2Fc/balance');
    });
  });

  describe('getReputationLeaderboard', () => {
    it('unwraps the paginated `data` array and omits empty query params', async () => {
      const entries: ReputationLeaderboardEntry[] = [
        {
          user: { id: 'u1', username: 'alice', name: { full: 'Alice' }, avatar: 'a', publicKey: 'pk1' },
          total: 120,
          trustTier: 'trusted',
          rank: 1,
        },
      ];
      makeRequestSpy.mockResolvedValue({ data: entries });

      const result = await oxy.getReputationLeaderboard();

      expect(result).toEqual(entries);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/leaderboard',
        undefined,
        expect.objectContaining({ cache: true }),
      );
    });

    it('passes limit/offset as query params when provided', async () => {
      makeRequestSpy.mockResolvedValue({ data: [] });
      await oxy.getReputationLeaderboard(25, 50);
      expect(makeRequestSpy.mock.calls[0][2]).toEqual({ limit: 25, offset: 50 });
    });

    it('returns an empty array when `data` is absent', async () => {
      makeRequestSpy.mockResolvedValue({});
      const result = await oxy.getReputationLeaderboard();
      expect(result).toEqual([]);
    });
  });

  describe('getReputationRules', () => {
    it('unwraps the `rules` array and uses a long-lived cache', async () => {
      makeRequestSpy.mockResolvedValue({ rules: [ruleFixture] });

      const result = await oxy.getReputationRules();

      expect(result).toEqual([ruleFixture]);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/rules',
        undefined,
        expect.objectContaining({ cache: true }),
      );
    });

    it('returns an empty array when `rules` is absent', async () => {
      makeRequestSpy.mockResolvedValue({});
      expect(await oxy.getReputationRules()).toEqual([]);
    });
  });

  describe('getReputationTransactions', () => {
    it('unwraps the paginated `data` array', async () => {
      makeRequestSpy.mockResolvedValue({ data: [transactionFixture] });

      const result = await oxy.getReputationTransactions('u1', 10);

      expect(result).toEqual([transactionFixture]);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/u1/transactions',
        { limit: 10 },
        expect.objectContaining({ cache: true }),
      );
    });

    it('returns an empty array when `data` is absent', async () => {
      makeRequestSpy.mockResolvedValue({});
      expect(await oxy.getReputationTransactions('u1')).toEqual([]);
    });
  });

  describe('getReputationInfluence', () => {
    it('returns the influence result directly and passes the context query', async () => {
      const influence: ReputationInfluenceResult = {
        context: 'report',
        weight: 1.5,
        influence: balanceFixture.influence,
      };
      makeRequestSpy.mockResolvedValue(influence);

      const result = await oxy.getReputationInfluence('u1', 'report');

      expect(result).toEqual(influence);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/u1/influence',
        { context: 'report' },
        expect.objectContaining({ cache: true }),
      );
    });

    it('omits the context query when not provided', async () => {
      makeRequestSpy.mockResolvedValue({
        context: 'default',
        weight: 1,
        influence: balanceFixture.influence,
      });
      await oxy.getReputationInfluence('u1');
      expect(makeRequestSpy.mock.calls[0][2]).toBeUndefined();
    });
  });

  describe('awardReputation', () => {
    it('posts the payload, unwraps `transaction`, and invalidates the cache', async () => {
      makeRequestSpy.mockResolvedValue({ transaction: transactionFixture });

      const result = await oxy.awardReputation({ userId: 'u1', actionType: 'post_created' });

      expect(result).toEqual(transactionFixture);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/award',
        { userId: 'u1', actionType: 'post_created' },
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });
  });

  describe('createReputationDispute', () => {
    it('posts the payload, unwraps `dispute`, and invalidates the cache', async () => {
      makeRequestSpy.mockResolvedValue({ dispute: disputeFixture });

      const result = await oxy.createReputationDispute({
        transactionId: 't1',
        reason: 'I did not do this',
      });

      expect(result).toEqual(disputeFixture);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/disputes',
        { transactionId: 't1', reason: 'I did not do this' },
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });
  });

  describe('getUserReputationDisputes', () => {
    it('unwraps the paginated `data` array', async () => {
      makeRequestSpy.mockResolvedValue({ data: [disputeFixture] });
      const result = await oxy.getUserReputationDisputes('u1', 5, 10);
      expect(result).toEqual([disputeFixture]);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/u1/disputes',
        { limit: 5, offset: 10 },
        expect.objectContaining({ cache: true }),
      );
    });
  });

  describe('upsertReputationRule', () => {
    it('posts the rule, unwraps `rule`, and invalidates the cache', async () => {
      makeRequestSpy.mockResolvedValue({ rule: ruleFixture });

      const result = await oxy.upsertReputationRule({
        actionType: 'post_created',
        points: 10,
        category: 'content',
        description: 'Created a post',
      });

      expect(result).toEqual(ruleFixture);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/rules',
        expect.objectContaining({ actionType: 'post_created', points: 10 }),
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });
  });

  describe('reverseReputationTransaction', () => {
    it('returns the { original, reversal } pair and invalidates the cache', async () => {
      const reversal = { ...transactionFixture, id: 't2', points: -10, reversedTransactionId: 't1' };
      const original = { ...transactionFixture, status: 'reversed' as const };
      makeRequestSpy.mockResolvedValue({ original, reversal });

      const result = await oxy.reverseReputationTransaction('t1', { reason: 'mistake' });

      expect(result).toEqual({ original, reversal });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/transactions/t1/reverse',
        { reason: 'mistake' },
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });

    it('sends an empty body when no input is given', async () => {
      makeRequestSpy.mockResolvedValue({ original: transactionFixture, reversal: transactionFixture });
      await oxy.reverseReputationTransaction('t1');
      expect(makeRequestSpy.mock.calls[0][2]).toEqual({});
    });
  });

  describe('voidReputationTransaction', () => {
    it('unwraps `transaction` and invalidates the cache', async () => {
      const voided = { ...transactionFixture, status: 'voided' as const };
      makeRequestSpy.mockResolvedValue({ transaction: voided });

      const result = await oxy.voidReputationTransaction('t1');

      expect(result).toEqual(voided);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/transactions/t1/void',
        {},
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });
  });

  describe('recalculateReputation', () => {
    it('returns the recomputed balance directly and invalidates the cache', async () => {
      makeRequestSpy.mockResolvedValue(balanceFixture);

      const result = await oxy.recalculateReputation('u1');

      expect(result).toEqual(balanceFixture);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/u1/recalculate',
        undefined,
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });
  });

  describe('getReputationDisputeQueue', () => {
    it('unwraps the paginated `data` array', async () => {
      makeRequestSpy.mockResolvedValue({ data: [disputeFixture] });
      const result = await oxy.getReputationDisputeQueue(20);
      expect(result).toEqual([disputeFixture]);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/reputation/disputes',
        { limit: 20 },
        expect.objectContaining({ cache: true }),
      );
    });
  });

  describe('resolveReputationDispute', () => {
    it('posts the resolution, unwraps `dispute`, and invalidates the cache', async () => {
      const resolved = { ...disputeFixture, status: 'accepted' as const };
      makeRequestSpy.mockResolvedValue({ dispute: resolved });

      const result = await oxy.resolveReputationDispute('d1', { status: 'accepted' });

      expect(result).toEqual(resolved);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/reputation/disputes/d1/resolve',
        { status: 'accepted' },
        expect.objectContaining({ cache: false }),
      );
      expect(clearCacheSpy).toHaveBeenCalledWith('GET:/reputation/');
    });
  });

  describe('error handling', () => {
    it('surfaces API errors via handleError', async () => {
      makeRequestSpy.mockRejectedValue(
        Object.assign(new Error('boom'), { response: { status: 500 } }),
      );
      await expect(oxy.getReputationBalance('u1')).rejects.toThrow();
    });
  });
});
