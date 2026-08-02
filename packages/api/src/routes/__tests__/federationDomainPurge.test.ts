/**
 * POST /federation/domain-purge — remove what the Oxy PLATFORM holds for a
 * fediverse instance the calling app has blocked.
 *
 * The two assertions this suite exists for, because both guard something
 * irreversible:
 *
 *   1. A DRY RUN WRITES NOTHING. Not a file delete, not a row delete, not an
 *      archive, not a graph edge — while still returning a non-empty plan, so
 *      "wrote nothing" can never be satisfied by "did nothing".
 *   2. A NON-BLOCKED DOMAIN'S DATA IS NEVER TOUCHED. Subdomains, unrelated
 *      domains and our own apex all survive a purge aimed next to them. The
 *      engine's `isBlockedDomain` is exact canonical-host membership, so a
 *      purge that matched wider would delete content for instances we still
 *      federate with.
 *
 * Also covered: `www.` spellings ARE matched (36 such rows exist in production
 * and a naive equality query misses them); files belonging to ANOTHER
 * application are never deleted and instead retain the shared user row; the
 * caller's identity comes from the service credential and not the request body;
 * and the destructive path is refused unless the deployment is armed.
 *
 * The real router, the real body schema, the real purge service, the real
 * `userService` graph teardown AND the real `@oxyhq/federation` canonicaliser
 * all run — only the Mongoose models, the asset service and the caches are
 * in-memory doubles, so the writes (or their absence) are observable.
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
// In-memory stores.
// ---------------------------------------------------------------------------
type UserType = 'local' | 'federated' | 'agent' | 'automated';

interface StoreUser {
  _id: string;
  type: UserType;
  username: string;
  accountStatus?: string;
  federation?: { domain?: string };
  _count: { followers: number; following: number };
}
interface StoreFile {
  _id: string;
  ownerUserId: string;
  size: number;
  metadata: Record<string, unknown>;
}
interface FollowEdge {
  followerUserId: string;
  followType: 'user' | 'hashtag' | 'topic';
  followedId: string;
}

const users = new Map<string, StoreUser>();
const files = new Map<string, StoreFile>();
const follows: FollowEdge[] = [];

function seedFederatedUser(id: string, domain: string, username = `u@${domain}`): StoreUser {
  const user: StoreUser = {
    _id: id,
    type: 'federated',
    username,
    federation: { domain },
    _count: { followers: 0, following: 0 },
  };
  users.set(id, user);
  return user;
}

function seedLocalUser(id: string): StoreUser {
  const user: StoreUser = {
    _id: id,
    type: 'local',
    username: `local-${id.slice(0, 4)}`,
    _count: { followers: 0, following: 0 },
  };
  users.set(id, user);
  return user;
}

function seedFile(id: string, ownerUserId: string, metadata: Record<string, unknown>, size = 100): void {
  files.set(id, { _id: id, ownerUserId, size, metadata });
}

// ---------------------------------------------------------------------------
// User model double.
// ---------------------------------------------------------------------------
interface UserFilter {
  _id?: string | { $in?: string[]; $gt?: unknown };
  type?: UserType | { $ne?: UserType };
  'federation.domain'?: { $in?: string[] };
}

function matchesUser(user: StoreUser, filter: UserFilter): boolean {
  if (typeof filter.type === 'string' && user.type !== filter.type) return false;
  if (
    filter.type !== undefined &&
    typeof filter.type === 'object' &&
    filter.type.$ne !== undefined &&
    user.type === filter.type.$ne
  ) {
    return false;
  }
  const domainIn = filter['federation.domain']?.$in;
  if (domainIn !== undefined && !domainIn.includes(user.federation?.domain ?? '')) return false;
  if (typeof filter._id === 'string' && user._id !== filter._id) return false;
  if (filter._id !== undefined && typeof filter._id === 'object') {
    if (filter._id.$in !== undefined && !filter._id.$in.includes(user._id)) return false;
    // The cursor. Ids here are 24-hex strings, so lexicographic order is the
    // same order Mongo sorts the ObjectIds in.
    if (filter._id.$gt !== undefined && !(user._id > String(filter._id.$gt))) return false;
  }
  return true;
}

const mockUserCountDocuments = jest.fn(async (filter: UserFilter): Promise<number> => {
  return [...users.values()].filter((user) => matchesUser(user, filter)).length;
});

const mockUserFind = jest.fn((filter: UserFilter) => {
  const rows = [...users.values()].filter((user) => matchesUser(user, filter));
  const chain = {
    select: () => chain,
    sort: (spec: Record<string, number>) => {
      if (spec._id === 1) rows.sort((a, b) => a._id.localeCompare(b._id));
      return chain;
    },
    limit: (n: number) => {
      rows.splice(n);
      return chain;
    },
    lean: async () =>
      rows.map((user) => ({
        _id: user._id,
        username: user.username,
        federation: { domain: user.federation?.domain },
      })),
  };
  return chain;
});

const mockUserUpdateOne = jest.fn(
  async (
    filter: { _id: string; type?: UserType },
    update: { $set?: Record<string, unknown> },
  ): Promise<{ modifiedCount: number }> => {
    const user = users.get(filter._id);
    if (!user || (filter.type !== undefined && user.type !== filter.type)) {
      return { modifiedCount: 0 };
    }
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      if (path === 'accountStatus') user.accountStatus = String(value);
    }
    return { modifiedCount: 1 };
  },
);

const mockUserUpdateMany = jest.fn(
  async (
    filter: { _id?: { $in?: string[] } },
    update: { $inc?: Record<string, number> },
  ): Promise<{ modifiedCount: number }> => {
    let modifiedCount = 0;
    for (const id of filter._id?.$in ?? []) {
      const user = users.get(id);
      if (!user) continue;
      for (const [path, delta] of Object.entries(update.$inc ?? {})) {
        if (path === '_count.followers') user._count.followers += delta;
        else if (path === '_count.following') user._count.following += delta;
      }
      modifiedCount += 1;
    }
    return { modifiedCount };
  },
);

const mockUserDeleteOne = jest.fn(
  async (filter: { _id: string; type?: UserType }): Promise<{ deletedCount: number }> => {
    const user = users.get(filter._id);
    if (user && (filter.type === undefined || user.type === filter.type)) {
      users.delete(filter._id);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  },
);

// ---------------------------------------------------------------------------
// File model double.
// ---------------------------------------------------------------------------
const mockFileFind = jest.fn((filter: { ownerUserId: string }) => {
  const rows = [...files.values()].filter((file) => file.ownerUserId === filter.ownerUserId);
  const chain = {
    select: () => chain,
    lean: async () => rows.map((file) => ({ ...file })),
  };
  return chain;
});

// ---------------------------------------------------------------------------
// Follow / Block / Restricted doubles.
// ---------------------------------------------------------------------------
const mockFollowDistinct = jest.fn(
  async (field: string, filter: { followedId: string }): Promise<string[]> => {
    const out = new Set<string>();
    for (const edge of follows) {
      if (edge.followedId === filter.followedId && field === 'followerUserId') {
        out.add(edge.followerUserId);
      }
    }
    return [...out];
  },
);

const mockFollowFind = jest.fn((filter: { followerUserId?: string; followedId?: string }) => {
  const rows = follows.filter((edge) => {
    if (filter.followerUserId !== undefined && edge.followerUserId !== filter.followerUserId) {
      return false;
    }
    if (filter.followedId !== undefined && edge.followedId !== filter.followedId) return false;
    return true;
  });
  const chain = {
    select: () => chain,
    lean: async () => rows.map((edge) => ({ ...edge })),
  };
  return chain;
});

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
          (cond.followerUserId !== undefined && edge.followerUserId === cond.followerUserId) ||
          (cond.followedId !== undefined && edge.followedId === cond.followedId),
      );
      if (match) {
        follows.splice(i, 1);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  },
);

const mockBlockDeleteMany = jest.fn(async () => ({ deletedCount: 0 }));
const mockRestrictedDeleteMany = jest.fn(async () => ({ deletedCount: 0 }));
const mockAssetDeleteFile = jest.fn(async (fileId: string): Promise<void> => {
  files.delete(fileId);
});
const mockIsOwnFederationDomain = jest.fn((domain: string) => domain === 'oxy.so');

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    countDocuments: (...args: [UserFilter]) => mockUserCountDocuments(...args),
    find: (...args: [UserFilter]) => mockUserFind(...args),
    findById: jest.fn(),
    updateOne: (...args: [{ _id: string; type?: UserType }, { $set?: Record<string, unknown> }]) =>
      mockUserUpdateOne(...args),
    updateMany: (...args: [{ _id?: { $in?: string[] } }, { $inc?: Record<string, number> }]) =>
      mockUserUpdateMany(...args),
    deleteOne: (...args: [{ _id: string; type?: UserType }]) => mockUserDeleteOne(...args),
  },
}));
jest.mock('../../models/File', () => ({
  __esModule: true,
  File: { find: (...args: [{ ownerUserId: string }]) => mockFileFind(...args) },
}));
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {
    distinct: (...args: [string, { followedId: string }]) => mockFollowDistinct(...args),
    find: (...args: [Record<string, unknown>]) => mockFollowFind(...args),
    deleteMany: (...args: [{ $or?: Array<Record<string, unknown>> }]) =>
      mockFollowDeleteMany(...args),
  },
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
}));
jest.mock('../../models/Block', () => ({
  __esModule: true,
  default: { deleteMany: (...args: unknown[]) => mockBlockDeleteMany(...args) },
}));
jest.mock('../../models/Restricted', () => ({
  __esModule: true,
  default: { deleteMany: (...args: unknown[]) => mockRestrictedDeleteMany(...args) },
}));
jest.mock('../../services/assetServiceSingleton', () => ({
  __esModule: true,
  assetService: { deleteFile: (...args: [string, boolean]) => mockAssetDeleteFile(...args) },
  s3Service: {},
}));
jest.mock('../../services/federation.service', () => ({
  __esModule: true,
  getUserPublicKey: jest.fn(),
  signWithKeyId: jest.fn(),
  isOwnFederationDomain: (...args: [string]) => mockIsOwnFederationDomain(...args),
}));
jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));
jest.mock('../../utils/graphCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn(() => Promise.resolve()) },
}));

// Models / services the federation router pulls in but this suite never drives.
jest.mock('../../models/Subscription', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Application', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/credentialDomainCache', () => ({
  __esModule: true,
  default: { getAllowedDomains: jest.fn() },
}));
jest.mock('../../services/securityActivityService', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockServiceAuthMiddleware = jest.fn();
jest.mock('../../middleware/auth', () => ({
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

import federationRouter from '../federation';
import { errorHandler } from '../../middleware/errorHandler';
import userCache from '../../utils/userCache';

const mockUserCacheInvalidate = userCache.invalidate as jest.Mock;

interface PurgeData {
  requestedDomain: string;
  canonicalDomain: string;
  dryRun: boolean;
  actorsMatched: number;
  actorsProcessed: number;
  actorsDeleted: number;
  actorsRetained: Array<{ oxyUserId: string; referencedByAppIds: string[] }>;
  filesDeleted: number;
  bytesDeleted: number;
  avatarsDeleted: number;
  followEdgesRemoved: number;
  localFollowersAffected: number;
  candidatesRejected: number;
  remaining: number;
  done: boolean;
}

interface JsonResponse {
  status: number;
  body: { message?: string; error?: string; data?: PurgeData };
}

function requestJson(path: string, payload: unknown): Promise<JsonResponse> {
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
    req.write(body);
    req.end();
  });
}

/** Every write double the purge could possibly reach. */
function assertNothingWritten(): void {
  expect(mockAssetDeleteFile).not.toHaveBeenCalled();
  expect(mockUserDeleteOne).not.toHaveBeenCalled();
  expect(mockUserUpdateOne).not.toHaveBeenCalled();
  expect(mockUserUpdateMany).not.toHaveBeenCalled();
  expect(mockFollowDeleteMany).not.toHaveBeenCalled();
  expect(mockBlockDeleteMany).not.toHaveBeenCalled();
  expect(mockRestrictedDeleteMany).not.toHaveBeenCalled();
}

