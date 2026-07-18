/**
 * GET /profiles/resolve viewer-relationship coverage.
 *
 * Proves the resolve handler computes the same viewer-relative `relationship`
 * field as its two sibling single-profile routes (/profiles/username/:username
 * and /users/:userId): present only when the request is authenticated AND the
 * viewer is not the target, omitted otherwise. This is what makes "Follows you"
 * render on a federated profile fetched through resolve.
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
  resolveViewerId: (): string | undefined => currentViewerId,
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

const targetUserId = new Types.ObjectId();

function findOneQuery(result: Record<string, unknown> | null) {
  return {
    select: () => ({
      lean: async () => result,
    }),
  };
}

interface JsonResponse {
  status: number;
  body: { message?: string; data?: Record<string, unknown> | null };
}

function requestJson(server: http.Server, handle: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port: address.port,
        path: `/profiles/resolve?handle=${encodeURIComponent(handle)}`,
      },
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

describe('GET /profiles/resolve relationship', () => {
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

  it('includes relationship (followsYou true) when an authed viewer resolves a local target that follows them', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    currentViewerId = viewerId;
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: targetUserId,
        username: 'remote@mastodon.social',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );
    mockGetViewerRelationship.mockResolvedValue({ isFollowing: false, followsYou: true });

    const res = await requestJson(server, '@remote@mastodon.social');
    expect(res.status).toBe(200);
    expect(res.body.data?.relationship).toEqual({ isFollowing: false, followsYou: true });
    expect(mockGetViewerRelationship).toHaveBeenCalledWith(viewerId, targetUserId.toString());
    // Local-first hit never touches remote discovery.
    expect(mockResolveAndUpsert).not.toHaveBeenCalled();
  });

  it('omits relationship for anonymous viewers', async () => {
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: targetUserId,
        username: 'remote@mastodon.social',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );

    const res = await requestJson(server, '@remote@mastodon.social');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: targetUserId.toString(), username: 'remote@mastodon.social' });
    expect(res.body.data?.relationship).toBeUndefined();
    expect(mockGetViewerRelationship).not.toHaveBeenCalled();
  });

  it('omits relationship on a self-view', async () => {
    currentViewerId = targetUserId.toHexString();
    mockUserFindOne.mockReturnValue(
      findOneQuery({
        _id: targetUserId,
        username: 'me@mastodon.social',
        accountStatus: 'active',
        reputationTier: 'trusted',
      }),
    );

    const res = await requestJson(server, '@me@mastodon.social');
    expect(res.status).toBe(200);
    expect(res.body.data?.relationship).toBeUndefined();
    expect(mockGetViewerRelationship).not.toHaveBeenCalled();
  });

  it('computes relationship on the discovery branch for a freshly-upserted actor', async () => {
    const viewerId = new Types.ObjectId().toHexString();
    currentViewerId = viewerId;
    // No local row → discovery path. The handle must pass the fediverse-format gate.
    mockUserFindOne.mockReturnValue(findOneQuery(null));
    mockIsFediverseHandle.mockReturnValue(true);
    mockResolveAndUpsert.mockResolvedValue({
      _id: targetUserId,
      username: 'fresh@mastodon.social',
      accountStatus: 'active',
      reputationTier: 'trusted',
    });
    mockGetViewerRelationship.mockResolvedValue({ isFollowing: false, followsYou: false });

    const res = await requestJson(server, '@fresh@mastodon.social');
    expect(res.status).toBe(200);
    expect(res.body.data?.relationship).toEqual({ isFollowing: false, followsYou: false });
    expect(mockGetViewerRelationship).toHaveBeenCalledWith(viewerId, targetUserId.toString());
    expect(mockResolveAndUpsert).toHaveBeenCalled();
  });
});
