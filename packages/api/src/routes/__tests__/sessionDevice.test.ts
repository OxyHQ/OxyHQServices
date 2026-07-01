import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockGetState = jest.fn();
const mockAddAccount = jest.fn();
const mockSwitchActive = jest.fn();
const mockSignout = jest.fn();
const mockBroadcast = jest.fn();
const mockDecodeToken = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...a: unknown[]) => mockAuthMiddleware(...a),
}));
jest.mock('../../middleware/originGuard', () => ({
  requireSameSiteOrigin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({ rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
jest.mock('../../middleware/authUtils', () => ({
  decodeToken: (...a: unknown[]) => mockDecodeToken(...a),
  extractTokenFromRequest: () => 'tkn',
}));
jest.mock('../../services/deviceSession.service', () => ({
  __esModule: true,
  default: {
    getState: (...a: unknown[]) => mockGetState(...a),
    addAccount: (...a: unknown[]) => mockAddAccount(...a),
    switchActive: (...a: unknown[]) => mockSwitchActive(...a),
    signout: (...a: unknown[]) => mockSignout(...a),
  },
}));
jest.mock('../../utils/socket', () => ({ broadcastDeviceState: (...a: unknown[]) => mockBroadcast(...a) }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import sessionDeviceRouter from '../sessionDevice';
import { errorHandler } from '../../middleware/errorHandler';

const STATE = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };

async function requestJson(server: http.Server, method: string, path: string, payload?: unknown) {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port: address.port, path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), Authorization: 'Bearer t' } },
      (res) => { let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }); }); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

let server: http.Server;
beforeAll((done) => {
  mockAuthMiddleware.mockImplementation((req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user?: unknown }).user = { _id: { toString: () => '64b0000000000000000000aa' }, id: '64b0000000000000000000aa' };
    next();
  });
  mockDecodeToken.mockReturnValue({ sessionId: 's1', deviceId: 'd1' });
  const app = express();
  app.use(express.json());
  app.use('/session/device', sessionDeviceRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => jest.clearAllMocks());

describe('GET /session/device/state', () => {
  it('returns the device state', async () => {
    mockGetState.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'GET', '/session/device/state');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(STATE);
    expect(mockGetState).toHaveBeenCalledWith('d1');
  });
});

describe('POST /session/device/switch', () => {
  it('switches active account and broadcasts', async () => {
    mockSwitchActive.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'a1' });
    expect(res.status).toBe(200);
    expect(mockSwitchActive).toHaveBeenCalledWith('d1', 'a1');
    expect(mockBroadcast).toHaveBeenCalledWith(STATE);
  });

  it('404 when the account is not on the device', async () => {
    mockSwitchActive.mockResolvedValueOnce(null);
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'ghost' });
    expect(res.status).toBe(404);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});

describe('POST /session/device/signout', () => {
  it('signs out one account and broadcasts', async () => {
    const after = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSignout.mockResolvedValueOnce(after);
    const res = await requestJson(server, 'POST', '/session/device/signout', { accountId: 'a1' });
    expect(res.status).toBe(200);
    expect(mockSignout).toHaveBeenCalledWith('d1', { accountId: 'a1' });
    expect(mockBroadcast).toHaveBeenCalledWith(after);
  });

  it('signs out all when { all: true }', async () => {
    const after = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSignout.mockResolvedValueOnce(after);
    const res = await requestJson(server, 'POST', '/session/device/signout', { all: true });
    expect(res.status).toBe(200);
    expect(mockSignout).toHaveBeenCalledWith('d1', { all: true });
  });
});

describe('POST /session/device/add', () => {
  it('adds an account and broadcasts', async () => {
    mockAddAccount.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'POST', '/session/device/add', { accountId: 'a1', sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: 'a1', sessionId: 's1', operatedByUserId: undefined });
    expect(mockBroadcast).toHaveBeenCalledWith(STATE);
  });
});
