/**
 * Route tests for verified-domain badges (B7).
 *
 * Mounts the real `identityRoutes` and exercises the domain request/verify/list/
 * remove flow over node:http. DNS (`dns.promises.resolveTxt`) and the SSRF-safe
 * `safeFetch` are mocked so both proof paths — and the SSRF/failure paths — are
 * deterministic. Asserts `userCache.invalidate` after every write and the
 * per-user rate limit.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { Readable } from 'stream';

const USER_ID = '507f1f77bcf86cd799439011';

interface MockUser {
  _id: string;
  id: string;
  publicKey?: string;
  authMethods?: unknown[];
}

let currentUser: MockUser = { _id: USER_ID, id: USER_ID };

const mockUserFindById = jest.fn();
const mockDvFindOne = jest.fn();
const mockDvFindOneAndUpdate = jest.fn();
const mockDvFind = jest.fn();
const mockDvDeleteOne = jest.fn();
const mockInvalidate = jest.fn();
const mockResolveTxt = jest.fn();
const mockSafeFetch = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: MockUser }, _res: unknown, next: () => void) => {
    req.user = currentUser;
    next();
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

jest.mock('../../models/DomainVerification', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockDvFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockDvFindOneAndUpdate(...args),
    find: (...args: unknown[]) => mockDvFind(...args),
    deleteOne: (...args: unknown[]) => mockDvDeleteOne(...args),
  },
}));

// Mock the SignedRecord + RepoHead models so the transitively-imported
// signedRecord.service / repoLog.service load under the global mongoose mock
// (the domain routes don't use them).
jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
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

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) },
}));

jest.mock('dns', () => ({
  promises: { resolveTxt: (...args: unknown[]) => mockResolveTxt(...args) },
}));

jest.mock('@oxyhq/core/server', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import identityRoutes from '../identity';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function request(server: http.Server, method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: body !== undefined
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          // The rate-limit middleware responds with a plain-text body, not JSON.
          let body: JsonResponse['body'] = {};
          if (raw.length) {
            try {
              body = JSON.parse(raw);
            } catch {
              body = { message: raw };
            }
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
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

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { _id: USER_ID, id: USER_ID };
});

describe('POST /identity/domains', () => {
  it('issues a token with DNS + well-known instructions', async () => {
    currentUser = { _id: USER_ID, id: 'req-happy' };
    mockDvFindOneAndUpdate.mockResolvedValueOnce({});

    const res = await request(server, 'POST', '/identity/domains', { domain: 'nate.com' });

    expect(res.status).toBe(201);
    // Bare DomainVerificationInstructions (the core mixin parses this directly).
    const data = res.body as { domain: string; token: string; dns: { name: string; value: string }; wellKnown: { url: string; body: string } };
    expect(data.domain).toBe('nate.com');
    expect(data.token).toMatch(/^[a-f0-9]{32}$/);
    expect(data.dns.name).toBe('_oxy-identity.nate.com');
    expect(data.dns.value).toBe(`oxy-domain-verification=${data.token}`);
    expect(data.wellKnown.url).toBe('https://nate.com/.well-known/oxy-domain');
    expect(data.wellKnown.body).toBe(data.token);
  });

  it('rejects a malformed domain with 400', async () => {
    currentUser = { _id: USER_ID, id: 'req-bad' };
    const res = await request(server, 'POST', '/identity/domains', { domain: 'not a domain!!' });
    expect(res.status).toBe(400);
    expect(mockDvFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('enforces the 10/hour per-user rate limit', async () => {
    currentUser = { _id: USER_ID, id: 'req-rate-limited-user' };
    mockDvFindOneAndUpdate.mockResolvedValue({});

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(server, 'POST', '/identity/domains', { domain: `d${i}.example.com` });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('POST /identity/domains/:domain/verify', () => {
  function pendingDoc() {
    return { _id: 'dv1', token: 'tok-abc', expiresAt: new Date(Date.now() + 60_000) };
  }
  function mutableUser() {
    return { _id: USER_ID, verifiedDomains: [] as Array<{ domain: string; method: string }>, save: jest.fn().mockResolvedValue(undefined) };
  }

  it('verifies via DNS-TXT and invalidates the cache', async () => {
    currentUser = { _id: USER_ID, id: 'verify-dns' };
    mockDvFindOne.mockResolvedValueOnce(pendingDoc());
    mockResolveTxt.mockResolvedValueOnce([['oxy-domain-verification=tok-abc']]);
    const user = mutableUser();
    mockUserFindById.mockResolvedValueOnce(user);
    mockDvDeleteOne.mockResolvedValueOnce({});

    const res = await request(server, 'POST', '/identity/domains/nate.com/verify');

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect((res.body.domain as { method: string }).method).toBe('dns-txt');
    expect(user.verifiedDomains).toEqual([{ domain: 'nate.com', verifiedAt: expect.any(Date), method: 'dns-txt' }]);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
    expect(mockDvDeleteOne).toHaveBeenCalled();
  });

  it('falls back to the well-known proof via safeFetch', async () => {
    currentUser = { _id: USER_ID, id: 'verify-wk' };
    mockDvFindOne.mockResolvedValueOnce(pendingDoc());
    mockResolveTxt.mockRejectedValueOnce(new Error('ENOTFOUND'));
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      response: Readable.from([Buffer.from('tok-abc')]),
      headers: {},
      finalUrl: 'https://nate.com/.well-known/oxy-domain',
    });
    const user = mutableUser();
    mockUserFindById.mockResolvedValueOnce(user);
    mockDvDeleteOne.mockResolvedValueOnce({});

    const res = await request(server, 'POST', '/identity/domains/nate.com/verify');

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect((res.body.domain as { method: string }).method).toBe('well-known');
    expect(mockSafeFetch).toHaveBeenCalledWith('https://nate.com/.well-known/oxy-domain', expect.any(Object));
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });

  it('returns 400 and does not mutate when no proof is present', async () => {
    currentUser = { _id: USER_ID, id: 'verify-noproof' };
    mockDvFindOne.mockResolvedValueOnce(pendingDoc());
    mockResolveTxt.mockRejectedValueOnce(new Error('ENOTFOUND'));
    mockSafeFetch.mockResolvedValueOnce({
      status: 404,
      response: Readable.from([Buffer.from('nope')]),
      headers: {},
      finalUrl: 'https://nate.com/.well-known/oxy-domain',
    });

    const res = await request(server, 'POST', '/identity/domains/nate.com/verify');

    expect(res.status).toBe(400);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('does not crash when safeFetch rejects an SSRF target (returns 400)', async () => {
    currentUser = { _id: USER_ID, id: 'verify-ssrf' };
    mockDvFindOne.mockResolvedValueOnce(pendingDoc());
    mockResolveTxt.mockRejectedValueOnce(new Error('ENOTFOUND'));
    mockSafeFetch.mockRejectedValueOnce(new Error('SSRF: private IP blocked'));

    const res = await request(server, 'POST', '/identity/domains/internal.evil.com/verify');

    expect(res.status).toBe(400);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no active challenge', async () => {
    currentUser = { _id: USER_ID, id: 'verify-nochallenge' };
    mockDvFindOne.mockResolvedValueOnce(null);

    const res = await request(server, 'POST', '/identity/domains/nate.com/verify');

    expect(res.status).toBe(400);
    expect(mockResolveTxt).not.toHaveBeenCalled();
  });
});

describe('GET /identity/domains', () => {
  it('returns the account verified-domain badges as { domains }', async () => {
    mockUserFindById.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ verifiedDomains: [{ domain: 'nate.com', verifiedAt: new Date(), method: 'dns-txt' }] }) }),
    });

    const res = await request(server, 'GET', '/identity/domains');

    expect(res.status).toBe(200);
    const domains = res.body.domains as Array<{ domain: string; method: string }>;
    expect(domains).toHaveLength(1);
    expect(domains[0].domain).toBe('nate.com');
  });
});

describe('DELETE /identity/domains/:domain', () => {
  it('removes a verified domain and invalidates the cache', async () => {
    const user = {
      _id: USER_ID,
      verifiedDomains: [{ domain: 'nate.com', method: 'dns-txt' }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockUserFindById.mockResolvedValueOnce(user);
    mockDvDeleteOne.mockResolvedValueOnce({});

    const res = await request(server, 'DELETE', '/identity/domains/nate.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(user.verifiedDomains).toEqual([]);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });

  it('returns 404 when the domain is not verified', async () => {
    const user = { _id: USER_ID, verifiedDomains: [], save: jest.fn() };
    mockUserFindById.mockResolvedValueOnce(user);

    const res = await request(server, 'DELETE', '/identity/domains/nate.com');

    expect(res.status).toBe(404);
    expect(user.save).not.toHaveBeenCalled();
  });
});
