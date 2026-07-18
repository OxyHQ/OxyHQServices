/**
 * POST /federation/actor-delete — service-credential "hard-delete a dead
 * federated identity + its follow graph" bridge.
 *
 * Mention is the only component that talks to the remote fediverse; when an actor
 * is permanently removed upstream (HTTP 410 Gone for a deleted/spam account) it
 * calls this route to ERASE the corresponding Oxy identity and every social-graph
 * edge it left behind — the irreversible counterpart to `actor-gone` (archive).
 * The suite walks the trust boundary, the graph purge + count repair, and the
 * idempotency guarantee:
 *
 *  - missing federation:write scope                          → 403 (no writes)
 *  - body fails schema validation (non-ObjectId oxyUserId)   → 400
 *  - unknown user                                            → 200 idempotent no-op
 *  - target is NOT a federated user (local/agent/automated)  → 409 (never deleted)
 *  - a live federated actor is fully deleted, its edges (both directions +
 *    hashtag follows) removed, counterparty counts repaired, blocks removed,
 *    caches invalidated                                      → 200
 *  - a repeated call after deletion is a no-op               → idempotent 200
 *
 * The real router, the real body schema, AND the real `userService` graph-purge
 * method all run; only the Mongoose models + the caches are replaced with
 * in-memory doubles so the destructive writes can be asserted end-to-end.
 */

// The global jest.setup mocks `mongoose` wholesale (stripping `Types`). Restore
// the real module so the router's / service's imports behave.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// In-memory stores: users, follow edges, blocks.
// ---------------------------------------------------------------------------
type UserType = 'local' | 'federated' | 'agent' | 'automated';
interface UserCount {
  followers: number;
  following: number;
}
interface StoreUser {
  _id: string;
  type: UserType;
  _count: UserCount;
}
interface FollowEdge {
  followerUserId: string;
  followType: 'user' | 'hashtag' | 'topic';
  followedId: string;
}
interface BlockEdge {
  userId: string;
  blockedId: string;
}

const users = new Map<string, StoreUser>();
const follows: FollowEdge[] = [];
const blocks: BlockEdge[] = [];

function seedUser(
  id: string,
  type: UserType,
  count: UserCount = { followers: 0, following: 0 }
): StoreUser {
  const user: StoreUser = { _id: id, type, _count: { ...count } };
  users.set(id, user);
  return user;
}

// ---------------------------------------------------------------------------
// User model double — the route reads `type`; the service repairs counts and
// deletes the document (re-asserting the `type: 'federated'` guard).
// ---------------------------------------------------------------------------
const mockUserFindById = jest.fn((id: string) => {
  const doc = users.get(id) ?? null;
  return {
    select(): { lean(): Promise<{ _id: string; type: UserType } | null> } {
      return {
        lean: () =>
          Promise.resolve(doc ? { _id: doc._id, type: doc.type } : null),
      };
    },
  };
});

const mockUserUpdateMany = jest.fn(
  async (
    filter: { _id?: { $in?: string[] } },
    update: { $inc?: Record<string, number> }
  ): Promise<{ matchedCount: number; modifiedCount: number }> => {
    const ids = filter._id?.$in ?? [];
    const inc = update.$inc ?? {};
    let modifiedCount = 0;
    for (const id of ids) {
      const user = users.get(id);
      if (!user) continue;
      for (const [path, delta] of Object.entries(inc)) {
        if (path === '_count.followers') user._count.followers += delta;
        else if (path === '_count.following') user._count.following += delta;
      }
      modifiedCount += 1;
    }
    return { matchedCount: modifiedCount, modifiedCount };
  }
);