const CALLER_APP_ID = 'app-mention';
const OTHER_APP_ID = 'app-allo';

const BLOCKED = 'evil.example';
const ACTOR_A = 'a'.repeat(24);
const ACTOR_B = 'b'.repeat(24);
const ACTOR_WWW = 'c'.repeat(24);
const ACTOR_SUBDOMAIN = 'd'.repeat(24);
const ACTOR_OTHER_DOMAIN = 'e'.repeat(24);
const LOCAL_FOLLOWER = 'f'.repeat(24);

let server: http.Server;
const originalArmed = process.env.FEDERATION_DOMAIN_PURGE_ENABLED;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/federation', federationRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  if (originalArmed === undefined) delete process.env.FEDERATION_DOMAIN_PURGE_ENABLED;
  else process.env.FEDERATION_DOMAIN_PURGE_ENABLED = originalArmed;
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  users.clear();
  files.clear();
  follows.length = 0;
  process.env.FEDERATION_DOMAIN_PURGE_ENABLED = 'true';
  mockIsOwnFederationDomain.mockImplementation((domain: string) => domain === 'oxy.so');
  mockServiceAuthMiddleware.mockImplementation(
    (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
      req.serviceApp = {
        type: 'service',
        appId: CALLER_APP_ID,
        appName: 'mention',
        credentialId: 'cred-1',
        scopes: ['federation:write'],
      };
      next();
    },
  );
});

