/**
 * FedCM Service Tests (H9 regression coverage)
 *
 * Reproduces the attack scenarios the fix closes:
 *  - audience mismatch (token aud not on approved-clients list)
 *  - missing or already-used nonce
 *  - Origin header that doesn't match the token aud
 *  - missing Origin header (treated as hostile non-browser caller)
 *
 * Each scenario hits `exchangeIdToken` and asserts an `error` result —
 * never a session.
 */

process.env.FEDCM_TOKEN_SECRET = 'test-fedcm-secret-32-chars-or-more-for-hmac';
process.env.FEDCM_ISSUER = 'https://auth.test.example';

const mockFindOneAndUpdate = jest.fn();
const mockNonceCreate = jest.fn();
const mockClientFindOne = jest.fn();
const mockClientFind = jest.fn();
const mockUserFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockGrantFindOneAndUpdate = jest.fn();
const mockGrantFind = jest.fn();

jest.mock('../../models/FedCMNonce', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockFindOneAndUpdate,
    create: mockNonceCreate,
  },
}));

jest.mock('../../models/FedCMClient', () => ({
  __esModule: true,
  default: {
    findOne: mockClientFindOne,
    find: mockClientFind,
  },
}));

jest.mock('../../models/FedCMGrant', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: mockGrantFindOneAndUpdate,
    find: mockGrantFind,
  },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: mockUserFindById },
  default: { findById: mockUserFindById },
}));