const mockUserDeleteOne = jest.fn(
  async (filter: {
    _id: string;
    type?: string;
  }): Promise<{ deletedCount: number }> => {
    const user = users.get(filter._id);
    // Honour the service's `type: 'federated'` guard clause on the delete filter.
    if (user && (filter.type === undefined || user.type === filter.type)) {
      users.delete(filter._id);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }
);

// ---------------------------------------------------------------------------
// Follow model double.
// ---------------------------------------------------------------------------
const mockFollowFind = jest.fn(
  (filter: {
    followerUserId?: string;
    followedId?: string;
    followType?: string;
  }) => {
    const rows = follows.filter((edge) => {
      if (
        filter.followType !== undefined &&
        edge.followType !== filter.followType
      )
        return false;
      if (
        filter.followerUserId !== undefined &&
        edge.followerUserId !== filter.followerUserId
      )
        return false;
      if (filter.followedId !== undefined && edge.followedId !== filter.followedId)
        return false;
      return true;
    });
    return {
      select(): { lean(): Promise<FollowEdge[]> } {
        return { lean: () => Promise.resolve(rows.map((edge) => ({ ...edge }))) };
      },
    };
  }
);

const mockFollowDeleteMany = jest.fn(
  async (filter: {
    $or?: Array<{ followerUserId?: string; followedId?: string }>;
  }): Promise<{ deletedCount: number }> => {
    const or = filter.$or ?? [];
    let deletedCount = 0;
    for (let i = follows.length - 1; i >= 0; i -= 1) {
      const edge = follows[i];
      const match = or.some(
        (cond) =>
          (cond.followerUserId !== undefined &&
            edge.followerUserId === cond.followerUserId) ||
          (cond.followedId !== undefined && edge.followedId === cond.followedId)
      );
      if (match) {
        follows.splice(i, 1);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }
);

// ---------------------------------------------------------------------------
// Block model double.
// ---------------------------------------------------------------------------
const mockBlockDeleteMany = jest.fn(
  async (filter: {
    $or?: Array<{ userId?: string; blockedId?: string }>;
  }): Promise<{ deletedCount: number }> => {
    const or = filter.$or ?? [];
    let deletedCount = 0;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const edge = blocks[i];
      const match = or.some(
        (cond) =>
          (cond.userId !== undefined && edge.userId === cond.userId) ||
          (cond.blockedId !== undefined && edge.blockedId === cond.blockedId)
      );
      if (match) {
        blocks.splice(i, 1);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }
);

const mockRestrictedDeleteMany = jest.fn(
  async (): Promise<{ deletedCount: number }> => ({ deletedCount: 0 })
);

const mockUserCacheInvalidate = jest.fn();
const mockGraphCacheInvalidate = jest.fn(() => Promise.resolve());

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: (...args: [string]) => mockUserFindById(...args),
    updateMany: (...args: [{ _id?: { $in?: string[] } }, { $inc?: Record<string, number> }]) =>
      mockUserUpdateMany(...args),
    deleteOne: (...args: [{ _id: string; type?: string }]) => mockUserDeleteOne(...args),
  },
}));
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    find: (...args: [Record<string, unknown>]) => mockFollowFind(...args),
    deleteMany: (...args: [{ $or?: Array<Record<string, unknown>> }]) =>
      mockFollowDeleteMany(...args),
  },
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
}));
jest.mock('../../models/Block', () => ({
  __esModule: true,
  default: {
    deleteMany: (...args: [{ $or?: Array<Record<string, unknown>> }]) =>
      mockBlockDeleteMany(...args),
  },
}));
jest.mock('../../models/Restricted', () => ({
  __esModule: true,
  default: {
    deleteMany: (...args: unknown[]) => mockRestrictedDeleteMany(...args),
  },
}));
jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockUserCacheInvalidate(...args) },
}));
jest.mock('../../utils/graphCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockGraphCacheInvalidate(...args) },
}));

// Models / services the federation router (via user.service) pulls in but that
// this suite does not exercise — stubbed so importing the router stays light.
jest.mock('../../models/Subscription', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Application', () => ({ __esModule: true, default: {} }));
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
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: {
    error?: string;
    message?: string;
    data?: {
      oxyUserId?: string;
      deleted?: boolean;
      followEdgesRemoved?: number;
    };
  };
}

