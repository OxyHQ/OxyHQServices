/**
 * Route-shape tests for the v2 chain-head endpoint (F0.2).
 *
 * Locks the EXACT public response shape a client fetches before signing the next
 * v2 record:
 *  - GET /identity/records/:userId/chain/head
 *      → with a chain: { headRecordId: string, seq: number, recordCount: number }
 *      → no chain yet:  { headRecordId: null, seq: -1, recordCount: 0 }
 *      → invalid userId: 404
 *
 * The repoLog SERVICE is mocked; this suite only locks the HTTP shape + that the
 * route is PUBLIC (no auth applied) and CORS-open.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const USER_ID = '507f1f77bcf86cd799439011';

const mockGetHead = jest.fn();

// authMiddleware is mocked but the chain-head route does NOT use it (public).
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/repoLog.service', () => ({
  getHead: (...args: unknown[]) => mockGetHead(...args),
}));

jest.mock('../../services/signedRecord.service', () => ({
  verifyAndStoreRecord: jest.fn(),
  verifyEnvelope: jest.fn(),
  getLatestRecord: jest.fn(),
}));

// nodeRegistry.service is transitively imported by the identity routes (F5a);
// mock it so the real UserNode model never loads under the global mongoose mock.
jest.mock('../../services/nodeRegistry.service', () => ({
  materializeNodeFromRecord: jest.fn(),
  getUserNode: jest.fn(() => Promise.resolve(null)),
  removeNode: jest.fn(),
  probeLiveness: jest.fn(),
  sweepNodeLiveness: jest.fn(),
}));

jest.mock('../../models/User', () => ({ __esModule: true, User: {}, default: {} }));
jest.mock('../../models/DomainVerification', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: jest.fn() } }));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('@oxyhq/core/server', () => ({ safeFetch: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import identityRoutes from '../identity';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
}

async function request(server: http.Server, path: string): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port: address.port, path },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {}, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/identity', identityRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => { jest.clearAllMocks(); });

describe('GET /identity/records/:userId/chain/head', () => {
  it('returns { headRecordId, seq, recordCount } when a chain exists', async () => {
    mockGetHead.mockResolvedValueOnce({ headRecordId: 'a'.repeat(64), seq: 3, recordCount: 4 });

    const res = await request(server, `/identity/records/${USER_ID}/chain/head`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ headRecordId: 'a'.repeat(64), seq: 3, recordCount: 4 });
    // Public + CORS-open + cacheable.
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('returns an empty head for a user with no chain', async () => {
    mockGetHead.mockResolvedValueOnce(null);

    const res = await request(server, `/identity/records/${USER_ID}/chain/head`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ headRecordId: null, seq: -1, recordCount: 0 });
  });

  it('returns 404 for an invalid userId', async () => {
    const res = await request(server, '/identity/records/not-an-objectid/chain/head');

    expect(res.status).toBe(404);
    expect(mockGetHead).not.toHaveBeenCalled();
  });
});