/** Two blocked-domain actors, each with one caller-owned file and one avatar. */
function seedBlockedDomainCorpus(): void {
  seedFederatedUser(ACTOR_A, BLOCKED);
  seedFederatedUser(ACTOR_B, BLOCKED);
  seedFile('file-a', ACTOR_A, { source: 'federation', serviceAppId: CALLER_APP_ID }, 500);
  seedFile('avatar-a', ACTOR_A, { source: 'federation', role: 'avatar' }, 20);
  seedFile('file-b', ACTOR_B, { source: 'federation', serviceAppId: CALLER_APP_ID }, 700);
  seedFile('avatar-b', ACTOR_B, { source: 'federation', role: 'avatar' }, 30);
}

describe('POST /federation/domain-purge — dry run writes nothing', () => {
  it('plans a full purge and performs ZERO writes', async () => {
    seedBlockedDomainCorpus();

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: true,
    });

    expect(res.status).toBe(200);
    const data = res.body.data as PurgeData;

    // The plan is non-empty: "wrote nothing" cannot be satisfied by "did nothing".
    expect(data.actorsMatched).toBe(2);
    expect(data.actorsProcessed).toBe(2);
    expect(data.actorsDeleted).toBe(2);
    expect(data.filesDeleted).toBe(2);
    expect(data.avatarsDeleted).toBe(2);
    expect(data.bytesDeleted).toBe(500 + 20 + 700 + 30);
    expect(data.dryRun).toBe(true);

    assertNothingWritten();
    // And the store is untouched.
    expect(users.size).toBe(2);
    expect(files.size).toBe(4);
  });

  it('defaults to a dry run when the caller omits dryRun', async () => {
    seedBlockedDomainCorpus();

    const res = await requestJson('/federation/domain-purge', { domain: BLOCKED });

    expect(res.status).toBe(200);
    expect((res.body.data as PurgeData).dryRun).toBe(true);
    expect((res.body.data as PurgeData).actorsDeleted).toBe(2);
    assertNothingWritten();
    expect(users.size).toBe(2);
  });

  it('produces the same plan on the dry run as the real run applies', async () => {
    seedBlockedDomainCorpus();
    const planned = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: true,
    })).body.data as PurgeData;

    const applied = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    })).body.data as PurgeData;

    expect(applied.actorsDeleted).toBe(planned.actorsDeleted);
    expect(applied.filesDeleted).toBe(planned.filesDeleted);
    expect(applied.avatarsDeleted).toBe(planned.avatarsDeleted);
    expect(applied.bytesDeleted).toBe(planned.bytesDeleted);
  });
});