function requestJson(
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
const FOLLOWED_1 = 'c'.repeat(24); // a local user the actor follows
const FOLLOWED_2 = 'd'.repeat(24); // a second local user the actor follows
const FOLLOWER_1 = 'e'.repeat(24); // a local user who follows the actor
const HASHTAG_ID = 'f'.repeat(24); // a hashtag the actor follows (no counterparty count)

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
  follows.length = 0;
  blocks.length = 0;
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

describe('POST /federation/actor-delete', () => {
  it('rejects when the service token lacks federation:write scope (no writes)', async () => {
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

    const res = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockFollowDeleteMany).not.toHaveBeenCalled();
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
    // The actor still exists.
    expect(users.has(FEDERATED_ID)).toBe(true);
  });

  it('rejects a body that fails schema validation (non-ObjectId id)', async () => {
    const res = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: 'not-an-object-id',
    });

    expect(res.status).toBe(400);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
  });

  it('is idempotent: an unknown user is a 200 no-op (deleted:false, no destructive writes)', async () => {
    const res = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      oxyUserId: FEDERATED_ID,
      deleted: false,
      followEdgesRemoved: 0,
    });
    expect(mockFollowDeleteMany).not.toHaveBeenCalled();
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
    expect(mockUserCacheInvalidate).not.toHaveBeenCalled();
  });

  it('refuses (409) to delete a non-federated (local) user and never writes', async () => {
    const local = seedUser(LOCAL_ID, 'local', { followers: 5, following: 3 });
    follows.push({
      followerUserId: FOLLOWER_1,
      followType: 'user',
      followedId: LOCAL_ID,
    });

    const res = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: LOCAL_ID,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not a federated actor/i);
    // The real account was never touched.
    expect(mockFollowDeleteMany).not.toHaveBeenCalled();
    expect(mockBlockDeleteMany).not.toHaveBeenCalled();
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
    expect(mockUserCacheInvalidate).not.toHaveBeenCalled();
    expect(users.get(LOCAL_ID)).toBe(local);
    expect(local._count).toEqual({ followers: 5, following: 3 });
    expect(follows).toHaveLength(1);
  });

  it('hard-deletes a federated actor: removes all edges, repairs counterparty counts, removes blocks, invalidates caches', async () => {
    // The dead actor and its counterparties.
    seedUser(FEDERATED_ID, 'federated', { followers: 1, following: 2 });
    const followed1 = seedUser(FOLLOWED_1, 'local', { followers: 1, following: 0 });
    const followed2 = seedUser(FOLLOWED_2, 'local', { followers: 1, following: 4 });
    const follower1 = seedUser(FOLLOWER_1, 'local', { followers: 0, following: 1 });

    // Outbound USER edges — the actor follows two local users (they each lose a
    // follower); one inbound USER edge — a local user follows the actor (it loses
    // a following); plus a hashtag follow (removed, but no counterparty count).
    follows.push(
      { followerUserId: FEDERATED_ID, followType: 'user', followedId: FOLLOWED_1 },
      { followerUserId: FEDERATED_ID, followType: 'user', followedId: FOLLOWED_2 },
      { followerUserId: FOLLOWER_1, followType: 'user', followedId: FEDERATED_ID },
      { followerUserId: FEDERATED_ID, followType: 'hashtag', followedId: HASHTAG_ID }
    );
    // Blocks in both directions.
    blocks.push(
      { userId: FEDERATED_ID, blockedId: FOLLOWED_1 },
      { userId: FOLLOWER_1, blockedId: FEDERATED_ID }
    );

    const res = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      oxyUserId: FEDERATED_ID,
      deleted: true,
      followEdgesRemoved: 4,
    });

    // The actor document is gone; the delete re-asserted the federated guard.
    expect(users.has(FEDERATED_ID)).toBe(false);
    expect(mockUserDeleteOne).toHaveBeenCalledWith({
      _id: FEDERATED_ID,
      type: 'federated',
    });

    // Every follow edge touching the actor was removed (both directions +
    // hashtag follow).
    expect(follows).toHaveLength(0);
    // Every block touching the actor was removed.
    expect(blocks).toHaveLength(0);

    // Counterparty counts repaired with unfollow semantics: the followed users
    // each lost one follower; the follower lost one following.
    expect(followed1._count).toEqual({ followers: 0, following: 0 });
    expect(followed2._count).toEqual({ followers: 0, following: 4 });
    expect(follower1._count).toEqual({ followers: 0, following: 0 });

    // Cache invalidation: the actor's user cache + the graph of the actor and
    // every counterparty.
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith(FEDERATED_ID);
    const invalidatedGraphIds = mockGraphCacheInvalidate.mock.calls.map(
      (call) => call[0]
    );
    expect(new Set(invalidatedGraphIds)).toEqual(
      new Set([FEDERATED_ID, FOLLOWED_1, FOLLOWED_2, FOLLOWER_1])
    );
  });

  it('is idempotent: a repeated delete after the actor is gone returns 200 deleted:false', async () => {
    seedUser(FEDERATED_ID, 'federated');

    const first = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: FEDERATED_ID,
    });
    expect(first.status).toBe(200);
    expect(first.body.data?.deleted).toBe(true);
    expect(users.has(FEDERATED_ID)).toBe(false);

    const second = await requestJson(server, 'POST', '/federation/actor-delete', {
      oxyUserId: FEDERATED_ID,
    });
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({
      oxyUserId: FEDERATED_ID,
      deleted: false,
      followEdgesRemoved: 0,
    });
  });
});
