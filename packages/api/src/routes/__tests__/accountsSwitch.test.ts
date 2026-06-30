/**
 * POST /accounts/:id/switch — true account switch (mints a REAL session whose
 * user IS the target managed account), replacing the old X-Acting-As delegation.
 *
 * Mounts the real accounts router over HTTP. Collaborators are mocked so we drive
 * the authorization gate + response shape without a database:
 *  - account.service.verifyActingAs → controls act_as authorization,
 *  - User.findById → the target account doc,
 *  - sessionService.createSession + issueAndSetRefreshCookie → session minting.
 *
 * Asserts: non-members are rejected (403); a personal account is never a switch
 * target (403); an authorized member mints a session whose user is the target and
 * records the operator; the response mirrors the login/claimSession shape.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Types } from 'mongoose';

jest.mock('mongoose', () => jest.requireActual('mongoose'));

const OPERATOR_ID = '6a0000000000000000000001';
const ORG_ID = '6a0000000000000000000010';

const mockVerifyActingAs = jest.fn();
jest.mock('../../services/account.service', () => ({
  __esModule: true,
  accountService: { verifyActingAs: (...args: unknown[]) => mockVerifyActingAs(...args) },
}));

const mockFindById = jest.fn();
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockFindById(...args) },
  default: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

const mockCreateSession = jest.fn();
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: (...args: unknown[]) => mockCreateSession(...args) },
}));

const mockIssueCookie = jest.fn();
jest.mock('../../services/refreshToken.service', () => ({
  __esModule: true,
  issueAndSetRefreshCookie: (...args: unknown[]) => mockIssueCookie(...args),
}));

const mockAuthMiddleware = jest.fn();
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/requireStaff', () => ({ isStaffUser: () => false }));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import accountsRouter from '../accounts';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown> & {
    user?: { id?: string; username?: string };
    sessionId?: string;
    accessToken?: string;
    authuser?: number;
    error?: string;
    message?: string;
  };
}

function post(srv: http.Server, path: string): Promise<JsonResponse> {
  const address = srv.address() as AddressInfo;
  const body = JSON.stringify({});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), Authorization: 'Bearer t' },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) { reject(err); }
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
  mockAuthMiddleware.mockImplementation((req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user?: unknown }).user = { _id: { toString: () => OPERATOR_ID } };
    next();
  });
  const app = express();
  app.use(express.json());
  app.use('/accounts', accountsRouter);
  app.use(errorHandler);
  server = app.listen(0, done);
});

afterAll((done) => { server.close(done); });

beforeEach(() => {
  mockVerifyActingAs.mockReset();
  mockFindById.mockReset();
  mockCreateSession.mockReset();
  mockIssueCookie.mockReset();
});

describe('POST /accounts/:id/switch', () => {
  it('rejects a caller without act_as on the target (403)', async () => {
    mockVerifyActingAs.mockResolvedValue(null);

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(403);
    expect(mockVerifyActingAs).toHaveBeenCalledWith(OPERATOR_ID, ORG_ID);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('refuses to switch INTO a personal account (403) even with act_as', async () => {
    mockVerifyActingAs.mockResolvedValue('owner');
    mockFindById.mockResolvedValue({
      _id: new Types.ObjectId(ORG_ID),
      username: 'someone',
      kind: 'personal',
      accountStatus: 'active',
    });

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(403);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('mints a real session AS the managed account for an authorized member', async () => {
    mockVerifyActingAs.mockResolvedValue('admin');
    mockFindById.mockResolvedValue({
      _id: new Types.ObjectId(ORG_ID),
      username: 'acme-org',
      kind: 'organization',
      accountStatus: 'active',
    });
    mockCreateSession.mockResolvedValue({
      sessionId: 'sess-1',
      deviceId: 'dev-1',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      accessToken: 'acc-1',
    });
    mockIssueCookie.mockResolvedValue({ accessToken: 'acc-1', expiresAt: new Date(), authuser: 2 });

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(200);
    // The session's user IS the target account (a true switch, not delegation).
    expect(res.body.user?.id).toBe(ORG_ID);
    expect(res.body.user?.username).toBe('acme-org');
    expect(res.body.sessionId).toBe('sess-1');
    expect(res.body.accessToken).toBe('acc-1');
    expect(res.body.authuser).toBe(2);
    // Operator recorded on the minted session.
    expect(mockCreateSession).toHaveBeenCalledWith(ORG_ID, expect.anything(), { operatedByUserId: OPERATOR_ID });
    // Added to the device multi-account set.
    expect(mockIssueCookie).toHaveBeenCalled();
  });

  it('returns 404 for a missing/archived target', async () => {
    mockVerifyActingAs.mockResolvedValue('admin');
    mockFindById.mockResolvedValue(null);

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(404);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
