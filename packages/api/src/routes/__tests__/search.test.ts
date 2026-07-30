/**
 * GET /search archived-exclusion coverage for the legacy people-search surface.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Types } from 'mongoose';
import { INFLUENCE_MIN } from '../../utils/reputation.constants';

const mockUserAggregate = jest.fn();

jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: (user: { _id: { toString(): string } }) => ({
    id: user._id.toString(),
  }),
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: (...args: unknown[]) => mockUserAggregate(...args),
  },
}));

import searchRouter from '../search';
import { errorHandler } from '../../middleware/errorHandler';

interface PoolUser {
  _id: Types.ObjectId;
  username?: string;
  accountStatus?: string;
  reputationTier?: string;
  type?: string;
  reputationRankWeight?: number;
  privacySettings?: { isPrivateAccount?: boolean };
}

function requestJson(server: http.Server, path: string): Promise<{ status: number; body: { users?: Array<{ id: string }> } }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port: address.port, path },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function matchesFindFilter(user: PoolUser, filter: Record<string, unknown>): boolean {
  const acct = filter.accountStatus as { $ne?: string } | undefined;
  if (acct && typeof acct.$ne === 'string' && user.accountStatus === acct.$ne) {
    return false;
  }
  const tier = filter.reputationTier as { $ne?: string } | undefined;
  if (tier && typeof tier.$ne === 'string' && user.reputationTier === tier.$ne) {
    return false;
  }
  const privateGate = filter['privacySettings.isPrivateAccount'] as { $ne?: boolean } | undefined;
  if (privateGate && privateGate.$ne === true && user.privacySettings?.isPrivateAccount === true) {
    return false;
  }
  const or = filter.$or as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(or)) return true;
  return or.some((clause) => {
    const [field, pattern] = Object.entries(clause)[0];
    const value =
      field === 'username' ? user.username
        : field === 'name.first' ? (user as { name?: { first?: string } }).name?.first
          : field === 'name.last' ? (user as { name?: { last?: string } }).name?.last
            : field === 'description' ? (user as { description?: string }).description
              : undefined;
    if (typeof value !== 'string') return false;
    if (pattern instanceof RegExp) {
      return pattern.test(value);
    }
    if (pattern && typeof pattern === 'object' && '$regex' in pattern) {
      const regex = pattern as { $regex: string; $options?: string };
      return new RegExp(regex.$regex, regex.$options ?? '').test(value);
    }
    return false;
  });
}

function sortKeyValue(user: PoolUser, key: string): number | string {
  if (key === '_nativePriority') return user.type === 'federated' ? 1 : 0;
  if (key === '_reputationRank') {
    return typeof user.reputationRankWeight === 'number' ? user.reputationRankWeight : INFLUENCE_MIN;
  }
  if (key === '_id') return user._id.toString();
  return 0;
}

function aggregateSearchPaged(pool: PoolUser[]): (pipeline: unknown) => Promise<unknown[]> {
  return (pipeline: unknown) => {
    const stages = pipeline as Array<Record<string, unknown>>;
    const matchStage = stages.find((stage) => '$match' in stage)?.$match as Record<string, unknown> | undefined;
    const matched = pool.filter((user) => matchesFindFilter(user, matchStage ?? {}));

    const sortSpec = stages.find((stage) => '$sort' in stage)?.$sort as Record<string, 1 | -1> | undefined;
    const skip = (stages.find((stage) => '$skip' in stage)?.$skip as number | undefined) ?? 0;
    const limit = (stages.find((stage) => '$limit' in stage)?.$limit as number | undefined) ?? matched.length;

    const ordered = sortSpec
      ? [...matched].sort((a, b) => {
          for (const [key, dir] of Object.entries(sortSpec)) {
            const av = sortKeyValue(a, key);
            const bv = sortKeyValue(b, key);
            let cmp = 0;
            if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
            else cmp = (av as number) - (bv as number);
            if (cmp !== 0) return dir === -1 ? -cmp : cmp;
          }
          return 0;
        })
      : matched;

    return Promise.resolve(ordered.slice(skip, skip + limit).map((user) => ({
      _id: user._id,
      username: user.username,
      accountStatus: user.accountStatus,
      reputationTier: user.reputationTier,
      privacySettings: user.privacySettings,
      type: user.type,
      reputationRankWeight: user.reputationRankWeight,
    })));
  };
}

const activeUser = new Types.ObjectId();
const archivedUser = new Types.ObjectId();
const restrictedUser = new Types.ObjectId();
const privateUser = new Types.ObjectId();
const nativeMatch = new Types.ObjectId();
const federatedMatch = new Types.ObjectId();

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(searchRouter);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /search archived exclusion', () => {
  it('adds accountStatus: { $ne: "archived" } to the User.aggregate $match', async () => {
    mockUserAggregate.mockResolvedValue([]);

    const res = await requestJson(server, '/?query=test&type=users&page=1&limit=10');
    expect(res.status).toBe(200);

    const pipeline = mockUserAggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const filter = pipeline.find((stage) => '$match' in stage)?.$match as Record<string, unknown>;
    expect(filter.accountStatus).toEqual({ $ne: 'archived' });
    expect(filter.reputationTier).toEqual({ $ne: 'restricted' });
    expect(filter['privacySettings.isPrivateAccount']).toEqual({ $ne: true });
  });

  it('filters archived accounts while surfacing active matches', async () => {
    const pool: PoolUser[] = [
      { _id: activeUser, username: 'active_match', accountStatus: 'active' },
      { _id: archivedUser, username: 'archived_match', accountStatus: 'archived' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(server, '/?query=match&type=users&page=1&limit=10');
    expect(res.status).toBe(200);

    const ids = (res.body.users ?? []).map((user) => String(user.id));
    expect(ids).toContain(activeUser.toString());
    expect(ids).not.toContain(archivedUser.toString());
  });

  it('filters restricted-tier accounts while surfacing active and untiered matches', async () => {
    const pool: PoolUser[] = [
      { _id: activeUser, username: 'active_match', accountStatus: 'active' },
      { _id: restrictedUser, username: 'restricted_match', accountStatus: 'active', reputationTier: 'restricted' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(server, '/?query=match&type=users&page=1&limit=10');
    expect(res.status).toBe(200);

    const ids = (res.body.users ?? []).map((user) => String(user.id));
    expect(ids).toContain(activeUser.toString());
    expect(ids).not.toContain(restrictedUser.toString());
  });

  it('filters private accounts while surfacing public matches', async () => {
    const pool: PoolUser[] = [
      { _id: activeUser, username: 'public_match', accountStatus: 'active' },
      {
        _id: privateUser,
        username: 'private_match',
        accountStatus: 'active',
        privacySettings: { isPrivateAccount: true },
      },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(server, '/?query=match&type=users&page=1&limit=10');
    expect(res.status).toBe(200);

    const ids = (res.body.users ?? []).map((user) => String(user.id));
    expect(ids).toContain(activeUser.toString());
    expect(ids).not.toContain(privateUser.toString());
  });
});

describe('GET /search native-first ordering', () => {
  it('orders native accounts before federated matches with the same query', async () => {
    const pool: PoolUser[] = [
      { _id: federatedMatch, username: 'shared_match', accountStatus: 'active', type: 'federated', reputationRankWeight: 9 },
      { _id: nativeMatch, username: 'shared_match_native', accountStatus: 'active', type: 'agent', reputationRankWeight: 1 },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(server, '/?query=match&type=users&page=1&limit=10');
    expect(res.status).toBe(200);

    const ids = (res.body.users ?? []).map((user) => String(user.id));
    expect(ids[0]).toBe(nativeMatch.toString());
    expect(ids).toContain(federatedMatch.toString());
  });
});

describe('GET /search leading-@ handling', () => {
  it('strips a single leading @ so a Bluesky handle matches the stored username', async () => {
    const pool: PoolUser[] = [
      { _id: activeUser, username: 'adamrbjack.bsky.social@bsky.social', accountStatus: 'active' },
    ];
    mockUserAggregate.mockImplementation(aggregateSearchPaged(pool));

    const res = await requestJson(
      server,
      `/?query=${encodeURIComponent('@adamrbjack.bsky.social@bsky.social')}&type=users&page=1&limit=10`,
    );
    expect(res.status).toBe(200);
    expect((res.body.users ?? []).map((user) => user.id)).toContain(activeUser.toString());
  });
});
