/**
 * POST /federation/follow — service-credential follow bridge.
 *
 * A FEDERATED (fediverse) actor that follows/unfollows a LOCAL user over
 * ActivityPub is mirrored into the Oxy follow graph by Mention's backend through
 * this route. The suite walks the trust boundary and the idempotency guarantees:
 *
 *  - missing federation:write scope                        → 403
 *  - follower is not a `type:'federated'` user             → 403 (anti-impersonation)
 *  - unknown follower / unknown target                     → 404
 *  - target is federated (not a local user)                → 403
 *  - repeated follow moves the counters ±1 exactly once    → idempotent
 *  - repeated unfollow never drives the counters negative  → idempotent
 *  - self-follow is rejected at the service primitive
 *
 * The real router AND the real `userService` primitives run; only the Mongoose
 * models are replaced with a small stateful in-memory store so the follower /
 * following counters can be asserted end-to-end.
 */

// The global jest.setup mocks `mongoose` wholesale (stripping `Types`). This
// suite exercises the real service, which imports `Types` — restore mongoose.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// In-memory data store shared by the User + Follow model mocks.
// ---------------------------------------------------------------------------
type UserType = 'local' | 'federated' | 'agent' | 'automated';
interface StoreUser {
  _id: string;
  type: UserType;
  _count: { followers: number; following: number };
}

const users = new Map<string, StoreUser>();
const followEdges = new Set<string>();

function edgeKey(followerUserId: string, followType: string, followedId: string): string {
  return `${followerUserId}:${followType}:${followedId}`;
}

function seedUser(id: string, type: UserType): StoreUser {
  const user: StoreUser = { _id: id, type, _count: { followers: 0, following: 0 } };
  users.set(id, user);
  return user;
}

/** A Mongoose-ish query: awaitable directly AND chainable via `.select().lean()`. */
function userQuery(id: string) {
  const doc = users.get(id) ?? null;
  return {
    select(): { lean(): Promise<StoreUser | null> } {
      return { lean: () => Promise.resolve(doc) };
    },
    then<TResult1 = StoreUser | null, TResult2 = never>(
      onfulfilled?: ((value: StoreUser | null) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(doc).then(onfulfilled, onrejected);
    },
  };
}

const mockUserFindById = jest.fn((id: string) => userQuery(id));
const mockUserFindByIdAndUpdate = jest.fn(
  async (id: string, update: { $inc?: Record<string, number> }): Promise<StoreUser | null> => {
    const user = users.get(id);
    if (user && update.$inc) {
      for (const [path, delta] of Object.entries(update.$inc)) {
        if (path === '_count.followers') user._count.followers += delta;
        if (path === '_count.following') user._count.following += delta;
      }
    }
    return user ?? null;
  }
);

interface FollowDoc {
  followerUserId: string;
  followType: string;
  followedId: string;
}

const mockFollowCreate = jest.fn(async (doc: FollowDoc): Promise<FollowDoc> => {
  const key = edgeKey(doc.followerUserId, doc.followType, doc.followedId);
  if (followEdges.has(key)) {
    const err = new Error('E11000 duplicate key') as Error & { code: number };
    err.code = 11000;
    throw err;
  }
  followEdges.add(key);
  return doc;
});

const mockFollowDeleteOne = jest.fn(
  async (filter: FollowDoc): Promise<{ deletedCount: number }> => {
    const key = edgeKey(filter.followerUserId, filter.followType, filter.followedId);
    const existed = followEdges.delete(key);
    return { deletedCount: existed ? 1 : 0 };
  }
);

const mockFollowFindOne = jest.fn(async (filter: FollowDoc): Promise<{ _id: string } | null> => {
  const key = edgeKey(filter.followerUserId, filter.followType, filter.followedId);
  return followEdges.has(key) ? { _id: key } : null;
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: (...args: [string]) => mockUserFindById(...args),
    findByIdAndUpdate: (...args: [string, { $inc?: Record<string, number> }]) =>
      mockUserFindByIdAndUpdate(...args),
  },
}));

jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    create: (...args: [FollowDoc]) => mockFollowCreate(...args),
    deleteOne: (...args: [FollowDoc]) => mockFollowDeleteOne(...args),
    findOne: (...args: [FollowDoc]) => mockFollowFindOne(...args),
  },
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
}));

