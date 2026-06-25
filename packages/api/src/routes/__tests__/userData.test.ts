import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockExists = jest.fn();
const mockCountDocuments = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFind = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../models/UserAppData', () => ({
  __esModule: true,
  APP_DATA_IDENTIFIER_PATTERN: /^[a-z0-9_-]{1,64}$/u,
  default: {
    exists: mockExists,
    countDocuments: mockCountDocuments,
    findOneAndUpdate: mockFindOneAndUpdate,
    find: mockFind,
  },
}));

import userDataRouter from '../userData';
import { errorHandler } from '../../middleware/errorHandler';
import { APP_DATA_MAX_NAMESPACE_KEYS } from '../../schemas/userData.schemas';

interface JsonResponse {
  status: number;
  body: { entries?: Record<string, unknown>; error?: string; message?: string; details?: unknown };
}

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function leanExecResult<T>(value: T) {
  return { lean: () => execResult(value) };
}

async function requestJson(server: http.Server, method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? '' : JSON.stringify(payload);
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
  const app = express();
  app.use(express.json());
  app.use('/users/me/app-data', userDataRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthMiddleware.mockImplementation((req: { user?: { id: string } }, _res: unknown, next: () => void) => {
    req.user = { id: 'user-1' };
    next();
  });
});

test('rejects new app-data keys after the namespace key quota is reached', async () => {
  mockExists.mockReturnValue(execResult(null));
  mockCountDocuments
    .mockReturnValueOnce(execResult(APP_DATA_MAX_NAMESPACE_KEYS))
    .mockReturnValueOnce(execResult(10));

  const response = await requestJson(server, 'PUT', '/users/me/app-data/academy/new_key', { value: true });

  expect(response.status).toBe(409);
  expect(response.body.message).toBe('App-data namespace key quota exceeded');
  expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
});

test('limits namespace list queries and refuses oversized legacy namespaces', async () => {
  const limit = jest.fn().mockReturnValue(leanExecResult(
    Array.from({ length: APP_DATA_MAX_NAMESPACE_KEYS + 1 }, (_, index) => ({
      key: `key_${index}`,
      value: index,
    })),
  ));
  mockFind.mockReturnValue({ limit });

  const response = await requestJson(server, 'GET', '/users/me/app-data/academy');

  expect(limit).toHaveBeenCalledWith(APP_DATA_MAX_NAMESPACE_KEYS + 1);
  expect(response.status).toBe(413);
  expect(response.body.message).toBe('App-data namespace exceeds the maximum list response size');
});
