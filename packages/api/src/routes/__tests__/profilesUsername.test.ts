/**
 * GET /profiles/username/:username eligibility coverage.
 *
 * Proves direct username lookup applies the same archived + restricted gates as
 * /profiles/resolve and people search.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('mongoose', () => jest.requireActual('mongoose'));
import { Types } from 'mongoose';

const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockResolveAndUpsert = jest.fn();
const mockIsFediverseHandle = jest.fn();
const mockGetUserStats = jest.fn();
const mockGetViewerRelationship = jest.fn();

let currentViewerId: string | undefined;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/optionalAuth', () => ({
  optionalUserOrServiceAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveViewerId: () => currentViewerId,
}));
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../services/user.service', () => ({
  userService: {
    getUserStats: (...args: unknown[]) => mockGetUserStats(...args),
    formatUserResponse: (profile: { _id: Types.ObjectId; username?: string }) => ({
      id: profile._id.toString(),
      username: profile.username,
    }),
    getViewerRelationship: (...args: unknown[]) => mockGetViewerRelationship(...args),
  },
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { resolveAndUpsert: (...args: unknown[]) => mockResolveAndUpsert(...args) },
  isFediverseHandle: (...args: unknown[]) => mockIsFediverseHandle(...args),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
  default: { aggregate: jest.fn() },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn(),
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
}));

import profilesRouter from '../profiles';
import { errorHandler } from '../../middleware/errorHandler';

const activeUserId = new Types.ObjectId();

function findOneQuery(result: Record<string, unknown> | null) {
  return {
    select: () => ({
      lean: async () => result,
    }),
  };
}

function requestJson(server: http.Server, username: string) {
  const address = server.address() as AddressInfo;
  return new Promise<{ status: number; body: { message?: string; data?: unknown } }>((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port: address.port, path: `/profiles/username/${encodeURIComponent(username)}` },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
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

describe('GET /profiles/username/:username', () => {
  let server: http.Server;

  beforeAll((done) => {
    const app = express();
    app.use('/profiles', profilesRouter);
    app.use(errorHandler);
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentViewerId = undefined;
    mockIsFediverseHandle.mockReturnValue(false);
    mockGetUserStats.mockResolvedValue({});
  });

  it('returns 404 for a restricted-tier local user', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: activeUserId,
        username: 'abuser',
        accountStatus: 'active',
        reputationTier: 'restricted',
      }),
    );

    const res = await requestJson(server, 'abuser');
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('returns 404 for an archived local user', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: activeUserId,
        username: 'gone',
        accountStatus: 'archived',
      }),
    );

    const res = await requestJson(server, 'gone');
    expect(res.status).toBe(404);
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('returns the profile for an active, non-restricted local user', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: activeUserId,
        username: 'nate',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );

    const res = await requestJson(server, 'nate');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: activeUserId.toString(), username: 'nate' });
  });

  it('resolves local usernames case-insensitively', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: activeUserId,
        username: 'Alice',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );

    const res = await requestJson(server, 'alice');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: activeUserId.toString(), username: 'Alice' });
    expect(mockUserFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        username: expect.objectContaining({ source: '^alice$', flags: 'i' }),
      }),
    );
  });

  it('omits relationship for anonymous viewers', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: activeUserId,
        username: 'nate',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );

    const res = await requestJson(server, 'nate');
    expect(res.status).toBe(200);
    expect(res.body.data?.relationship).toBeUndefined();
    expect(mockGetViewerRelationship).not.toHaveBeenCalled();
  });

  it('includes relationship when an authenticated viewer fetches another profile', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    currentViewerId = viewerId;
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: activeUserId,
        username: 'nate',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );
    mockGetViewerRelationship.mockResolvedValue({ isFollowing: true, followsYou: false });

    const res = await requestJson(server, 'nate');
    expect(res.status).toBe(200);
    expect(res.body.data?.relationship).toEqual({ isFollowing: true, followsYou: false });
    expect(mockGetViewerRelationship).toHaveBeenCalledWith(viewerId, activeUserId.toString());
  });
});
