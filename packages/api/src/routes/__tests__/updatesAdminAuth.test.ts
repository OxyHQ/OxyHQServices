/**
 * Admin route authorization tests — the security core of the publish API. A
 * service token may only publish to its OWN app and only with the
 * `updates:publish` scope; a user bearer needs the `updates:manage` application
 * permission (owner/admin/developer). The permission map (`accountRoles`) and the
 * contract schemas are REAL; the token verifier, session middleware, account
 * service, Application model, and publish service are mocked.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const APP_ID = '507f1f77bcf86cd799439011';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const mockVerify = jest.fn();
const mockAuthMiddleware = jest.fn();
const mockResolveAccess = jest.fn();
const mockAppFindOne = jest.fn();
const mockCreateUpdate = jest.fn();

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/serviceToken', () => ({
  __esModule: true,
  verifyServiceToken: (...a: unknown[]) => mockVerify(...a),
}));
jest.mock('../../middleware/auth', () => ({
  __esModule: true,
  authMiddleware: (...a: unknown[]) => mockAuthMiddleware(...a),
}));
jest.mock('../../services/account.service', () => ({
  __esModule: true,
  accountService: { resolveEffectiveAccess: (...a: unknown[]) => mockResolveAccess(...a) },
}));
jest.mock('../../models/Application', () => ({
  __esModule: true,
  default: { findOne: (...a: unknown[]) => mockAppFindOne(...a) },
}));
jest.mock('../../services/updates/publish.service', () => ({
  __esModule: true,
  initAssets: jest.fn(),
  completeAssets: jest.fn(),
  createUpdate: (...a: unknown[]) => mockCreateUpdate(...a),
  setRollout: jest.fn(),
  rollback: jest.fn(),
  rollbackToEmbedded: jest.fn(),
  promote: jest.fn(),
  listChannels: jest.fn(),
  listUpdates: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import adminRouter from '../updatesAdmin';
import { errorHandler } from '../../middleware/errorHandler';

function makeServer(): http.Server {
  const app = express();
  app.use(express.json());
  app.use('/updates/v1', adminRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

async function post(
  server: http.Server,
  path: string,
  body: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const VALID_CREATE_BODY = {
  applicationId: APP_ID,
  channel: 'production',
  runtimeVersion: '1.0.0',
  platform: 'ios',
  launchAsset: { sha256: SHA_A, key: 'bundle', contentType: 'application/javascript' },
  assets: [{ sha256: SHA_B, key: 'img', contentType: 'image/png', fileExtension: '.png' }],
  extra: { expoClient: { name: 'demo' } },
};

let server: http.Server;

beforeEach((done) => {
  jest.clearAllMocks();
  mockCreateUpdate.mockResolvedValue({ id: 'new-uuid' });
  server = makeServer();
  server.listen(0, done);
});

afterEach((done) => {
  server.close(done);
});

describe('service-token authorization', () => {
  test('valid scope + matching appId → publishes', async () => {
    mockVerify.mockReturnValue({
      ok: true,
      payload: { type: 'service', appId: APP_ID, appName: 'x', credentialId: 'c', scopes: ['updates:publish'] },
    });
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(200);
    expect(mockCreateUpdate).toHaveBeenCalledTimes(1);
  });

  test('missing updates:publish scope → 403', async () => {
    mockVerify.mockReturnValue({
      ok: true,
      payload: { type: 'service', appId: APP_ID, appName: 'x', credentialId: 'c', scopes: ['files:read'] },
    });
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(403);
    expect(mockCreateUpdate).not.toHaveBeenCalled();
  });

  test('appId not matching the target application → 403', async () => {
    mockVerify.mockReturnValue({
      ok: true,
      payload: {
        type: 'service',
        appId: '507f1f77bcf86cd799439099',
        appName: 'x',
        credentialId: 'c',
        scopes: ['updates:publish'],
      },
    });
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(403);
    expect(mockCreateUpdate).not.toHaveBeenCalled();
  });
});

describe('user-bearer authorization', () => {
  beforeEach(() => {
    // Not a service token → fall through to the (mocked) session middleware.
    mockVerify.mockReturnValue({ ok: false, reason: 'not_service' });
    mockAppFindOne.mockReturnValue({
      select: () => Promise.resolve({ ownerAccountId: { toString: () => 'acct1' } }),
    });
  });

  function authAs(userId: string): void {
    mockAuthMiddleware.mockImplementation((req: express.Request, _res: express.Response, next: () => void) => {
      (req as express.Request & { user?: unknown }).user = { _id: { toString: () => userId } };
      next();
    });
  }

  test('developer role (has updates:manage) → publishes', async () => {
    authAs('user1');
    mockResolveAccess.mockResolvedValue({ role: 'developer' });
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(200);
    expect(mockCreateUpdate).toHaveBeenCalledTimes(1);
  });

  test('owner role → publishes', async () => {
    authAs('user1');
    mockResolveAccess.mockResolvedValue({ role: 'owner' });
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(200);
  });

  test('viewer role (no updates:manage) → 403', async () => {
    authAs('user1');
    mockResolveAccess.mockResolvedValue({ role: 'viewer' });
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(403);
    expect(mockCreateUpdate).not.toHaveBeenCalled();
  });

  test('no account access to the app → 403', async () => {
    authAs('user1');
    mockResolveAccess.mockResolvedValue(null);
    const { status } = await post(server, '/updates/v1/updates', VALID_CREATE_BODY);
    expect(status).toBe(403);
  });
});

describe('request validation', () => {
  test('an invalid body is rejected before any authorization side effects', async () => {
    mockVerify.mockReturnValue({
      ok: true,
      payload: { type: 'service', appId: APP_ID, appName: 'x', credentialId: 'c', scopes: ['updates:publish'] },
    });
    // Missing launchAsset/assets/extra → schema failure → 422 (ValidationError).
    const { status } = await post(server, '/updates/v1/updates', {
      applicationId: APP_ID,
      channel: 'production',
      runtimeVersion: '1.0.0',
      platform: 'ios',
    });
    expect(status).toBe(422);
    expect(mockCreateUpdate).not.toHaveBeenCalled();
  });
});