describe('POST /federation/domain-purge — a non-blocked domain is never touched', () => {
  it('leaves a SUBDOMAIN of the blocked host untouched', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);
    seedFederatedUser(ACTOR_SUBDOMAIN, `sub.${BLOCKED}`);
    seedFile('file-sub', ACTOR_SUBDOMAIN, { source: 'federation', serviceAppId: CALLER_APP_ID });

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    expect(res.status).toBe(200);
    expect((res.body.data as PurgeData).actorsDeleted).toBe(1);
    // The subdomain actor and its file survive: the engine still federates with it.
    expect(users.has(ACTOR_SUBDOMAIN)).toBe(true);
    expect(files.has('file-sub')).toBe(true);
    expect(users.has(ACTOR_A)).toBe(false);
  });

  it('leaves an unrelated domain untouched', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);
    seedFederatedUser(ACTOR_OTHER_DOMAIN, 'good.example');
    seedFile('file-good', ACTOR_OTHER_DOMAIN, {
      source: 'federation',
      serviceAppId: CALLER_APP_ID,
    });

    await requestJson('/federation/domain-purge', { domain: BLOCKED, dryRun: false });

    expect(users.has(ACTOR_OTHER_DOMAIN)).toBe(true);
    expect(files.has('file-good')).toBe(true);
  });

  it('refuses to purge our own federation apex and writes nothing', async () => {
    seedFederatedUser(ACTOR_A, 'oxy.so');

    const res = await requestJson('/federation/domain-purge', {
      domain: 'oxy.so',
      dryRun: false,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/own federation domain/i);
    assertNothingWritten();
    expect(users.has(ACTOR_A)).toBe(true);
  });

  it('never deletes a non-federated user even if one carries the blocked domain', async () => {
    const local = seedLocalUser(ACTOR_A);
    local.federation = { domain: BLOCKED };
    seedFile('file-local', ACTOR_A, { source: 'federation', serviceAppId: CALLER_APP_ID });

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    expect(res.status).toBe(200);
    expect((res.body.data as PurgeData).actorsProcessed).toBe(0);
    expect(users.has(ACTOR_A)).toBe(true);
    expect(files.has('file-local')).toBe(true);
  });
});

