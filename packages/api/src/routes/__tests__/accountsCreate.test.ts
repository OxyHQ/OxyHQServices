/**
 * POST /accounts — user-scoped account creation guards.
 *
 * Channel accounts are minted only through the service provisioning surface
 * (`POST /accounts/service/channels`); the user-facing create route must refuse
 * `kind: 'channel'` so a bearer with `children:create` cannot bypass that gate.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const OPERATOR_ID = '6c0000000000000000000001';

const mockCreateChildAccount = jest.fn();
jest.mock('../../services/account.service', () => ({
  __esModule: true,
  accountService: {
    createChildAccount: (...args: unknown[]) => mockCreateChildAccount(...args),
    resolveEffectiveAccess: jest.fn(async () => ({
      role: 'owner',
      permissions: ['children:create'],
      inherit: true,
    })),
  },
}));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
    req.user = { id: OPERATOR_ID };
    next();
  },
  serviceAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
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
  body: { message?: string };
}

function request(
  srv: http.Server,
  payload: Record<string, unknown>
): Promise<JsonResponse> {
  const address = srv.address() as AddressInfo;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        path: '/accounts',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: 'Bearer user-token',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: raw ? (JSON.parse(raw) as JsonResponse['body']) : {},
          });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('POST /accounts', () => {
  let server: http.Server;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/accounts', accountsRouter);
    app.use(errorHandler);
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    mockCreateChildAccount.mockReset();
  });

  it('refuses to create a channel account (400)', async () => {
    const res = await request(server, {
      kind: 'channel',
      username: 'daily-news',
      name: { displayName: 'Daily News' },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/service provisioning/i);
    expect(mockCreateChildAccount).not.toHaveBeenCalled();
  });
});
