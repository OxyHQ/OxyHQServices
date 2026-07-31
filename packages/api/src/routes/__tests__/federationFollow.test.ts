/**
 * `POST /federation/follow` — the service-credential follow bridge.
 *
 * A FEDERATED (fediverse) actor that follows/unfollows a LOCAL user over
 * ActivityPub is mirrored into the Oxy follow graph by Mention's backend through
 * this route. The suite walks the trust boundary and the idempotency guarantees:
 *
 *  - missing `federation:write` scope                      → 403
 *  - follower is not a `type:'federated'` user             → 403 (anti-impersonation)
 *  - unknown follower / unknown target                     → 404
 *  - target is federated (not a local user)                → 403
 *  - either side archived                                  → 409
 *  - a repeated follow/unfollow moves the graph exactly once
 *
 * ## This route is HALF-ported, and the suite is shaped around that
 *
 * `routes/federation.ts` still reads its guards through the Mongoose `User`
 * model (`User.findById(...).select(...).lean()`), while the write it delegates
 * to — `userService.followUser` / `unfollowUser` — is fully on Postgres. The
 * previous suite mocked BOTH halves with one in-memory store; when the write
 * half moved, the store stopped being consulted and the two idempotency cases
 * 500'd.
 *
 * So: the guard half stays mocked (that is the un-ported code, and mocking it is
 * the only way to reach the handler at all), and the graph half runs for real.
 * The two are kept consistent by seeding a REAL `users` row FIRST and mirroring
 * it into the guard store under the same id.
 *
 * The ids are explicit 24-char ObjectId hex, which the route's schema
 * (`federationFollowSchema` → `objectIdSchema`) still requires and which the
 * migration contract preserves verbatim as a `text` primary key. That schema
 * will reject the uuid v7 every account minted after the cutover receives; the
 * fix belongs with this file's own port, and is reported rather than made here.
 *
 * The denormalized `_count` assertions are GONE, not translated: those columns
 * were deliberately deleted (`db/schema/users.ts`) — `user_follows` is the
 * single authority and the counts are measured from it.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomBytes } from 'node:crypto';

/** The real service imports `Types`, which the global mongoose stub strips. */
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

/** The guard-read store standing in for the route's un-ported Mongo reads. */
interface GuardUser {
  _id: string;
  type: 'local' | 'federated' | 'agent' | 'automated';
  accountStatus: string;
}

const guardUsers = new Map<string, GuardUser>();

const mockUserFindById = jest.fn((id: string) => {
  const doc = guardUsers.get(id) ?? null;
  return { select: () => ({ lean: () => Promise.resolve(doc) }) };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: { findById: (...args: [string]) => mockUserFindById(...args) },
}));

// Models / services the federation router pulls in but this suite never
// exercises — stubbed so importing the router stays lightweight.
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

/** The scopes the mocked service-auth middleware grants. */
let currentScopes: string[] = ['federation:write'];

jest.mock('../../middleware/auth', () => ({
  serviceAuthMiddleware: (
    req: { serviceApp?: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    req.serviceApp = {
      type: 'service',
      appId: 'app-1',
      appName: 'mention',
      credentialId: 'cred-1',
      scopes: currentScopes,
    };
    next();
  },
}));

import { and, eq } from 'drizzle-orm';
import { closePostgres, connectPostgres, getDb } from '../../config/postgres';
import { userFollows } from '../../db/schema/userFollows';
import { users } from '../../db/schema/users';
import { errorHandler } from '../../middleware/errorHandler';
import { userService } from '../../services/user.service';
import federationRouter from '../federation';

interface JsonResponse {
  status: number;
  body: {
    error?: string;
    message?: string;
    data?: {
      created?: boolean;
      removed?: boolean;
      counts?: { followers: number; following: number };
    };
  };
}

let server: http.Server;

function post(path: string, payload: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
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
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** A fresh 24-char ObjectId-hex id, which the route's schema still requires. */
function objectIdHex(): string {
  return randomBytes(12).toString('hex');
}

/**
 * A real `users` row PLUS its mirror in the guard store, under the same id — so
 * the route's Mongo-backed guards and the Postgres-backed write agree on which
 * account they are talking about.
 */
async function seedUser(
  type: GuardUser['type'],
  accountStatus: 'active' | 'archived' = 'active',
): Promise<string> {
  const id = objectIdHex();
  await getDb().insert(users).values({ id, type, accountStatus });
  guardUsers.set(id, { _id: id, type, accountStatus });
  return id;
}

/** An id that exists in NEITHER store. */
function unknownUser(): string {
  return objectIdHex();
}

async function edgeCount(followerId: string, followedId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: userFollows.id })
    .from(userFollows)
    .where(and(eq(userFollows.followerId, followerId), eq(userFollows.followedId, followedId)));
  return rows.length;
}

async function edgeExists(followerId: string, followedId: string): Promise<boolean> {
  return (await edgeCount(followerId, followedId)) > 0;
}

