/**
 * POST/DELETE /notifications/push-token — device- and app-scoped registration.
 *
 * The install's owning application is resolved SERVER-side from the caller's
 * `clientId` (an `ApplicationCredential.publicKey`) through the shared
 * usable-credential predicate. A `clientId` that does not resolve to an active
 * application is REJECTED — never silently stored as an unscoped token, because
 * an unscoped token is invisible to every capability-scoped delivery decision.
 *
 * The pre-existing unscoped registration (no `deviceId`, no `clientId`) must keep
 * working byte-for-byte: the email push registry predates the scoping.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockPushTokenFindOneAndUpdate = jest.fn();
const mockPushTokenDeleteOne = jest.fn();
const mockCredentialFindOne = jest.fn();
const mockApplicationFindById = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1' };
    next();
  },
  serviceAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../controllers/notification.controller', () => ({
  getNotifications: jest.fn(),
  createNotification: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
  getUnreadCount: jest.fn(),
}));

jest.mock('../../models/PushToken', () => ({
  __esModule: true,
  PushToken: { findOneAndUpdate: mockPushTokenFindOneAndUpdate, deleteOne: mockPushTokenDeleteOne },
  default: { findOneAndUpdate: mockPushTokenFindOneAndUpdate, deleteOne: mockPushTokenDeleteOne },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: mockCredentialFindOne },
  default: { findOne: mockCredentialFindOne },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findById: mockApplicationFindById },
  default: { findById: mockApplicationFindById },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import notificationsRouter from '../notifications.routes';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(
  server: http.Server,
  method: 'POST' | 'DELETE',
  path: string,
  payload: Record<string, unknown>,
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }),
        );
      },
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
  app.use('/notifications', notificationsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => { server.close(done); });

beforeEach(() => {
  jest.clearAllMocks();
  mockPushTokenFindOneAndUpdate.mockResolvedValue({});
  mockPushTokenDeleteOne.mockResolvedValue({ deletedCount: 1 });
});

describe('POST /notifications/push-token — application scope', () => {
  it('resolves clientId to its application and stores the scope', async () => {
    mockCredentialFindOne.mockResolvedValue({
      publicKey: 'oxy_dk_commons',
      applicationId: 'app-commons',
      status: 'active',
    });
    mockApplicationFindById.mockResolvedValue({ _id: 'app-commons', status: 'active' });

    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[vault]',
      platform: 'ios',
      deviceId: 'device-abc',
      clientId: 'oxy_dk_commons',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ registered: true });

    expect(mockCredentialFindOne).toHaveBeenCalledWith({ publicKey: 'oxy_dk_commons' });
    expect(mockApplicationFindById).toHaveBeenCalledWith('app-commons');

    const [filter, update, options] = mockPushTokenFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
      Record<string, unknown>,
    ];
    expect(filter).toEqual({ userId: 'user-1', token: 'ExponentPushToken[vault]' });
    expect(Object.keys(update)).toEqual(['$set']);
    expect(update.$set).toEqual({
      userId: 'user-1',
      token: 'ExponentPushToken[vault]',
      platform: 'ios',
      deviceId: 'device-abc',
      applicationId: 'app-commons',
    });
    expect(options).toEqual({ upsert: true, new: true });
  });

  it('rejects a clientId whose credential is revoked, storing nothing', async () => {
    mockCredentialFindOne.mockResolvedValue({
      publicKey: 'oxy_dk_dead',
      applicationId: 'app-commons',
      status: 'revoked',
    });

    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[vault]',
      platform: 'ios',
      clientId: 'oxy_dk_dead',
    });

    expect(res.status).toBe(400);
    expect(mockApplicationFindById).not.toHaveBeenCalled();
    expect(mockPushTokenFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a clientId whose rotation grace has elapsed', async () => {
    mockCredentialFindOne.mockResolvedValue({
      publicKey: 'oxy_dk_stale',
      applicationId: 'app-commons',
      status: 'deprecated',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[vault]',
      platform: 'ios',
      clientId: 'oxy_dk_stale',
    });

    expect(res.status).toBe(400);
    expect(mockPushTokenFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects an unknown clientId, storing nothing', async () => {
    mockCredentialFindOne.mockResolvedValue(null);

    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[vault]',
      platform: 'android',
      clientId: 'oxy_dk_nope',
    });

    expect(res.status).toBe(400);
    expect(mockPushTokenFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a clientId whose application is no longer active', async () => {
    mockCredentialFindOne.mockResolvedValue({
      publicKey: 'oxy_dk_commons',
      applicationId: 'app-commons',
      status: 'active',
    });
    mockApplicationFindById.mockResolvedValue({ _id: 'app-commons', status: 'suspended' });

    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[vault]',
      platform: 'ios',
      clientId: 'oxy_dk_commons',
    });

    expect(res.status).toBe(400);
    expect(mockPushTokenFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /notifications/push-token — unscoped registration still works', () => {
  it('registers without deviceId/clientId exactly as before', async () => {
    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[email]',
      platform: 'web',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ registered: true });
    expect(mockCredentialFindOne).not.toHaveBeenCalled();

    const [filter, update] = mockPushTokenFindOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter).toEqual({ userId: 'user-1', token: 'ExponentPushToken[email]' });
    expect(update.$set).toEqual({
      userId: 'user-1',
      token: 'ExponentPushToken[email]',
      platform: 'web',
    });
  });

  it('never writes an unwhitelisted field from the body', async () => {
    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[email]',
      platform: 'web',
      userId: 'someone-else',
      applicationId: 'app-forged',
    });

    expect(res.status).toBe(200);
    const [, update] = mockPushTokenFindOneAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, Record<string, unknown>>,
    ];
    expect(update.$set.userId).toBe('user-1');
    expect(update.$set.applicationId).toBeUndefined();
  });

  it('rejects an unsupported platform', async () => {
    const res = await request(server, 'POST', '/notifications/push-token', {
      token: 'ExponentPushToken[email]',
      platform: 'blackberry',
    });

    expect(res.status).toBe(400);
    expect(mockPushTokenFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    const res = await request(server, 'POST', '/notifications/push-token', { platform: 'ios' });

    expect(res.status).toBe(400);
    expect(mockPushTokenFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('DELETE /notifications/push-token', () => {
  it('unregisters only the caller\'s own token', async () => {
    const res = await request(server, 'DELETE', '/notifications/push-token', {
      token: 'ExponentPushToken[vault]',
      userId: 'someone-else',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ unregistered: true });
    expect(mockPushTokenDeleteOne).toHaveBeenCalledWith({
      userId: 'user-1',
      token: 'ExponentPushToken[vault]',
    });
  });

  it('rejects a missing token', async () => {
    const res = await request(server, 'DELETE', '/notifications/push-token', {});

    expect(res.status).toBe(400);
    expect(mockPushTokenDeleteOne).not.toHaveBeenCalled();
  });
});
