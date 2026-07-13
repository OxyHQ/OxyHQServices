import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockGetState = jest.fn();
const mockIssueDeviceSecret = jest.fn();
const mockIssueHubTicket = jest.fn();
const mockRedeemHubTicket = jest.fn();
const mockDecodeToken = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...a: unknown[]) => mockAuthMiddleware(...a),
}));
jest.mock('../../middleware/originGuard', () => ({
  requireSameSiteOrigin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/authUtils', () => ({
  decodeToken: (...a: unknown[]) => mockDecodeToken(...a),
  extractTokenFromRequest: () => 'tkn',
}));
jest.mock('../../services/deviceSession.service', () => ({
  __esModule: true,
  default: {
    getState: (...a: unknown[]) => mockGetState(...a),
    issueDeviceSecret: (...a: unknown[]) => mockIssueDeviceSecret(...a),
  },
}));
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    getSession: jest.fn(),
  },
}));
jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: jest.fn(async () => ({ locked: false })),
  recordFailure: jest.fn(),
  clearFailures: jest.fn(),
}));
jest.mock('../../utils/socket', () => ({ broadcastDeviceState: jest.fn() }));
jest.mock('../../services/deviceHubTicket.service', () => ({
  issueHubTicket: (...a: unknown[]) => mockIssueHubTicket(...a),
  redeemHubTicket: (...a: unknown[]) => mockRedeemHubTicket(...a),
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import sessionDeviceRouter from '../sessionDevice';
import { errorHandler } from '../../middleware/errorHandler';

async function requestJson(
  server: http.Server,
  method: string,
  path: string,
  payload?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(extraHeaders ?? {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  mockAuthMiddleware.mockImplementation((req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user?: unknown }).user = {
      _id: { toString: () => '64b0000000000000000000aa' },
      id: '64b0000000000000000000aa',
    };
    next();
  });
  mockDecodeToken.mockReturnValue({ sessionId: 's1', deviceId: 'd1' });
  const app = express();
  app.use(express.json());
  app.use('/session/device', sessionDeviceRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDecodeToken.mockReturnValue({ sessionId: 's1', deviceId: 'd1' });
});

describe('POST /session/device/hub-ticket', () => {
  it('issues a hub ticket for a valid official return origin', async () => {
    mockIssueHubTicket.mockResolvedValueOnce({ ticket: 'hub-ticket-raw', expiresIn: 60 });
    const res = await requestJson(
      server,
      'POST',
      '/session/device/hub-ticket',
      { returnOrigin: 'https://auth.oxy.so' },
      { Authorization: 'Bearer t' },
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ticket: 'hub-ticket-raw', expiresIn: 60 });
    expect(mockIssueHubTicket).toHaveBeenCalledWith({
      deviceId: 'd1',
      returnOrigin: 'https://auth.oxy.so',
    });
  });

  it('rejects unofficial return origins', async () => {
    const res = await requestJson(
      server,
      'POST',
      '/session/device/hub-ticket',
      { returnOrigin: 'https://evil.example' },
      { Authorization: 'Bearer t' },
    );
    expect(res.status).toBe(400);
    expect(mockIssueHubTicket).not.toHaveBeenCalled();
  });

  it('requires a device id on the bearer', async () => {
    mockDecodeToken.mockReturnValueOnce({ sessionId: 's1' });
    const res = await requestJson(
      server,
      'POST',
      '/session/device/hub-ticket',
      { returnOrigin: 'https://auth.oxy.so' },
      { Authorization: 'Bearer t' },
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /session/device/redeem-ticket', () => {
  it('redeems a valid ticket', async () => {
    mockRedeemHubTicket.mockResolvedValueOnce({
      ok: true,
      deviceId: 'd1',
      deviceSecret: 'fresh-secret',
    });
    const res = await requestJson(server, 'POST', '/session/device/redeem-ticket', {
      ticket: 'hub-ticket-raw',
      returnOrigin: 'https://auth.oxy.so',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deviceId: 'd1', deviceSecret: 'fresh-secret' });
  });

  it('rejects invalid tickets', async () => {
    mockRedeemHubTicket.mockResolvedValueOnce({ ok: false, reason: 'invalid_ticket' });
    const res = await requestJson(server, 'POST', '/session/device/redeem-ticket', {
      ticket: 'bad',
      returnOrigin: 'https://auth.oxy.so',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_ticket');
  });

  it('rejects origin mismatch binding', async () => {
    const res = await requestJson(server, 'POST', '/session/device/redeem-ticket', {
      ticket: 'hub-ticket-raw',
      returnOrigin: 'https://evil.example',
    });
    expect(res.status).toBe(400);
    expect(mockRedeemHubTicket).not.toHaveBeenCalled();
  });
});
