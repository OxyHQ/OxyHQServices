/**
 * GET /search archived-exclusion coverage for the legacy people-search surface.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Types } from 'mongoose';

const mockUserFind = jest.fn();

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
    find: (...args: unknown[]) => mockUserFind(...args),
  },
}));

import searchRouter from '../search';
import { errorHandler } from '../../middleware/errorHandler';

interface PoolUser {
  _id: Types.ObjectId;
  username?: string;
  accountStatus?: string;
  reputationTier?: string;
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
  const or = filter.$or as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(or)) return true;
  return or.some((clause) => {
    const [field, pattern] = Object.entries(clause)[0];
    const value = field === 'username' ? user.username : undefined;
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

const activeUser = new Types.ObjectId();
const archivedUser = new Types.ObjectId();
const restrictedUser = new Types.ObjectId();

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
  it('adds accountStatus: { $ne: "archived" } to the User.find filter', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
    mockUserFind.mockReturnValue(chain);

    const res = await requestJson(server, '/?query=test&type=users');
    expect(res.status).toBe(200);

    const filter = mockUserFind.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.accountStatus).toEqual({ $ne: 'archived' });
    expect(filter.reputationTier).toEqual({ $ne: 'restricted' });
  });

  it('filters archived accounts while surfacing active matches', async () => {
    const pool: PoolUser[] = [
      { _id: activeUser, username: 'active_match', accountStatus: 'active' },
      { _id: archivedUser, username: 'archived_match', accountStatus: 'archived' },
    ];

    mockUserFind.mockImplementation((filter: Record<string, unknown>) => {
      const matched = pool.filter((user) => matchesFindFilter(user, filter));
      return {
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(
          matched.map((user) => ({
            _id: user._id,
            username: user.username,
            accountStatus: user.accountStatus,
          })),
        ),
      };
    });

    const res = await requestJson(server, '/?query=match&type=users');
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

    mockUserFind.mockImplementation((filter: Record<string, unknown>) => {
      const matched = pool.filter((user) => matchesFindFilter(user, filter));
      return {
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue(
          matched.map((user) => ({
            _id: user._id,
            username: user.username,
            accountStatus: user.accountStatus,
            reputationTier: user.reputationTier,
          })),
        ),
      };
    });

    const res = await requestJson(server, '/?query=match&type=users');
    expect(res.status).toBe(200);

    const ids = (res.body.users ?? []).map((user) => String(user.id));
    expect(ids).toContain(activeUser.toString());
    expect(ids).not.toContain(restrictedUser.toString());
  });
});