beforeAll(async () => {
  await connectPostgres();
  const app = express();
  app.use(express.json());
  app.use('/federation', federationRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closePostgres();
});

beforeEach(() => {
  guardUsers.clear();
  mockUserFindById.mockClear();
  currentScopes = ['federation:write'];
});

describe('POST /federation/follow — trust boundary', () => {
  it('rejects a service token without federation:write, and writes no edge', async () => {
    currentScopes = [];
    const follower = await seedUser('federated');
    const target = await seedUser('local');

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(await edgeExists(follower, target)).toBe(false);
  });

  it("rejects a LOCAL follower — a service credential may not move a real user's graph", async () => {
    const follower = await seedUser('local');
    const target = await seedUser('local');

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/follower must be a federated user/i);
    expect(await edgeExists(follower, target)).toBe(false);
  });

  it('404s an unknown follower', async () => {
    const target = await seedUser('local');

    const res = await post('/federation/follow', {
      followerUserId: unknownUser(),
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/follower user not found/i);
  });

  it('404s an unknown target', async () => {
    const follower = await seedUser('federated');

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: unknownUser(),
      action: 'follow',
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/target user not found/i);
  });

  it('rejects a FEDERATED target — the bridge only mirrors remote → local', async () => {
    const follower = await seedUser('federated');
    const target = await seedUser('federated');

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/local \(non-federated\) user/i);
    expect(await edgeExists(follower, target)).toBe(false);
  });

  it('409s an archived follower', async () => {
    const follower = await seedUser('federated', 'archived');
    const target = await seedUser('local');

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/follower is archived/i);
    expect(await edgeExists(follower, target)).toBe(false);
  });

  it('409s an archived target', async () => {
    const follower = await seedUser('federated');
    const target = await seedUser('local', 'archived');

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/target is archived/i);
    expect(await edgeExists(follower, target)).toBe(false);
  });

  it('400s a body that fails schema validation, before any lookup runs', async () => {
    const target = await seedUser('local');

    const res = await post('/federation/follow', {
      followerUserId: 'not-an-object-id',
      targetUserId: target,
      action: 'follow',
    });

    expect(res.status).toBe(400);
    expect(mockUserFindById).not.toHaveBeenCalled();
  });
});

describe('POST /federation/follow — idempotency', () => {
  it('creates the edge once, however many times the follow is repeated', async () => {
    const follower = await seedUser('federated');
    const target = await seedUser('local');

    const first = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(first.status).toBe(200);
    expect(first.body.data?.created).toBe(true);
    // `counts.followers` is the TARGET's follower total; `counts.following` is
    // the FOLLOWER's following total. Both are measured from `user_follows`.
    expect(first.body.data?.counts).toEqual({ followers: 1, following: 1 });
    expect(await edgeCount(follower, target)).toBe(1);

    const second = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    expect(second.status).toBe(200);
    expect(second.body.data?.created).toBe(false);
    expect(second.body.data?.counts).toEqual({ followers: 1, following: 1 });
    expect(await edgeCount(follower, target)).toBe(1);
  });

  it('removes the edge once and never drives a count negative', async () => {
    const follower = await seedUser('federated');
    const target = await seedUser('local');
    await getDb().insert(userFollows).values({ followerId: follower, followedId: target });

    const first = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'unfollow',
    });

    expect(first.status).toBe(200);
    expect(first.body.data?.removed).toBe(true);
    expect(first.body.data?.counts).toEqual({ followers: 0, following: 0 });
    expect(await edgeExists(follower, target)).toBe(false);

    const second = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'unfollow',
    });

    expect(second.status).toBe(200);
    expect(second.body.data?.removed).toBe(false);
    expect(second.body.data?.counts).toEqual({ followers: 0, following: 0 });
  });

  it("counts the whole of each side's graph, not just this pair", async () => {
    const follower = await seedUser('federated');
    const target = await seedUser('local');
    const bystander = await seedUser('local');
    await getDb().insert(userFollows).values({ followerId: bystander, followedId: target });

    const res = await post('/federation/follow', {
      followerUserId: follower,
      targetUserId: target,
      action: 'follow',
    });

    // The target now has TWO followers; the follower follows ONE account.
    expect(res.body.data?.counts).toEqual({ followers: 2, following: 1 });
  });
});

describe('UserService follow primitives — self-follow guard', () => {
  it('followUser refuses to follow yourself, and writes nothing', async () => {
    const self = await seedUser('federated');

    await expect(userService.followUser(self, self)).rejects.toThrow('Cannot follow yourself');
    expect(await edgeExists(self, self)).toBe(false);
  });

  it('unfollowUser refuses to unfollow yourself', async () => {
    const self = await seedUser('federated');

    await expect(userService.unfollowUser(self, self)).rejects.toThrow('Cannot follow yourself');
  });
});