jest.mock('../session.service', () => ({
  __esModule: true,
  default: { createSession: mockCreateSession },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import * as crypto from 'crypto';
import { Request } from 'express';
import fedcmService from '../fedcm.service';

const FEDCM_SECRET = process.env.FEDCM_TOKEN_SECRET as string;
const APPROVED_ORIGIN = 'https://relying.party.example';
const WRONG_ORIGIN = 'https://evil.example';

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface MintTokenOptions {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
}

function mintToken(opts: MintTokenOptions = {}): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: opts.iss ?? 'https://auth.test.example',
      sub: opts.sub ?? 'user-123',
      aud: opts.aud ?? APPROVED_ORIGIN,
      exp: opts.exp ?? Math.floor(Date.now() / 1000) + 60,
      iat: opts.iat ?? Math.floor(Date.now() / 1000),
      nonce: opts.nonce ?? 'nonce-raw-abc',
    })
  );
  const sig = crypto
    .createHmac('sha256', FEDCM_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${sig}`;
}

function createReq(originHeader?: string | null): Request {
  return {
    headers: originHeader === null ? {} : { origin: originHeader ?? APPROVED_ORIGIN },
    ip: '127.0.0.1',
  } as unknown as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default approval lookup: APPROVED_ORIGIN is approved.
  mockClientFindOne.mockImplementation((query: { origin: string }) => ({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(query.origin === APPROVED_ORIGIN ? { _id: 'client-1' } : null),
    }),
  }));
  // Default nonce claim: succeeds for the expected origin.
  mockFindOneAndUpdate.mockResolvedValue({
    nonceHash: 'placeholder',
    origin: APPROVED_ORIGIN,
    usedAt: new Date(),
  });
  mockUserFindById.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'user-123', username: 'alice' }),
    }),
  });
  mockCreateSession.mockResolvedValue({
    sessionId: 'sess-123',
    deviceId: 'dev-1',
    expiresAt: new Date(Date.now() + 60_000),
    accessToken: 'token-xyz',
  });
  // Grant recording succeeds by default.
  mockGrantFindOneAndUpdate.mockResolvedValue({});
  // Grant lookup: no prior grants by default (overridden per-test).
  mockGrantFind.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
  });
  // Approved-clients list (used by getUserGrantedOrigins to intersect grants).
  mockClientFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ origin: APPROVED_ORIGIN }]),
    }),
  });
});

describe('FedCM exchangeIdToken (H9)', () => {
  it('rejects tokens whose aud is not on the approved-clients list', async () => {
    // Make the client lookup say nothing is approved.
    mockClientFindOne.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }));

    const token = mintToken({ aud: WRONG_ORIGIN });
    const result = await fedcmService.exchangeIdToken(token, createReq(WRONG_ORIGIN));

    expect(result).toEqual({ error: 'audience_not_approved' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects requests whose Origin header does not match the token aud', async () => {
    const token = mintToken({ aud: APPROVED_ORIGIN });
    const result = await fedcmService.exchangeIdToken(token, createReq(WRONG_ORIGIN));

    expect(result).toEqual({ error: 'origin_aud_mismatch' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects requests with no Origin header (non-browser callers)', async () => {
    const token = mintToken();
    const result = await fedcmService.exchangeIdToken(token, createReq(null));

    expect(result).toEqual({ error: 'missing_origin' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects tokens that do not carry a nonce', async () => {
    // Mint a token with nonce explicitly absent.
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64UrlEncode(
      JSON.stringify({
        iss: 'https://auth.test.example',
        sub: 'user-123',
        aud: APPROVED_ORIGIN,
        exp: Math.floor(Date.now() / 1000) + 60,
        iat: Math.floor(Date.now() / 1000),
      })
    );
    const sig = crypto
      .createHmac('sha256', FEDCM_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = `${header}.${payload}.${sig}`;

    const result = await fedcmService.exchangeIdToken(token, createReq(APPROVED_ORIGIN));

    expect(result).toEqual({ error: 'missing_required_fields' });
  });

  it('rejects replay: nonce already used / unknown', async () => {
    // The atomic findOneAndUpdate returns null when no matching unused nonce.
    mockFindOneAndUpdate.mockResolvedValueOnce(null);

    const token = mintToken();
    const result = await fedcmService.exchangeIdToken(token, createReq(APPROVED_ORIGIN));

    expect(result).toEqual({ error: 'invalid_nonce' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects nonce that was minted for a different origin', async () => {
    mockFindOneAndUpdate.mockResolvedValueOnce({
      nonceHash: 'h',
      origin: WRONG_ORIGIN, // mismatched
      usedAt: new Date(),
    });

    const token = mintToken();
    const result = await fedcmService.exchangeIdToken(token, createReq(APPROVED_ORIGIN));

    expect(result).toEqual({ error: 'nonce_origin_mismatch' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('issues a session on the happy path (audience approved, origin matches, nonce valid)', async () => {
    const token = mintToken();
    const result = await fedcmService.exchangeIdToken(token, createReq(APPROVED_ORIGIN));

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.sessionId).toBe('sess-123');
    expect(result.accessToken).toBe('token-xyz');
    expect(mockCreateSession).toHaveBeenCalledWith('user-123', expect.anything(), { deviceName: 'FedCM Sign-In' });
  });

  it('records a FedCM grant for the user+origin on a successful exchange', async () => {
    const token = mintToken();
    await fedcmService.exchangeIdToken(token, createReq(APPROVED_ORIGIN));

    // The grant upsert must run with the verified sub + approved origin so the
    // RP shows up in `approved_clients` for future returning-account flows.
    expect(mockGrantFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mockGrantFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: 'user-123', clientOrigin: APPROVED_ORIGIN });
    expect(options).toEqual({ upsert: true, new: true });
    expect(update.$set.lastUsedAt).toBeInstanceOf(Date);
    expect(update.$setOnInsert.userId).toBe('user-123');
    expect(update.$setOnInsert.clientOrigin).toBe(APPROVED_ORIGIN);
  });

  it('does not record a grant when the exchange is rejected', async () => {
    // Audience not approved → no session, and crucially no grant either.
    mockClientFindOne.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    }));
    const token = mintToken({ aud: WRONG_ORIGIN });
    await fedcmService.exchangeIdToken(token, createReq(WRONG_ORIGIN));

    expect(mockGrantFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still issues the session if grant recording throws (best-effort)', async () => {
    mockGrantFindOneAndUpdate.mockRejectedValueOnce(new Error('db down'));
    const token = mintToken();
    const result = await fedcmService.exchangeIdToken(token, createReq(APPROVED_ORIGIN));

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.sessionId).toBe('sess-123');
  });
});

describe('FedCM getUserGrantedOrigins', () => {
  it('returns the user grants intersected with the approved-clients list', async () => {
    mockGrantFind.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { clientOrigin: APPROVED_ORIGIN },
          // A grant whose origin is no longer approved must be filtered out.
          { clientOrigin: 'https://deapproved.example' },
        ]),
      }),
    });

    const origins = await fedcmService.getUserGrantedOrigins('user-123');
    expect(origins).toEqual([APPROVED_ORIGIN]);
  });

  it('returns an empty array for a user with no grants', async () => {
    const origins = await fedcmService.getUserGrantedOrigins('user-123');
    expect(origins).toEqual([]);
  });
});

describe('FedCM recordGrant', () => {
  it('normalises the origin and upserts on user+origin', async () => {
    await fedcmService.recordGrant('user-123', `${APPROVED_ORIGIN}/`);

    expect(mockGrantFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter] = mockGrantFindOneAndUpdate.mock.calls[0];
    // Trailing slash stripped by normaliseOrigin.
    expect(filter.clientOrigin).toBe(APPROVED_ORIGIN);
  });

  it('swallows errors (never throws)', async () => {
    mockGrantFindOneAndUpdate.mockRejectedValueOnce(new Error('db down'));
    await expect(fedcmService.recordGrant('user-123', APPROVED_ORIGIN)).resolves.toBeUndefined();
  });
});

describe('FedCM mintNonce', () => {
  it('persists a hashed nonce bound to the requesting origin', async () => {
    mockNonceCreate.mockResolvedValueOnce({});
    const result = await fedcmService.mintNonce(APPROVED_ORIGIN);

    expect(result.nonce).toEqual(expect.any(String));
    expect(result.nonce.length).toBeGreaterThan(40);
    expect(mockNonceCreate).toHaveBeenCalledTimes(1);
    const persisted = mockNonceCreate.mock.calls[0][0];
    expect(persisted.origin).toBe(APPROVED_ORIGIN);
    expect(persisted.nonceHash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(persisted.nonceHash).not.toBe(result.nonce); // never store the raw nonce
  });
});