describe('POST /federation/domain-purge — canonical host matching', () => {
  it('matches a stored www. spelling of the blocked host', async () => {
    seedFederatedUser(ACTOR_WWW, `www.${BLOCKED}`);
    seedFile('file-www', ACTOR_WWW, { source: 'federation', serviceAppId: CALLER_APP_ID });

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    expect((res.body.data as PurgeData).actorsDeleted).toBe(1);
    expect((res.body.data as PurgeData).candidatesRejected).toBe(0);
    expect(users.has(ACTOR_WWW)).toBe(false);
    expect(files.has('file-www')).toBe(false);
  });

  it('matches when the CALLER spells the domain with www. and the store does not', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);

    const res = await requestJson('/federation/domain-purge', {
      domain: `www.${BLOCKED}`,
      dryRun: false,
    });

    expect((res.body.data as PurgeData).canonicalDomain).toBe(BLOCKED);
    expect(users.has(ACTOR_A)).toBe(false);
  });

  /**
   * The candidate query and the re-verification are TWO separate guards, and the
   * query normally hides the second one: a subdomain row is never fetched, so
   * `isSameFederationHost` never gets to reject it. That leaves the
   * re-verification — the thing that is supposed to make a widened query
   * harmless — completely unexercised, and a test suite that only seeds a
   * subdomain passes whether it exists or not.
   *
   * So drive it at its own seam: force the query to return a row it should not
   * have, exactly as a future index/filter mistake would, and require the
   * re-verification to refuse it.
   */
  it('rejects a candidate the query returned but the canonical rule does not match', async () => {
    seedFederatedUser(ACTOR_SUBDOMAIN, `sub.${BLOCKED}`);
    seedFile('file-sub', ACTOR_SUBDOMAIN, { source: 'federation', serviceAppId: CALLER_APP_ID });
    // Simulate a candidate query wider than the canonical rule.
    mockUserFind.mockImplementationOnce(() => {
      const chain = {
        select: () => chain,
        sort: () => chain,
        limit: () => chain,
        lean: async () => [
          {
            _id: ACTOR_SUBDOMAIN,
            username: `u@sub.${BLOCKED}`,
            federation: { domain: `sub.${BLOCKED}` },
          },
        ],
      };
      return chain;
    });

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    const data = res.body.data as PurgeData;
    expect(data.candidatesRejected).toBe(1);
    expect(data.actorsProcessed).toBe(0);
    expect(data.actorsDeleted).toBe(0);
    expect(users.has(ACTOR_SUBDOMAIN)).toBe(true);
    expect(files.has('file-sub')).toBe(true);
    expect(mockAssetDeleteFile).not.toHaveBeenCalled();
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
  });

  it('rejects a domain that is not a bare host', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);

    const res = await requestJson('/federation/domain-purge', {
      domain: `https://${BLOCKED}/path`,
      dryRun: false,
    });

    expect(res.status).toBe(400);
    assertNothingWritten();
  });
});

