/**
 * Route-shape tests for the signed-record endpoints (B5).
 *
 * Verifies the EXACT response shapes the `@oxyhq/core` identity mixin parses:
 *  - POST /identity/records                    → { envelope, verified }
 *  - GET  /identity/records/:userId/:type       → { record }
 *  - GET  /identity/records/:userId/:type/verify → { verified, reason? }
 *
 * The signedRecord SERVICE is mocked (its crypto is covered by
 * signedRecord.service.test.ts); this suite only locks the HTTP envelope shape.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const ec = new EC('secp256k1');
const PUBLIC_KEY = ec.genKeyPair().getPublic('hex');
const USER_ID = '507f1f77bcf86cd799439011';

const mockVerifyAndStore = jest.fn();
const mockVerifyEnvelope = jest.fn();
const mockGetLatest = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { _id: USER_ID, id: USER_ID, publicKey: PUBLIC_KEY, authMethods: [{ type: 'identity', metadata: { publicKey: PUBLIC_KEY } }] };
    next();
  },
}));

jest.mock('../../services/signedRecord.service', () => ({
  verifyAndStoreRecord: (...args: unknown[]) => mockVerifyAndStore(...args),
  verifyEnvelope: (...args: unknown[]) => mockVerifyEnvelope(...args),
  getLatestRecord: (...args: unknown[]) => mockGetLatest(...args),
}));

// repoLog.service is mocked so its real model imports (SignedRecord + RepoHead)
// do not load under the global mongoose mock; this suite covers the B5 record
// endpoints, not the chain-head endpoint (see chainHead.test.ts).
jest.mock('../../services/repoLog.service', () => ({ getHead: jest.fn(), getLogSince: jest.fn(), resolveCursorSeq: jest.fn() }));

// nodeRegistry.service is transitively imported by the identity routes (F5a);
// mock it so the real UserNode model never loads under the global mongoose mock.
jest.mock('../../services/nodeRegistry.service', () => ({
  materializeNodeFromRecord: jest.fn(),
  getUserNode: jest.fn(() => Promise.resolve(null)),
  removeNode: jest.fn(),
  probeLiveness: jest.fn(),
  sweepNodeLiveness: jest.fn(),
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));
jest.mock('../../models/DomainVerification', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: jest.fn() } }));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('@oxyhq/core/server', () => ({ safeFetch: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import identityRoutes from '../identity';
import { errorHandler } from '../../middleware/errorHandler';

function envelope(): SignedRecordEnvelope {
  return {
    version: 1,
    type: 'identity',
    subject: `did:web:oxy.so:u:${USER_ID}`,
    issuer: `did:web:oxy.so:u:${USER_ID}`,
    record: { displayName: 'Nate' },
    issuedAt: Date.now(),
    publicKey: PUBLIC_KEY,
    alg: 'ES256K-DER-SHA256',
    signature: 'deadbeef',
  };
}

interface JsonResponse { status: number; body: Record<string, unknown>; }

async function request(server: http.Server, method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method, host: '127.0.0.1', port: address.port, path,
        headers: body !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {} },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
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

describe('POST /identity/records', () => {
  it('returns { envelope, verified } on success', async () => {
    const env = envelope();
    mockVerifyAndStore.mockResolvedValueOnce({ ok: true, record: { envelope: env, verified: true } });

    const res = await request(server, 'POST', '/identity/records', env);

    expect(res.status).toBe(201);
    expect(res.body.verified).toBe(true);
    expect(res.body.envelope).toMatchObject({ subject: env.subject, type: 'identity' });
    expect(res.body.data).toBeUndefined();
  });

  it('returns 400 when the service rejects the envelope', async () => {
    mockVerifyAndStore.mockResolvedValueOnce({ ok: false, reason: 'bad_signature' });
    const res = await request(server, 'POST', '/identity/records', envelope());
    expect(res.status).toBe(400);
  });
});

describe('GET /identity/records/:userId/:type', () => {
  it('returns { record } (the bare envelope)', async () => {
    const env = envelope();
    mockGetLatest.mockResolvedValueOnce({ envelope: env });

    const res = await request(server, 'GET', `/identity/records/${USER_ID}/identity`);

    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ subject: env.subject, type: 'identity' });
  });
});

describe('GET /identity/records/:userId/:type/verify', () => {
  it('returns { verified: true } when the stored record re-verifies', async () => {
    mockGetLatest.mockResolvedValueOnce({ envelope: envelope() });
    mockUserFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ publicKey: PUBLIC_KEY, authMethods: [] }) }) });
    mockVerifyEnvelope.mockResolvedValueOnce({ ok: true });

    const res = await request(server, 'GET', `/identity/records/${USER_ID}/identity/verify`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
  });

  it('returns { verified: false, reason } when it does not', async () => {
    mockGetLatest.mockResolvedValueOnce({ envelope: envelope() });
    mockUserFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ publicKey: PUBLIC_KEY, authMethods: [] }) }) });
    mockVerifyEnvelope.mockResolvedValueOnce({ ok: false, reason: 'stale_issued_at' });

    const res = await request(server, 'GET', `/identity/records/${USER_ID}/identity/verify`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: false, reason: 'stale_issued_at' });
  });
});
