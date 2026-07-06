/**
 * POST /accounts/:id/switch — true account switch (mints a REAL session whose
 * user IS the target managed account), replacing the old X-Acting-As delegation.
 *
 * Mounts the real accounts router over HTTP. Collaborators are mocked so we drive
 * the authorization gate + response shape without a database:
 *  - account.service.verifyActingAs → controls act_as authorization,
 *  - User.findById → the target account doc,
 *  - sessionService.createSession → session minting.
 *
 * Asserts: non-members are rejected (403); a personal account is never a switch
 * target (403); an authorized member mints a session whose user is the target and
 * records the operator; the response mirrors the login/claimSession shape.
 *
 * ROOT-CAUSE GUARD (slot-clobber regression): the switch route MUST NOT write any
 * per-slot refresh cookie (deleted transport). Those cookies were `Path=/auth` scoped, so
 * the browser never sends them to this `/accounts/*` route; issuing one blind here
 * always picks slot 0 and OVERWRITES the operator's own primary session. The SDK
 * establishes the device cookie via `POST /auth/session` (under `/auth`) instead.
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

// The switch now registers the managed session into the operator's device set.
// This suite uses REAL mongoose (no DB), so mock the device-set write + socket
// broadcast to avoid a buffered query hanging the request.
const mockAddAccount = jest.fn(async () => ({
  state: { deviceId: 'op-device', accounts: [], activeAccountId: null, revision: 1, updatedAt: Date.now() },
  changed: false,
}));
jest.mock('../../services/deviceSession.service', () => ({
  __esModule: true,
  default: { addAccount: (...args: unknown[]) => mockAddAccount(...args) },
}));
const mockBroadcastDeviceState = jest.fn();
jest.mock('../../utils/socket', () => ({
  broadcastDeviceState: (...args: unknown[]) => mockBroadcastDeviceState(...args),
}));

const mockAuthMiddleware = jest.fn();
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
}));

const mockDecodeToken = jest.fn();
jest.mock('../../middleware/authUtils', () => ({
  decodeToken: (...args: unknown[]) => mockDecodeToken(...args),
  extractTokenFromRequest: () => 'tkn',
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
  setCookie: string[];
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
            const setCookie = res.headers['set-cookie'] ?? [];
            resolve({
              status: res.statusCode ?? 0,
              setCookie: Array.isArray(setCookie) ? setCookie : [setCookie],
              body: raw.length > 0 ? JSON.parse(raw) : {},
            });
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
  // Default: the operator's bearer decodes to a device id — the switch must
  // inherit it so the org session lands on the SAME device doc as the operator.
  mockDecodeToken.mockReset();
  mockDecodeToken.mockReturnValue({ sessionId: 'op-sess', deviceId: 'dev-op' });
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

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(200);
    // The session's user IS the target account (a true switch, not delegation).
    expect(res.body.user?.id).toBe(ORG_ID);
    expect(res.body.user?.username).toBe('acme-org');
    expect(res.body.sessionId).toBe('sess-1');
    expect(res.body.accessToken).toBe('acc-1');
    // Operator recorded on the minted session, AND the operator's deviceId is
    // inherited so the org session joins the operator's existing device doc
    // (not a fresh device the browser never restores from on reload).
    expect(mockCreateSession).toHaveBeenCalledWith(ORG_ID, expect.anything(), {
      operatedByUserId: OPERATOR_ID,
      deviceId: 'dev-op',
    });
    // The managed session is registered into the operator's device set
    // server-side (a switch is a deliberate activation → activate: 'always').
    expect(mockAddAccount).toHaveBeenCalledWith(
      'dev-1',
      { accountId: ORG_ID, sessionId: 'sess-1', operatedByUserId: OPERATOR_ID },
      { activate: 'always' },
    );
  });

  it('falls back to a fresh device when the bearer has no resolvable deviceId', async () => {
    // No decodable deviceId on the caller's bearer → keep today's behavior
    // (let createSession derive/allocate a device) rather than passing undefined.
    mockDecodeToken.mockReturnValue(null);
    mockVerifyActingAs.mockResolvedValue('admin');
    mockFindById.mockResolvedValue({
      _id: new Types.ObjectId(ORG_ID),
      username: 'acme-org',
      kind: 'organization',
      accountStatus: 'active',
    });
    mockCreateSession.mockResolvedValue({
      sessionId: 'sess-1',
      deviceId: 'dev-fresh',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      accessToken: 'acc-1',
    });

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(200);
    // No deviceId key threaded — the switch still mints a session.
    expect(mockCreateSession).toHaveBeenCalledWith(ORG_ID, expect.anything(), { operatedByUserId: OPERATOR_ID });
  });

  it('does NOT write a refresh cookie (slot-clobber guard) — establishment is deferred to /auth/session', async () => {
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

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(200);
    // The route lives at /accounts/* — outside the deleted slot-cookie's Path=/auth
    // scope — so it can never see the device's existing slots. Issuing a cookie
    // here would blindly take slot 0 and destroy the operator's own session.
    // It MUST leave the cookie untouched; the SDK establishes it via /auth/session.
    expect(res.setCookie.some((c) => /(^|\s)oxy_rt_\d+=/.test(c) && !/Max-Age=0/.test(c))).toBe(false);
    // No authuser is resolved by this route — the SDK gets it from /auth/session.
    expect(res.body.authuser).toBeUndefined();
  });

  it('returns 404 for a missing/archived target', async () => {
    mockVerifyActingAs.mockResolvedValue('admin');
    mockFindById.mockResolvedValue(null);

    const res = await post(server, `/accounts/${ORG_ID}/switch`);

    expect(res.status).toBe(404);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
