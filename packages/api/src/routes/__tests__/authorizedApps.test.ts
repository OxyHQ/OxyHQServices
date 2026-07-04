/**
 * /apps/authorized — connected-apps management on AppGrant.
 *
 *   GET    /apps/authorized            → { data: { apps: [...] } }
 *   DELETE /apps/authorized/:clientId  → 204
 *
 * Replaces the deleted FedCM authorized-apps surface.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAppGrantFind = jest.fn();
const mockAppGrantDeleteOne = jest.fn();
const mockApplicationFindById = jest.fn();
const mockCredentialFindOne = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user?: unknown }).user = { id: 'user-1' };
    next();
  },
}));
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { find: (...a: unknown[]) => mockAppGrantFind(...a), deleteOne: (...a: unknown[]) => mockAppGrantDeleteOne(...a) },
  default: { find: (...a: unknown[]) => mockAppGrantFind(...a), deleteOne: (...a: unknown[]) => mockAppGrantDeleteOne(...a) },
}));
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findById: (...a: unknown[]) => mockApplicationFindById(...a) },
  default: { findById: (...a: unknown[]) => mockApplicationFindById(...a) },
}));
jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: (...a: unknown[]) => mockCredentialFindOne(...a) },
  default: { findOne: (...a: unknown[]) => mockCredentialFindOne(...a) },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import authorizedAppsRouter from '../authorizedApps';

const lean = (v: unknown) => ({ select: () => ({ lean: () => Promise.resolve(v) }) });
const sortLean = (v: unknown) => ({ select: () => ({ sort: () => ({ lean: () => Promise.resolve(v) }) }) });

async function request(server: http.Server, method: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port: address.port, path, headers: { Authorization: 'Bearer t' } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;
beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/apps', authorizedAppsRouter);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => { jest.clearAllMocks(); });

describe('GET /apps/authorized', () => {
  it('returns the connected apps with clientId/appName/appIconUrl/grantedAt/scopes', async () => {
    mockAppGrantFind.mockReturnValueOnce(sortLean([
      { applicationId: 'app-1', scopes: ['read', 'write'], firstGrantedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]));
    mockApplicationFindById.mockReturnValueOnce(lean({ name: 'Acme', icon: 'https://cdn/acme.png' }));
    mockCredentialFindOne.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ publicKey: 'oxy_dk_acme' }) }) });

    const res = await request(server, 'GET', '/apps/authorized');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        apps: [
          { clientId: 'oxy_dk_acme', appName: 'Acme', appIconUrl: 'https://cdn/acme.png', grantedAt: '2026-01-01T00:00:00.000Z', scopes: ['read', 'write'] },
        ],
      },
    });
  });

  it('skips a grant whose application or public credential no longer resolves', async () => {
    mockAppGrantFind.mockReturnValueOnce(sortLean([
      { applicationId: 'gone', scopes: [], firstGrantedAt: new Date() },
      { applicationId: 'no-cred', scopes: [], firstGrantedAt: new Date() },
    ]));
    // First app is gone (null); second app resolves but has no public credential.
    mockApplicationFindById
      .mockReturnValueOnce(lean(null))
      .mockReturnValueOnce(lean({ name: 'NoCred' }));
    mockCredentialFindOne.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = await request(server, 'GET', '/apps/authorized');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { apps: [] } });
  });
});

describe('DELETE /apps/authorized/:clientId', () => {
  it('resolves the clientId to an application and deletes the AppGrant (204)', async () => {
    mockCredentialFindOne.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ applicationId: 'app-1' }) }) });
    mockAppGrantDeleteOne.mockResolvedValueOnce({ deletedCount: 1 });

    const res = await request(server, 'DELETE', '/apps/authorized/oxy_dk_acme');

    expect(res.status).toBe(204);
    expect(mockAppGrantDeleteOne).toHaveBeenCalledWith({ userId: 'user-1', applicationId: 'app-1' });
  });

  it('is idempotent: 204 for an unknown clientId (no delete)', async () => {
    mockCredentialFindOne.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const res = await request(server, 'DELETE', '/apps/authorized/unknown');
    expect(res.status).toBe(204);
    expect(mockAppGrantDeleteOne).not.toHaveBeenCalled();
  });
});
