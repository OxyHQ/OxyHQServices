/**
 * `POST /federation/actor-delete` — the service-credential "hard-delete a dead
 * federated identity + its follow graph" bridge.
 *
 * Mention is the only component that talks to the remote fediverse; when an
 * actor is permanently removed upstream (HTTP 410 Gone for a deleted/spam
 * account) it calls this route to ERASE the corresponding Oxy identity and every
 * social-graph edge it left behind — the irreversible counterpart to
 * `actor-gone` (which only archives). The suite walks the trust boundary, the
 * graph purge, and the idempotency guarantee:
 *
 *  - missing `federation:write` scope                        → 403, no writes
 *  - body fails schema validation                            → 400
 *  - unknown user                                            → 200 no-op
 *  - target is NOT federated (local/agent/automated)         → 409, never deleted
 *  - a live federated actor is fully deleted, its edges in BOTH directions
 *    removed and its blocks/restrictions removed              → 200
 *  - a repeated call after deletion is a no-op               → 200 deleted:false
 *
 * ## This route is HALF-ported, and the suite is shaped around that
 *
 * `routes/federation.ts` still reads its guard through the Mongoose `User`
 * model, while the destructive write it delegates to —
 * `userService.deleteFederatedActor` → `purgeUserSocialGraph` — is fully on
 * Postgres. The previous suite mocked BOTH halves with one in-memory store; when
 * the write half moved, the store stopped being consulted and the two
 * destructive cases 500'd, which is exactly the shape a purge test must never
 * have: it passed while asserting a deletion that never happened anywhere.
 *
 * So the guard half stays mocked (the un-ported code) and the purge runs for
 * real, against rows this suite seeds and then re-reads. Ids are explicit
 * 24-char ObjectId hex because the route's schema still requires that shape —
 * see the note in `federationFollow.test.ts`.
 *
 * The denormalized counterparty `_count` repair is GONE, not translated: those
 * columns were deliberately deleted, so there is no counter to repair. What
 * replaces it is stronger — the edges themselves are asserted absent, and the
 * counterparties' remaining edges are asserted INTACT.
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

/** The guard-read store standing in for the route's un-ported Mongo read. */
interface GuardUser {
  _id: string;
  type: 'local' | 'federated' | 'agent' | 'automated';
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

import { and, eq, or } from 'drizzle-orm';
import { closePostgres, connectPostgres, getDb } from '../../config/postgres';
import { blocks } from '../../db/schema/blocks';
import { restrictions } from '../../db/schema/restrictions';
import { userFollows } from '../../db/schema/userFollows';
import { users } from '../../db/schema/users';
import { errorHandler } from '../../middleware/errorHandler';
import userCache from '../../utils/userCache';
import federationRouter from '../federation';

interface JsonResponse {
  status: number;
  body: {
    error?: string;
    message?: string;
    data?: { oxyUserId?: string; deleted?: boolean; followEdgesRemoved?: number };
  };
}

let server: http.Server;
let invalidateSpy: jest.SpyInstance;

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

/** A real `users` row PLUS its mirror in the guard store, under the same id. */
async function seedUser(type: GuardUser['type']): Promise<string> {
  const id = objectIdHex();
  await getDb().insert(users).values({ id, type });
  guardUsers.set(id, { _id: id, type });
  return id;
}

async function follow(followerId: string, followedId: string): Promise<void> {
  await getDb().insert(userFollows).values({ followerId, followedId });
}

async function userExists(id: string): Promise<boolean> {
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return row !== undefined;
}

async function edgesTouching(id: string): Promise<number> {
  const rows = await getDb()
    .select({ id: userFollows.id })
    .from(userFollows)
    .where(or(eq(userFollows.followerId, id), eq(userFollows.followedId, id)));
  return rows.length;
}

async function blocksTouching(id: string): Promise<number> {
  const rows = await getDb()
    .select({ id: blocks.id })
    .from(blocks)
    .where(or(eq(blocks.userId, id), eq(blocks.blockedId, id)));
  return rows.length;
}

async function restrictionsTouching(id: string): Promise<number> {
  const rows = await getDb()
    .select({ id: restrictions.id })
    .from(restrictions)
    .where(or(eq(restrictions.userId, id), eq(restrictions.restrictedId, id)));
  return rows.length;
}

async function edgeExists(followerId: string, followedId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: userFollows.id })
    .from(userFollows)
    .where(and(eq(userFollows.followerId, followerId), eq(userFollows.followedId, followedId)))
    .limit(1);
  return row !== undefined;
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
  invalidateSpy = jest.spyOn(userCache, 'invalidate');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /federation/actor-delete — trust boundary', () => {
  it('rejects a service token without federation:write, and deletes nothing', async () => {
    currentScopes = [];
    const actor = await seedUser('federated');

    const res = await post('/federation/actor-delete', { oxyUserId: actor });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(await userExists(actor)).toBe(true);
  });

  it('400s a body that fails schema validation, before any lookup runs', async () => {
    const res = await post('/federation/actor-delete', { oxyUserId: 'not-an-object-id' });

    expect(res.status).toBe(400);
    expect(mockUserFindById).not.toHaveBeenCalled();
  });

  it('409s a NON-federated account and leaves its whole graph intact', async () => {
    const local = await seedUser('local');
    const follower = await seedUser('local');
    await follow(follower, local);
    await getDb().insert(blocks).values({ userId: local, blockedId: follower });

    const res = await post('/federation/actor-delete', { oxyUserId: local });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not a federated actor/i);
    expect(await userExists(local)).toBe(true);
    expect(await edgesTouching(local)).toBe(1);
    expect(await blocksTouching(local)).toBe(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('POST /federation/actor-delete — purge', () => {
  it('is a 200 no-op for an unknown user, with no destructive write', async () => {
    const unknownId = objectIdHex();

    const res = await post('/federation/actor-delete', { oxyUserId: unknownId });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      oxyUserId: unknownId,
      deleted: false,
      followEdgesRemoved: 0,
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('hard-deletes the actor, every edge in both directions, and its blocks and restrictions', async () => {
    const actor = await seedUser('federated');
    const followed1 = await seedUser('local');
    const followed2 = await seedUser('local');
    const follower = await seedUser('local');
    const bystander = await seedUser('local');

    // Two outbound edges, one inbound — and one edge between two OTHER accounts
    // that must survive, so the delete is proven scoped rather than a truncate.
    await follow(actor, followed1);
    await follow(actor, followed2);
    await follow(follower, actor);
    await follow(bystander, followed1);
    await getDb()
      .insert(blocks)
      .values([
        { userId: actor, blockedId: followed1 },
        { userId: follower, blockedId: actor },
      ]);
    await getDb().insert(restrictions).values({ userId: actor, restrictedId: followed2 });

    const res = await post('/federation/actor-delete', { oxyUserId: actor });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      oxyUserId: actor,
      deleted: true,
      followEdgesRemoved: 3,
    });

    expect(await userExists(actor)).toBe(false);
    expect(await edgesTouching(actor)).toBe(0);
    expect(await blocksTouching(actor)).toBe(0);
    expect(await restrictionsTouching(actor)).toBe(0);
    // The unrelated edge is untouched — and each counterparty still exists.
    expect(await edgeExists(bystander, followed1)).toBe(true);
    expect(await userExists(followed1)).toBe(true);
    expect(await userExists(followed2)).toBe(true);
    expect(await userExists(follower)).toBe(true);

    // The actor's cache entry and every counterparty's are invalidated, so a
    // stale follower list cannot outlive the purge.
    const invalidated = new Set(invalidateSpy.mock.calls.map((call) => call[0] as string));
    expect(invalidated).toEqual(new Set([actor, followed1, followed2, follower]));
  });

  it('is idempotent: a repeated delete after the actor is gone is a 200 no-op', async () => {
    const actor = await seedUser('federated');

    const first = await post('/federation/actor-delete', { oxyUserId: actor });

    expect(first.status).toBe(200);
    expect(first.body.data?.deleted).toBe(true);
    expect(await userExists(actor)).toBe(false);

    // The guard store still holds the row — the route's un-ported read is what
    // decides `deleted`, so drop it to model the second call honestly.
    guardUsers.delete(actor);

    const second = await post('/federation/actor-delete', { oxyUserId: actor });

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({
      oxyUserId: actor,
      deleted: false,
      followEdgesRemoved: 0,
    });
  });
});
