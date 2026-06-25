/**
 * /reputation/award authorization tests.
 *
 * Ensures service-token callers must carry the privileged reputation:write
 * scope before they can mutate the global reputation ledger.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockJwtVerify = jest.fn();
const mockServiceAuthMiddleware = jest.fn();
const mockAuthMiddleware = jest.fn();
const mockAward = jest.fn();
const mockResolveUserIdToObjectId = jest.fn();

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: (...args: unknown[]) => mockJwtVerify(...args) },
  verify: (...args: unknown[]) => mockJwtVerify(...args),
}));

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/validation', () => ({
  resolveUserIdToObjectId: (...args: unknown[]) => mockResolveUserIdToObjectId(...args),
  validatePagination: (_limit: unknown, _offset: unknown, _max: number, defaultLimit: number) => ({
    limit: defaultLimit,
    offset: 0,
  }),
}));

jest.mock('../../services/reputation.service', () => ({
  __esModule: true,
  default: {
    award: (...args: unknown[]) => mockAward(...args),
    listTransactions: jest.fn(),
    getBalance: jest.fn(),
    createDispute: jest.fn(),
    upsertRule: jest.fn(),
    listEnabledRules: jest.fn(),
    getLeaderboard: jest.fn(),
    getInfluence: jest.fn(),
    listDisputesForUser: jest.fn(),
    listOpenDisputes: jest.fn(),
    reverseTransaction: jest.fn(),
    voidTransaction: jest.fn(),
    recalculateBalance: jest.fn(),
    resolveDispute: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import reputationRouter from '../reputation.routes';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: { error?: string; message?: string; data?: Record<string, unknown> };
}

async function requestJson(server: http.Server, payload: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path: '/reputation/award',
        headers: {
          authorization: 'Bearer service-token',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          // Close each socket after its response so the server has no lingering
          // keep-alive connections at teardown (`server.close` resolves cleanly).
          connection: 'close',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  const app = express();
  app.use(express.json());
  app.use('/reputation', reputationRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtVerify.mockReturnValue({ type: 'service' });
  mockResolveUserIdToObjectId.mockResolvedValue('64cccccccccccccccccccccc');
  mockAward.mockResolvedValue({
    _id: { toString: () => 'txn1' },
    userId: { toString: () => '64cccccccccccccccccccccc' },
    points: 1,
    actionType: 'post_created',
    category: 'content',
    status: 'active',
    createdAt: new Date('2026-06-24T00:00:00.000Z'),
    updatedAt: new Date('2026-06-24T00:00:00.000Z'),
  });
});

describe('POST /reputation/award service-token scope gate', () => {
  it('rejects a service token that lacks reputation:write', async () => {
    mockServiceAuthMiddleware.mockImplementation((req, _res, next) => {
      req.serviceApp = {
        type: 'service',
        appId: 'app1',
        appName: 'Third Party',
        credentialId: 'cred1',
        scopes: [],
      };
      next();
    });

    const res = await requestJson(server, {
      userId: 'victim',
      actionType: 'post_created',
      sourceActionId: 'attacker-controlled-action',
    });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/reputation:write/i);
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('allows a service token that carries reputation:write', async () => {
    mockServiceAuthMiddleware.mockImplementation((req, _res, next) => {
      req.serviceApp = {
        type: 'service',
        appId: 'app1',
        appName: 'Privileged App',
        credentialId: 'cred1',
        scopes: ['reputation:write'],
      };
      next();
    });

    const res = await requestJson(server, {
      userId: 'member',
      actionType: 'post_created',
      applicationId: 'spoofed-app',
      credentialId: 'spoofed-credential',
      sourceActionId: 'real-action',
    });

    expect(res.status).toBe(201);
    expect(mockAward).toHaveBeenCalledWith(expect.objectContaining({
      userId: '64cccccccccccccccccccccc',
      actionType: 'post_created',
      applicationId: 'app1',
      credentialId: 'cred1',
      sourceActionId: 'real-action',
    }));
  });
});
