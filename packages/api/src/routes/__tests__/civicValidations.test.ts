/**
 * Route-shape tests for the validator-jury endpoints (Fase 2 Part B).
 *
 * Locks the HTTP contract the SDK + Commons build against: open a request
 * (service-token), the juror inbox, casting a signed verdict, and recusal — plus
 * the key rejection statuses. The validator SERVICE, auth, rate limiter, and
 * body validator are mocked.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const USER = 'v'.repeat(24);

const mockOpen = jest.fn();
const mockVote = jest.fn();
const mockDeny = jest.fn();
const mockInbox = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { _id: USER, id: USER };
    next();
  },
  serviceAuthMiddleware: (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
    req.serviceApp = { appId: 'app1', scopes: [] };
    next();
  },
}));
jest.mock('../../middleware/rateLimiter', () => ({ rateLimit: () => (_r: unknown, _s: unknown, n: () => void) => n() }));
jest.mock('../../middleware/validate', () => ({ validate: () => (_r: unknown, _s: unknown, n: () => void) => n() }));
jest.mock('../../services/civic/validator.service', () => ({
  openValidationRequest: (...a: unknown[]) => mockOpen(...a),
  submitVote: (...a: unknown[]) => mockVote(...a),
  denyValidation: (...a: unknown[]) => mockDeny(...a),
  getValidatorInbox: (...a: unknown[]) => mockInbox(...a),
}));
jest.mock('../../services/civic/realLife.service', () => ({ submitRealLifeAttestation: jest.fn() }));
jest.mock('../../services/civic/publicCard.service', () => ({ buildSignedPublicCard: jest.fn() }));
jest.mock('../../services/civic/personhood.service', () => ({
  vouchForPerson: jest.fn(),
  withdrawVouch: jest.fn(),
  recomputePersonhood: jest.fn(),
}));
jest.mock('../../models/PersonhoodStatus', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));

import civicRoutes from '../civic';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse { status: number; body: Record<string, unknown>; }

async function send(server: http.Server, method: string, path: string, payload?: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method, host: '127.0.0.1', port: address.port, path,
        headers: body !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
      },
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
const REQ_ID = 'a'.repeat(24);

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/civic', civicRoutes);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => { server.close(done); });
beforeEach(() => { jest.clearAllMocks(); });

describe('POST /civic/validations', () => {
  it('returns 201 with the open result', async () => {
    mockOpen.mockResolvedValueOnce({
      _id: { toString: () => REQ_ID },
      selectedValidatorIds: ['v1', 'v2', 'v3', 'v4', 'v5'],
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await send(server, 'POST', '/civic/validations', {
      subjectUserId: 'b'.repeat(24), actionType: 'claim', sourceActionId: 'src1', payload: { x: 1 },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      requestId: REQ_ID, selectedValidatorCount: 5, expiresAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('GET /civic/validations/inbox', () => {
  it('returns the juror summaries', async () => {
    mockInbox.mockResolvedValueOnce([
      {
        _id: { toString: () => REQ_ID },
        subjectUserId: { toString: () => 'b'.repeat(24) },
        actionType: 'claim',
        payload: { x: 1 },
        payloadHash: 'hash',
        status: 'pending',
        highValue: false,
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const res = await send(server, 'GET', '/civic/validations/inbox');

    expect(res.status).toBe(200);
    expect((res.body.requests as unknown[])[0]).toMatchObject({ id: REQ_ID, status: 'pending', actionType: 'claim' });
  });
});

describe('POST /civic/validations/:id/vote', () => {
  it('returns 201 with the vote result', async () => {
    mockVote.mockResolvedValueOnce({ ok: true, verdict: 'valid', status: 'validated' });
    const res = await send(server, 'POST', `/civic/validations/${REQ_ID}/vote`, { type: 'validation_verdict' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recorded: true, requestId: REQ_ID, verdict: 'valid', status: 'validated' });
  });

  it('maps not_selected to 403', async () => {
    mockVote.mockResolvedValueOnce({ ok: false, reason: 'not_selected' });
    const res = await send(server, 'POST', `/civic/validations/${REQ_ID}/vote`, {});
    expect(res.status).toBe(403);
  });

  it('maps already_voted to 409', async () => {
    mockVote.mockResolvedValueOnce({ ok: false, reason: 'already_voted' });
    const res = await send(server, 'POST', `/civic/validations/${REQ_ID}/vote`, {});
    expect(res.status).toBe(409);
  });
});

describe('POST /civic/validations/:id/deny', () => {
  it('returns { denied: true } on recusal', async () => {
    mockDeny.mockResolvedValueOnce({ ok: true });
    const res = await send(server, 'POST', `/civic/validations/${REQ_ID}/deny`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ denied: true });
  });

  it('maps not_selected to 403', async () => {
    mockDeny.mockResolvedValueOnce({ ok: false, reason: 'not_selected' });
    const res = await send(server, 'POST', `/civic/validations/${REQ_ID}/deny`);
    expect(res.status).toBe(403);
  });
});
