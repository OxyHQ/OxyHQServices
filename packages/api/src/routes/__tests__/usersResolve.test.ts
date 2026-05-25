/**
 * /users/resolve scope + binding tests (C4 regression coverage)
 *
 * Walks the route through every rejection path:
 *  - missing scope on the service token
 *  - actorUri hostname does not match the asserted domain
 *  - agent/automated username collides with an existing local user
 *  - existing user has a different `type` (no silent type promotion)
 *
 * The router is mounted on a minimal Express app and exercised via
 * `node:http` round-trips so we hit the real middleware chain.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockServiceAuthMiddleware = jest.fn();
const mockAuthMiddleware = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserFindOneAndUpdate = jest.fn();
const mockFederationDownloadAvatar = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

// Many of the existing user routes import services that need a real DB.
// We stub all of them to no-op so importing the router doesn't crash.
jest.mock('../../services/email.service', () => ({
  emailService: { deleteAllUserData: jest.fn() },
}));
jest.mock('../../services/federation.service', () => ({
  federationService: { downloadAndStoreAvatar: mockFederationDownloadAvatar },
}));
jest.mock('../../services/user.service', () => ({
  userService: {},
}));
jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../controllers/users.controller', () => ({
  UsersController: class {
    searchUsers = jest.fn();
  },
}));
jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn() },
}));
jest.mock('../../utils/validation', () => ({
  resolveUserIdToObjectId: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  default: {
    findOne: mockUserFindOne,
    findOneAndUpdate: mockUserFindOneAndUpdate,
  },
}));

import usersRouter from '../users';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: { error?: string; message?: string; data?: unknown };
}

async function requestJson(server: http.Server, method: string, path: string, payload: unknown): Promise<JsonResponse> {
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
        res.on('data', (chunk) => { raw += chunk; });
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

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindOne.mockReset();
  mockUserFindOneAndUpdate.mockReset();
  // Default: serviceAuthMiddleware grants the federation:write scope.
  mockServiceAuthMiddleware.mockImplementation(
    (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
      req.serviceApp = {
        type: 'service',
        appId: 'app-1',
        appName: 'fed-svc',
        scopes: ['federation:write'],
      };
      next();
    }
  );
});

describe('PUT /users/resolve (C4)', () => {
  it('rejects when the service token lacks federation:write scope', async () => {
    // Override the default mock so this caller has no scopes.
    mockServiceAuthMiddleware.mockImplementationOnce(
      (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
        req.serviceApp = {
          type: 'service',
          appId: 'app-1',
          appName: 'limited-svc',
          scopes: [],
        };
        next();
      }
    );

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
    });

    expect(res.status).toBe(403);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when actorUri hostname does not match the asserted domain', async () => {
    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'mallory@mastodon.social',
      // Hostname is `evil.example` — should be rejected.
      actorUri: 'https://evil.example/users/mallory',
      domain: 'mastodon.social',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/actorUri hostname/i);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects agent username that collides with an existing local user', async () => {
    const leanResult = jest.fn().mockResolvedValue({ _id: 'local-id', type: 'local' });
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'agent',
      username: 'alice',
      ownerId: 'owner-1',
    });

    expect(res.status).toBe(409);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when an existing user has a different type (no type promotion)', async () => {
    // First findOne: collision check for agents/automated — no local user.
    const leanResult1 = jest.fn().mockResolvedValue(null);
    const selectResult1 = jest.fn().mockReturnValue({ lean: leanResult1 });
    // Second findOne: existing user has type 'automated' but caller asserts 'agent'.
    const leanResult2 = jest.fn().mockResolvedValue({ _id: 'u', type: 'automated' });
    const selectResult2 = jest.fn().mockReturnValue({ lean: leanResult2 });
    mockUserFindOne
      .mockReturnValueOnce({ select: selectResult1 })
      .mockReturnValueOnce({ select: selectResult2 });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'agent',
      username: 'bot1',
      ownerId: 'owner-1',
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cannot change.*type/i);
    expect(mockUserFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('happy path: federated user is resolved when scope + bindings are valid', async () => {
    const leanResult = jest.fn().mockResolvedValue(null);
    const selectResult = jest.fn().mockReturnValue({ lean: leanResult });
    mockUserFindOne.mockReturnValueOnce({ select: selectResult });

    const newUserDoc = { _id: 'new-user', username: 'alice@mastodon.social', type: 'federated' };
    const updateLean = jest.fn().mockResolvedValue(newUserDoc);
    const updateSelect = jest.fn().mockReturnValue({ lean: updateLean });
    mockUserFindOneAndUpdate.mockReturnValueOnce({ select: updateSelect });

    const res = await requestJson(server, 'PUT', '/users/resolve', {
      type: 'federated',
      username: 'alice@mastodon.social',
      actorUri: 'https://mastodon.social/users/alice',
      domain: 'mastodon.social',
    });

    expect(res.status).toBe(200);
    expect(mockUserFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
