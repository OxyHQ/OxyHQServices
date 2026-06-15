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
const mockClientFindOneAndUpdate = jest.fn();
const mockAppFind = jest.fn();
const mockUserFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockGrantFindOneAndUpdate = jest.fn();
const mockGrantFind = jest.fn();
const mockCacheInvalidate = jest.fn();

/**
 * Build a chainable Mongoose query stub that resolves `rows`. Supports the
 * `.select(...).lean()` and `.select(...).sort(...).lean()` chains used across
 * the service (each link returns the same chainable object).
 */
function leanQuery(rows: unknown[]) {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.lean = jest.fn().mockResolvedValue(rows);
  return chain;
}

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
    findOneAndUpdate: mockClientFindOneAndUpdate,
  },
}));

// The canonical Application registry — production RP origins are derived from
// each active application's redirectUris.
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { find: mockAppFind },
  default: { find: mockAppFind },
}));

// Pass-through cache: read methods delegate straight to the loader (the
// uncached Mongo read driven by the FedCMClient mocks above) so approval
// lookups behave exactly as before; only `invalidate` is asserted on.
jest.mock('../../utils/approvedClientsCache', () => ({
  __esModule: true,
  default: {
    getApprovedOrigins: (loader: () => Promise<string[]>) => loader(),
    isApproved: async (origin: string, loader: () => Promise<string[]>) =>
      (await loader()).includes(origin),
    invalidate: mockCacheInvalidate,
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
  // Default approval source: an ACTIVE Application whose redirectUri lives on
  // APPROVED_ORIGIN — so the derived approved-origins set contains it. This is
  // the new single source of truth (replaces the old hardcoded FedCMClient list).
  mockAppFind.mockReturnValue(
    leanQuery([{ name: 'Relying Party', redirectUris: [`${APPROVED_ORIGIN}/__oxy/sso-callback`] }])
  );
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
  mockGrantFind.mockReturnValue(leanQuery([]));
  // Manual/admin FedCMClient escape-hatch rows: none by default (dev/native
  // origins still flow through the DEV_NATIVE constant, not this mock).
  mockClientFind.mockReturnValue(leanQuery([]));
  mockClientFindOne.mockImplementation(() => leanQuery([])); // vestigial path
  // Seed upsert succeeds by default.
  mockClientFindOneAndUpdate.mockResolvedValue({});
});

describe('FedCM exchangeIdToken (H9)', () => {
  it('rejects tokens whose aud is not on the approved-clients list', async () => {
    // The default registry only approves APPROVED_ORIGIN, so WRONG_ORIGIN
    // (https://evil.example) is not a derived approved origin → rejected.
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
    expect(mockCreateSession).toHaveBeenCalledWith('user-123', expect.anything(), {
      deviceName: 'FedCM Sign-In',
      stableDeviceKey: APPROVED_ORIGIN,
    });
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
    mockGrantFind.mockReturnValueOnce(
      leanQuery([
        { clientOrigin: APPROVED_ORIGIN },
        // A grant whose origin is no longer approved must be filtered out.
        { clientOrigin: 'https://deapproved.example' },
      ])
    );

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

describe('FedCM approved-origins derivation (Application registry = single source of truth)', () => {
  const DEV_NATIVE = ['http://localhost:3000', 'http://localhost:8081', 'astro://auth'];

  it('derives every active application redirectUri origin (so a new app is auto-approved)', async () => {
    // 12-app prod shape: registering an app with a /__oxy/sso-callback redirect
    // auto-approves its SSO origin — the fix for console.oxy.so being rejected.
    mockAppFind.mockReturnValueOnce(
      leanQuery([
        { name: 'Oxy Website', redirectUris: ['https://oxy.so/__oxy/sso-callback', 'https://fairco.in/__oxy/sso-callback'] },
        { name: 'Oxy Accounts', redirectUris: ['https://accounts.oxy.so/__oxy/sso-callback'] },
        { name: 'Oxy Console', redirectUris: ['https://console.oxy.so/__oxy/sso-callback'] },
        { name: 'Oxy Inbox', redirectUris: ['https://inbox.oxy.so/__oxy/sso-callback'] },
        { name: 'Oxy Pay', redirectUris: ['https://pay.oxy.so/__oxy/sso-callback'] },
        { name: 'Allo', redirectUris: ['https://allo.oxy.so/__oxy/sso-callback'] },
        { name: 'Syra', redirectUris: ['https://syra.oxy.so/__oxy/sso-callback'] },
        { name: 'Homiio', redirectUris: ['https://homiio.com/__oxy/sso-callback'] },
        { name: 'Mention', redirectUris: ['https://mention.earth/__oxy/sso-callback'] },
        { name: 'Alia', redirectUris: ['https://alia.onl/__oxy/sso-callback'] },
        { name: 'TNP', redirectUris: ['https://tnp.network/__oxy/sso-callback'] },
        // An app with no redirectUris contributes no origin (Oxy Auth IdP).
        { name: 'Oxy Auth', redirectUris: [] },
      ])
    );

    const origins = await fedcmService.getApprovedClientOrigins();

    for (const expected of [
      'https://oxy.so', 'https://fairco.in', 'https://accounts.oxy.so', 'https://console.oxy.so',
      'https://inbox.oxy.so', 'https://pay.oxy.so', 'https://allo.oxy.so', 'https://syra.oxy.so',
      'https://homiio.com', 'https://mention.earth', 'https://alia.onl', 'https://tnp.network',
    ]) {
      expect(origins).toContain(expected);
    }
    // The Application registry MUST be the source (not a hardcoded FedCMClient list).
    expect(mockAppFind).toHaveBeenCalledWith({ status: 'active' });
  });

  it('always includes the dev/native origins (not modelled as Applications)', async () => {
    mockAppFind.mockReturnValueOnce(leanQuery([])); // no apps at all
    const origins = await fedcmService.getApprovedClientOrigins();
    for (const dev of DEV_NATIVE) {
      expect(origins).toContain(dev);
    }
  });

  it('does NOT approve an origin from a suspended/deleted app (only status:active is queried)', async () => {
    // The service only queries { status: 'active' }; a suspended app is never
    // returned by that query, so its origin must not appear.
    mockAppFind.mockReturnValueOnce(
      leanQuery([{ name: 'Active App', redirectUris: ['https://active.example/__oxy/sso-callback'] }])
    );
    const origins = await fedcmService.getApprovedClientOrigins();

    expect(origins).toContain('https://active.example');
    expect(origins).not.toContain('https://suspended.example');
    // Guard: the query filters to active only.
    expect(mockAppFind).toHaveBeenCalledWith({ status: 'active' });
  });

  it('normalises derived origins (lowercases host, strips path/trailing slash)', async () => {
    mockAppFind.mockReturnValueOnce(
      leanQuery([{ name: 'Mixed Case', redirectUris: ['HTTPS://Console.OXY.so/__oxy/sso-callback'] }])
    );
    const origins = await fedcmService.getApprovedClientOrigins();
    expect(origins).toContain('https://console.oxy.so');
    expect(origins).not.toContain('HTTPS://Console.OXY.so/__oxy/sso-callback');
  });

  it('unions manually-approved FedCMClient escape-hatch origins', async () => {
    mockAppFind.mockReturnValueOnce(leanQuery([]));
    mockClientFind.mockReturnValueOnce(leanQuery([{ origin: 'https://manual.example' }]));
    const origins = await fedcmService.getApprovedClientOrigins();
    expect(origins).toContain('https://manual.example');
  });

  it('fails soft to the dev/native set when the registry read throws', async () => {
    mockAppFind.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('db down')) }),
    });
    const origins = await fedcmService.getApprovedClientOrigins();
    // Still fail-closed for everything else, but the dev/native set survives.
    for (const dev of DEV_NATIVE) {
      expect(origins).toContain(dev);
    }
  });
});

describe('FedCM seedApprovedClients (dev/native only — prod origins derive from the registry)', () => {
  function seededOrigins(): string[] {
    return mockClientFindOneAndUpdate.mock.calls.map((call) => call[0].origin);
  }

  it('seeds ONLY the dev/native origins (never a hardcoded prod app list)', async () => {
    await fedcmService.seedApprovedClients();
    const origins = seededOrigins();

    expect(origins).toEqual(
      expect.arrayContaining(['http://localhost:3000', 'http://localhost:8081', 'astro://auth'])
    );
    // The hardcoded prod app list is GONE — these must NOT be seeded as FedCMClient
    // rows; they are derived from the Application registry instead.
    for (const prod of ['https://console.oxy.so', 'https://mention.earth', 'https://oxy.so', 'https://fairco.in']) {
      expect(origins).not.toContain(prod);
    }
  });

  it('upserts each dev/native origin with approved:true via $set (additive, never downgrades)', async () => {
    await fedcmService.seedApprovedClients();

    for (const call of mockClientFindOneAndUpdate.mock.calls) {
      const [filter, update, options] = call;
      expect(filter).toEqual({ origin: expect.any(String) });
      expect(update.$set).toEqual({ approved: true, autoSignIn: true });
      expect(update.$setOnInsert.origin).toBe(filter.origin);
      expect(update.$setOnInsert.name).toEqual(expect.any(String));
      expect(update.$setOnInsert.approvedAt).toBeInstanceOf(Date);
      expect(options).toEqual({ upsert: true, new: true });
    }
  });

  it('is idempotent: re-running upserts the same dev/native origin set', async () => {
    await fedcmService.seedApprovedClients();
    const firstRun = seededOrigins();
    expect(new Set(firstRun).size).toBe(firstRun.length);

    mockClientFindOneAndUpdate.mockClear();

    await fedcmService.seedApprovedClients();
    const secondRun = seededOrigins();
    expect(secondRun).toEqual(firstRun);
  });

  it('invalidates the approved-clients cache after seeding', async () => {
    await fedcmService.seedApprovedClients();
    expect(mockCacheInvalidate).toHaveBeenCalledTimes(1);
  });
});

describe('FedCM getUserAuthorizedApps (display names from the Application registry)', () => {
  it('labels a granted origin with its Application name + description', async () => {
    mockAppFind.mockReturnValue(
      leanQuery([
        { name: 'Oxy Console', description: 'Developer console', redirectUris: ['https://console.oxy.so/__oxy/sso-callback'] },
      ])
    );
    mockGrantFind.mockReturnValueOnce(
      leanQuery([
        { clientOrigin: 'https://console.oxy.so', firstGrantedAt: new Date('2026-01-01'), lastUsedAt: new Date('2026-06-01') },
      ])
    );

    const apps = await fedcmService.getUserAuthorizedApps('user-123');
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      origin: 'https://console.oxy.so',
      name: 'Oxy Console',
      description: 'Developer console',
    });
  });

  it('drops a granted origin that has no active Application (de-approval never leaks back)', async () => {
    mockAppFind.mockReturnValue(leanQuery([])); // no active apps
    mockGrantFind.mockReturnValueOnce(
      leanQuery([
        { clientOrigin: 'https://gone.example', firstGrantedAt: new Date(), lastUsedAt: new Date() },
      ])
    );

    const apps = await fedcmService.getUserAuthorizedApps('user-123');
    expect(apps).toEqual([]);
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