// Models / services the federation router or user.service pull in but that this
// suite does not exercise — stubbed so importing the router stays lightweight.
jest.mock('../../models/Subscription', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Application', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: jest.fn() } }));
jest.mock('../../utils/credentialDomainCache', () => ({
  __esModule: true,
  default: { getAllowedDomains: jest.fn() },
}));
jest.mock('../../services/securityActivityService', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/federation.service', () => ({
  __esModule: true,
  getUserPublicKey: jest.fn(),
  signWithKeyId: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockServiceAuthMiddleware = jest.fn();
jest.mock('../../middleware/auth', () => ({
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

import federationRouter from '../federation';
import { userService } from '../../services/user.service';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: {
    error?: string;
    message?: string;
    data?: { created?: boolean; removed?: boolean; counts?: { followers: number; following: number } };
  };
}

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload: unknown
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Deterministic 24-hex ObjectId strings that satisfy the route schema.
const FEDERATED_ID = 'a'.repeat(24);
const LOCAL_ID = 'b'.repeat(24);
const OTHER_ID = 'c'.repeat(24);

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/federation', federationRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  users.clear();
  followEdges.clear();
  // Default: the service credential carries the federation:write scope.
  mockServiceAuthMiddleware.mockImplementation(
    (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
      req.serviceApp = {
        type: 'service',
        appId: 'app-1',
        appName: 'mention',
        credentialId: 'cred-1',
        scopes: ['federation:write'],
      };
      next();
    }
  );
});

describe('POST /federation/follow', () => {
  it('rejects when the service token lacks federation:write scope', async () => {
    mockServiceAuthMiddleware.mockImplementationOnce(
      (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
        req.serviceApp = {
          type: 'service',
          appId: 'app-1',
          appName: 'limited',
          credentialId: 'cred-1',
          scopes: [],
        };
        next();
      }
    );
    seedUser(FEDERATED_ID, 'federated');
    seedUser(LOCAL_ID, 'local');

    const res = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(mockFollowCreate).not.toHaveBeenCalled();
  });

  it('rejects when the follower is not a federated user (anti-impersonation)', async () => {
    seedUser(FEDERATED_ID, 'local'); // follower is a LOCAL user
    seedUser(LOCAL_ID, 'local');

    const res = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/follower must be a federated user/i);
    expect(mockFollowCreate).not.toHaveBeenCalled();
  });

  it('returns 404 when the follower does not exist', async () => {
    seedUser(LOCAL_ID, 'local');

    const res = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/follower user not found/i);
    expect(mockFollowCreate).not.toHaveBeenCalled();
  });

  it('returns 404 when the target does not exist', async () => {
    seedUser(FEDERATED_ID, 'federated');

    const res = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/target user not found/i);
    expect(mockFollowCreate).not.toHaveBeenCalled();
  });

  it('rejects when the target is itself a federated user', async () => {
    seedUser(FEDERATED_ID, 'federated');
    seedUser(OTHER_ID, 'federated');

    const res = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: OTHER_ID,
      action: 'follow',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/local \(non-federated\) user/i);
    expect(mockFollowCreate).not.toHaveBeenCalled();
  });

  it('rejects a body that fails schema validation (non-ObjectId id)', async () => {
    const res = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: 'not-an-object-id',
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(res.status).toBe(400);
    expect(mockUserFindById).not.toHaveBeenCalled();
  });

  it('is idempotent: a repeated follow moves the counters +1 exactly once', async () => {
    const follower = seedUser(FEDERATED_ID, 'federated');
    const target = seedUser(LOCAL_ID, 'local');

    const first = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(first.status).toBe(200);
    expect(first.body.data?.created).toBe(true);
    // `counts.followers` = the target's follower total; `counts.following` = the
    // follower's following total. Both move to 1 on a genuine new follow.
    expect(first.body.data?.counts).toEqual({ followers: 1, following: 1 });
    expect(target._count.followers).toBe(1);
    expect(follower._count.following).toBe(1);

    const second = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'follow',
    });

    expect(second.status).toBe(200);
    expect(second.body.data?.created).toBe(false);
    // Counters unchanged by the duplicate follow.
    expect(second.body.data?.counts).toEqual({ followers: 1, following: 1 });
    expect(target._count.followers).toBe(1);
    expect(follower._count.following).toBe(1);
    // Exactly one edge insert was attempted-and-kept; the second raised E11000.
    expect(mockFollowCreate).toHaveBeenCalledTimes(2);
    expect(followEdges.size).toBe(1);
  });

  it('is idempotent: unfollowing removes the edge once and never goes negative', async () => {
    const follower = seedUser(FEDERATED_ID, 'federated');
    const target = seedUser(LOCAL_ID, 'local');
    followEdges.add(edgeKey(FEDERATED_ID, 'user', LOCAL_ID));
    target._count.followers = 1;
    follower._count.following = 1;

    const first = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'unfollow',
    });

    expect(first.status).toBe(200);
    expect(first.body.data?.removed).toBe(true);
    expect(first.body.data?.counts).toEqual({ followers: 0, following: 0 });
    expect(target._count.followers).toBe(0);
    expect(follower._count.following).toBe(0);

    const second = await requestJson(server, 'POST', '/federation/follow', {
      followerUserId: FEDERATED_ID,
      targetUserId: LOCAL_ID,
      action: 'unfollow',
    });

    expect(second.status).toBe(200);
    expect(second.body.data?.removed).toBe(false);
    // No underflow: counters stay at zero.
    expect(second.body.data?.counts).toEqual({ followers: 0, following: 0 });
    expect(target._count.followers).toBe(0);
    expect(follower._count.following).toBe(0);
  });
});

describe('UserService follow primitives (self-follow guard)', () => {
  it('followUser rejects following yourself', async () => {
    await expect(userService.followUser(FEDERATED_ID, FEDERATED_ID)).rejects.toThrow(
      'Cannot follow yourself'
    );
    expect(mockFollowCreate).not.toHaveBeenCalled();
  });

  it('unfollowUser rejects unfollowing yourself', async () => {
    await expect(userService.unfollowUser(FEDERATED_ID, FEDERATED_ID)).rejects.toThrow(
      'Cannot follow yourself'
    );
    expect(mockFollowDeleteOne).not.toHaveBeenCalled();
  });
});