describe('POST /federation/domain-purge — multi-tenancy', () => {
  it("never deletes another application's files, and RETAINS the shared row", async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);
    seedFile('file-mine', ACTOR_A, { source: 'federation', serviceAppId: CALLER_APP_ID }, 100);
    seedFile('file-theirs', ACTOR_A, { source: 'federation', serviceAppId: OTHER_APP_ID }, 900);
    seedFile('avatar-a', ACTOR_A, { source: 'federation', role: 'avatar' }, 20);

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    const data = res.body.data as PurgeData;
    expect(data.filesDeleted).toBe(1);
    expect(data.bytesDeleted).toBe(100);
    expect(data.actorsDeleted).toBe(0);
    expect(data.actorsRetained).toEqual([
      expect.objectContaining({ oxyUserId: ACTOR_A, referencedByAppIds: [OTHER_APP_ID] }),
    ]);

    // The other app's file AND the shared row survive; the row is archived.
    expect(files.has('file-theirs')).toBe(true);
    expect(files.has('file-mine')).toBe(false);
    // The avatar belongs to the row, which survived, so it survives too.
    expect(files.has('avatar-a')).toBe(true);
    expect(users.get(ACTOR_A)?.accountStatus).toBe('archived');
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith(ACTOR_A);
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
  });

  it('scopes deletion by the CREDENTIAL, ignoring any app id in the body', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);
    seedFile('file-theirs', ACTOR_A, { source: 'federation', serviceAppId: OTHER_APP_ID });

    // A caller trying to delete another app's data by asserting its id.
    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
      callerAppId: OTHER_APP_ID,
      serviceAppId: OTHER_APP_ID,
      appId: OTHER_APP_ID,
    });

    expect(res.status).toBe(200);
    expect((res.body.data as PurgeData).filesDeleted).toBe(0);
    expect(files.has('file-theirs')).toBe(true);
  });

  it('reports local followers so a user-visible purge is seen before it runs', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);
    seedLocalUser(LOCAL_FOLLOWER);
    follows.push({ followerUserId: LOCAL_FOLLOWER, followType: 'user', followedId: ACTOR_A });

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: true,
    });

    expect((res.body.data as PurgeData).localFollowersAffected).toBe(1);
    assertNothingWritten();
  });
});

describe('POST /federation/domain-purge — authorisation and arming', () => {
  it('rejects a credential without federation:write and reads nothing', async () => {
    mockServiceAuthMiddleware.mockImplementationOnce(
      (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
        req.serviceApp = {
          type: 'service',
          appId: CALLER_APP_ID,
          appName: 'limited',
          credentialId: 'cred-1',
          scopes: [],
        };
        next();
      },
    );
    seedBlockedDomainCorpus();

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    expect(res.status).toBe(403);
    expect(mockUserFind).not.toHaveBeenCalled();
    assertNothingWritten();
  });

  it('refuses a real purge when the deployment is not armed', async () => {
    process.env.FEDERATION_DOMAIN_PURGE_ENABLED = 'false';
    seedBlockedDomainCorpus();

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/FEDERATION_DOMAIN_PURGE_ENABLED/);
    expect(mockUserFind).not.toHaveBeenCalled();
    assertNothingWritten();
    expect(users.size).toBe(2);
  });

  it('still allows a DRY RUN on an unarmed deployment', async () => {
    process.env.FEDERATION_DOMAIN_PURGE_ENABLED = 'false';
    seedBlockedDomainCorpus();

    const res = await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: true,
    });

    expect(res.status).toBe(200);
    expect((res.body.data as PurgeData).actorsDeleted).toBe(2);
    assertNothingWritten();
  });
});

