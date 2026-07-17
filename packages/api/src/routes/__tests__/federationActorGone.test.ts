/**
 * POST /federation/actor-gone — service-credential "mark federated identity gone"
 * bridge.
 *
 * Mention is the only component that talks to the remote fediverse; when it gets
 * an HTTP 410 Gone for an actor it calls this route to archive the corresponding
 * Oxy user so the dead identity leaves discovery/search surfaces. The suite walks
 * the trust boundary and the idempotency guarantee:
 *
 *  - missing federation:write scope                         → 403
 *  - body fails schema validation (non-ObjectId oxyUserId)  → 400
 *  - unknown user                                           → 404
 *  - target is NOT a federated user (local/agent/automated) → 409 (never written)
 *  - a live federated actor is archived exactly once        → 200
 *  - a repeated call on an already-archived actor is a no-op → idempotent 200
 *
 * The real router AND the real body schema run; only the Mongoose model + the
 * user cache are replaced with in-memory doubles so the archival write and the
 * cache invalidation can be asserted end-to-end.
 */

// The global jest.setup mocks `mongoose` wholesale (stripping `Types`). Restore
// the real module so the router's imports behave.
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { __esModule: true, ...actual, default: actual };
});

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// In-memory User store.
// ---------------------------------------------------------------------------
type UserType = 'local' | 'federated' | 'agent' | 'automated';
interface StoreUser {
  _id: string;
  type: UserType;
  accountStatus: string;
}

const users = new Map<string, StoreUser>();

function seedUser(id: string, type: UserType, accountStatus = 'active'): StoreUser {
  const user: StoreUser = { _id: id, type, accountStatus };
  users.set(id, user);
  return user;
}

const mockUserFindById = jest.fn((id: string) => {
  const doc = users.get(id) ?? null;
  return {
    select(): { lean(): Promise<StoreUser | null> } {
      return { lean: () => Promise.resolve(doc) };
    },
  };
});

const mockUserUpdateOne = jest.fn(
  async (
    filter: { _id: string; type?: string },
    update: { $set?: Record<string, unknown> }
  ): Promise<{ matchedCount: number; modifiedCount: number }> => {
    const user = users.get(filter._id);
    // Honour the route's `type: 'federated'` guard clause on the write filter.
    if (user && (filter.type === undefined || user.type === filter.type)) {
      if (update.$set) Object.assign(user, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  }
);

const mockUserCacheInvalidate = jest.fn();

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findById: (...args: [string]) => mockUserFindById(...args),
    updateOne: (...args: [{ _id: string; type?: string }, { $set?: Record<string, unknown> }]) =>
      mockUserUpdateOne(...args),
  },
}));
jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockUserCacheInvalidate(...args) },
}));

// Models / services the federation router (via user.service) pulls in but that
// this suite does not exercise — stubbed so importing the router stays light.
jest.mock('../../models/Follow', () => ({
  __esModule: true,
  default: {},
  FollowType: { USER: 'user', HASHTAG: 'hashtag', TOPIC: 'topic' },
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
    data?: { oxyUserId?: string; accountStatus?: string; alreadyArchived?: boolean };
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

describe('POST /federation/actor-gone', () => {
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

    const res = await requestJson(server, 'POST', '/federation/actor-gone', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/federation:write/i);
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
  });

  it('rejects a body that fails schema validation (non-ObjectId id)', async () => {
    const res = await requestJson(server, 'POST', '/federation/actor-gone', {
      oxyUserId: 'not-an-object-id',
    });

    expect(res.status).toBe(400);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the user does not exist', async () => {
    const res = await requestJson(server, 'POST', '/federation/actor-gone', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/user not found/i);
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
  });

  it('refuses (409) to archive a non-federated (local) user and never writes', async () => {
    const local = seedUser(LOCAL_ID, 'local');

    const res = await requestJson(server, 'POST', '/federation/actor-gone', {
      oxyUserId: LOCAL_ID,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not a federated actor/i);
    // The real account was never touched.
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockUserCacheInvalidate).not.toHaveBeenCalled();
    expect(local.accountStatus).toBe('active');
  });

  it('archives a live federated actor exactly once and invalidates its cache', async () => {
    const actor = seedUser(FEDERATED_ID, 'federated', 'active');

    const res = await requestJson(server, 'POST', '/federation/actor-gone', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      oxyUserId: FEDERATED_ID,
      accountStatus: 'archived',
      alreadyArchived: false,
    });
    expect(actor.accountStatus).toBe('archived');
    // The write whitelists only accountStatus and re-asserts the federated guard.
    expect(mockUserUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockUserUpdateOne).toHaveBeenCalledWith(
      { _id: FEDERATED_ID, type: 'federated' },
      { $set: { accountStatus: 'archived' } }
    );
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith(FEDERATED_ID);
  });

  it('is idempotent: an already-archived actor is a 200 no-op (no write, no invalidate)', async () => {
    seedUser(FEDERATED_ID, 'federated', 'archived');

    const res = await requestJson(server, 'POST', '/federation/actor-gone', {
      oxyUserId: FEDERATED_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      oxyUserId: FEDERATED_ID,
      accountStatus: 'archived',
      alreadyArchived: true,
    });
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockUserCacheInvalidate).not.toHaveBeenCalled();
  });
});