describe('POST /federation/domain-purge — bounded, resumable, idempotent', () => {
  it('processes at most `limit` actors and resumes from the cursor', async () => {
    seedBlockedDomainCorpus();

    const first = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
      limit: 1,
    })).body.data as PurgeData;

    expect(first.actorsProcessed).toBe(1);
    expect(first.actorsDeleted).toBe(1);
    expect(first.done).toBe(false);
    expect(first.nextCursor).toBe(ACTOR_A);
    expect(users.size).toBe(1);

    const second = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
      limit: 1,
      afterId: first.nextCursor,
    })).body.data as PurgeData;

    expect(second.actorsProcessed).toBe(1);
    expect(second.remaining).toBe(0);
    expect(users.size).toBe(0);
    expect(files.size).toBe(0);
  });

  /**
   * Progress must not depend on rows disappearing. A DRY RUN deletes nothing,
   * so a loop keyed on "are any rows left?" re-fetches the same head of the
   * batch forever while reporting steady progress. The cursor is what makes a
   * dry run terminate, so drive a whole one and require it to end.
   */
  it('a dry run walks to completion instead of looping on the first batch', async () => {
    seedBlockedDomainCorpus();

    const seen: string[] = [];
    let cursor: string | null = null;
    let pass = 0;

    for (;;) {
      pass += 1;
      expect(pass).toBeLessThanOrEqual(5); // a livelock fails here, loudly
      const body: Record<string, unknown> = { domain: BLOCKED, dryRun: true, limit: 1 };
      if (cursor !== null) body.afterId = cursor;
      const data = (await requestJson('/federation/domain-purge', body)).body.data as PurgeData;
      if (data.nextCursor !== null) seen.push(data.nextCursor);
      cursor = data.nextCursor;
      if (data.done) break;
    }

    // Both actors were visited exactly once, and nothing was written.
    expect(seen).toEqual([ACTOR_A, ACTOR_B]);
    expect(users.size).toBe(2);
    assertNothingWritten();
  });

  it('is a no-op when repeated after the domain is already purged', async () => {
    seedBlockedDomainCorpus();
    await requestJson('/federation/domain-purge', { domain: BLOCKED, dryRun: false });

    jest.clearAllMocks();
    const repeat = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
    })).body.data as PurgeData;

    expect(repeat.actorsMatched).toBe(0);
    expect(repeat.actorsProcessed).toBe(0);
    expect(repeat.actorsDeleted).toBe(0);
    expect(repeat.done).toBe(true);
    expect(repeat.nextCursor).toBeNull();
    assertNothingWritten();
  });

  /**
   * A retained row keeps matching the domain forever by design. If progress were
   * keyed on `remaining`, a batch full of retained rows would be re-fetched on
   * every pass and the caller would never terminate. The cursor steps past them.
   */
  it('advances past a retained actor instead of re-fetching it forever', async () => {
    seedFederatedUser(ACTOR_A, BLOCKED);
    seedFile('file-theirs', ACTOR_A, { source: 'federation', serviceAppId: OTHER_APP_ID });
    seedFederatedUser(ACTOR_B, BLOCKED);
    seedFile('file-mine', ACTOR_B, { source: 'federation', serviceAppId: CALLER_APP_ID });

    const first = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
      limit: 1,
    })).body.data as PurgeData;

    expect(first.actorsRetained).toHaveLength(1);
    expect(first.nextCursor).toBe(ACTOR_A);
    // The retained row is still there and still matches — so `remaining` alone
    // could never be the loop condition.
    expect(first.remaining).toBeGreaterThan(0);

    const second = (await requestJson('/federation/domain-purge', {
      domain: BLOCKED,
      dryRun: false,
      limit: 1,
      afterId: first.nextCursor,
    })).body.data as PurgeData;

    // The cursor moved past the retained row onto the next actor.
    expect(second.actorsDeleted).toBe(1);
    expect(users.has(ACTOR_B)).toBe(false);
    expect(users.has(ACTOR_A)).toBe(true);
    expect(files.has('file-theirs')).toBe(true);
  });
});
