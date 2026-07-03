/**
 * FedCM controller tests — exercises every route handler's branches directly
 * (validation, success, error-mapping) without standing up the HTTP server, so
 * the controller's request/response plumbing is fully covered alongside the
 * service-level H9 tests in `services/__tests__/fedcm.service.test.ts`.
 *
 * `fedcmService`, the refresh-cookie issuer, and the logger are mocked; the
 * handlers are invoked with lightweight `req`/`res` doubles.
 */

import type { Request, Response } from 'express';

const mockMintNonce = jest.fn();
const mockExchangeIdToken = jest.fn();
const mockGetUserGrantedOrigins = jest.fn();
const mockGetApprovedClientData = jest.fn();
const mockAddApprovedClient = jest.fn();
const mockRemoveApprovedClient = jest.fn();
const mockGetUserAuthorizedApps = jest.fn();
const mockRevokeUserGrant = jest.fn();

jest.mock('../../services/fedcm.service', () => ({
  __esModule: true,
  default: {
    mintNonce: mockMintNonce,
    exchangeIdToken: mockExchangeIdToken,
    getUserGrantedOrigins: mockGetUserGrantedOrigins,
    getApprovedClientData: mockGetApprovedClientData,
    addApprovedClient: mockAddApprovedClient,
    removeApprovedClient: mockRemoveApprovedClient,
    getUserAuthorizedApps: mockGetUserAuthorizedApps,
    revokeUserGrant: mockRevokeUserGrant,
  },
}));

const mockIssueAndSetRefreshCookie = jest.fn();
jest.mock('../../services/refreshToken.service', () => ({
  __esModule: true,
  issueAndSetRefreshCookie: mockIssueAndSetRefreshCookie,
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  mintNonce,
  exchangeIdToken,
  getUserGrants,
  getApprovedClients,
  addApprovedClient,
  removeApprovedClient,
  listMyAuthorizedApps,
  revokeMyAuthorizedApp,
} from '../fedcm.controller';
import type { AuthRequest } from '../../middleware/auth';

interface MockRes {
  statusCode: number;
  body: unknown;
  status: jest.Mock;
  json: jest.Mock;
}

/** Minimal Express `Response` double capturing status + JSON body. */
function createRes(): MockRes {
  const res: Partial<MockRes> = { statusCode: 200 };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  });
  return res as MockRes;
}

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

const VALID_USER_ID = '64f7c2a1b8e9d3f4a1c2b3d4';
const TEST_INTERNAL_SECRET = 'test-sso-internal-secret-32-chars-long!!';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SSO_INTERNAL_SECRET = TEST_INTERNAL_SECRET;
});

describe('mintNonce', () => {
  it('returns 400 when the Origin header is absent', async () => {
    const res = createRes();
    await mintNonce(createReq({ headers: {} }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(mockMintNonce).not.toHaveBeenCalled();
  });

  it('mints a nonce on the happy path', async () => {
    mockMintNonce.mockResolvedValueOnce({ nonce: 'abc', expiresAt: '2026-01-01T00:00:00.000Z' });
    const res = createRes();
    await mintNonce(createReq({ headers: { origin: 'https://mention.earth' } }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ nonce: 'abc', expiresAt: '2026-01-01T00:00:00.000Z' });
    expect(mockMintNonce).toHaveBeenCalledWith('https://mention.earth');
  });

  it('returns 500 when the service throws', async () => {
    mockMintNonce.mockRejectedValueOnce(new Error('db down'));
    const res = createRes();
    await mintNonce(createReq({ headers: { origin: 'https://mention.earth' } }), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });
});

describe('exchangeIdToken', () => {
  const goodResult = {
    sessionId: 'sess-1',
    deviceId: 'dev-1',
    expiresAt: '2026-01-01T00:00:00.000Z',
    accessToken: 'access-xyz',
    user: { id: VALID_USER_ID, username: 'alice' },
  };

  it('returns 400 when id_token is missing', async () => {
    const res = createRes();
    await exchangeIdToken(createReq({ body: {} }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(mockExchangeIdToken).not.toHaveBeenCalled();
  });

  it('returns 401 with the reason when the exchange errors', async () => {
    mockExchangeIdToken.mockResolvedValueOnce({ error: 'invalid_nonce' });
    const res = createRes();
    await exchangeIdToken(createReq({ body: { id_token: 'tok' } }), res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reason: 'invalid_nonce' });
  });

  it('returns the session and planted authuser on success', async () => {
    mockExchangeIdToken.mockResolvedValueOnce(goodResult);
    mockIssueAndSetRefreshCookie.mockResolvedValueOnce({ authuser: 3 });
    const res = createRes();
    await exchangeIdToken(
      createReq({ body: { id_token: 'tok' }, headers: { cookie: 'oxy_rt_0=x' } }),
      res as unknown as Response
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sessionId: 'sess-1', authuser: 3 });
    expect(mockIssueAndSetRefreshCookie).toHaveBeenCalledWith(
      res,
      'sess-1',
      VALID_USER_ID,
      { cookieHeader: 'oxy_rt_0=x' }
    );
  });

  it('still returns the session (without authuser) when the cookie issue fails', async () => {
    mockExchangeIdToken.mockResolvedValueOnce(goodResult);
    mockIssueAndSetRefreshCookie.mockRejectedValueOnce(new Error('cookie failure'));
    const res = createRes();
    await exchangeIdToken(createReq({ body: { id_token: 'tok' } }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(goodResult);
    expect((res.body as Record<string, unknown>).authuser).toBeUndefined();
  });

  it('returns 500 when the exchange throws unexpectedly', async () => {
    mockExchangeIdToken.mockRejectedValueOnce(new Error('boom'));
    const res = createRes();
    await exchangeIdToken(createReq({ body: { id_token: 'tok' } }), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });
});

describe('getUserGrants', () => {
  it('returns 404 when the internal shared secret header is absent', async () => {
    const res = createRes();
    await getUserGrants(createReq({ params: { userId: VALID_USER_ID } }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(mockGetUserGrantedOrigins).not.toHaveBeenCalled();
  });

  it('returns 404 when the internal shared secret is invalid', async () => {
    const res = createRes();
    await getUserGrants(
      createReq({ params: { userId: VALID_USER_ID }, headers: { 'x-oxy-internal': 'wrong-secret' } }),
      res as unknown as Response
    );
    expect(res.statusCode).toBe(404);
    expect(mockGetUserGrantedOrigins).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed userId', async () => {
    const res = createRes();
    await getUserGrants(
      createReq({ params: { userId: 'not-an-objectid' }, headers: { 'x-oxy-internal': TEST_INTERNAL_SECRET } }),
      res as unknown as Response
    );
    expect(res.statusCode).toBe(400);
    expect(mockGetUserGrantedOrigins).not.toHaveBeenCalled();
  });

  it('returns the granted origins on success', async () => {
    mockGetUserGrantedOrigins.mockResolvedValueOnce(['https://mention.earth']);
    const res = createRes();
    await getUserGrants(
      createReq({ params: { userId: VALID_USER_ID }, headers: { 'x-oxy-internal': TEST_INTERNAL_SECRET } }),
      res as unknown as Response
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ origins: ['https://mention.earth'] });
  });

  it('returns 500 when the service throws', async () => {
    mockGetUserGrantedOrigins.mockRejectedValueOnce(new Error('db down'));
    const res = createRes();
    await getUserGrants(
      createReq({ params: { userId: VALID_USER_ID }, headers: { 'x-oxy-internal': TEST_INTERNAL_SECRET } }),
      res as unknown as Response
    );
    expect(res.statusCode).toBe(500);
  });
});

describe('getApprovedClients', () => {
  it('returns clients (full allow-list) + trusted (consent-skip subset) on success', async () => {
    mockGetApprovedClientData.mockResolvedValueOnce({
      origins: ['https://mention.earth', 'https://console.oxy.so'],
      trusted: ['https://console.oxy.so'],
    });
    const res = createRes();
    await getApprovedClients(createReq(), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      clients: ['https://mention.earth', 'https://console.oxy.so'],
      trusted: ['https://console.oxy.so'],
    });
  });

  it('returns 500 when the service throws', async () => {
    mockGetApprovedClientData.mockRejectedValueOnce(new Error('db down'));
    const res = createRes();
    await getApprovedClients(createReq(), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });
});

describe('addApprovedClient', () => {
  it('returns 400 when origin or name is missing', async () => {
    const res = createRes();
    await addApprovedClient(createReq({ body: { origin: 'https://x.example' } }) as AuthRequest, res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(mockAddApprovedClient).not.toHaveBeenCalled();
  });

  it('returns 400 for an origin with a disallowed protocol', async () => {
    const res = createRes();
    await addApprovedClient(
      createReq({ body: { origin: 'ftp://x.example', name: 'X' } }) as AuthRequest,
      res as unknown as Response
    );
    expect(res.statusCode).toBe(400);
    expect(mockAddApprovedClient).not.toHaveBeenCalled();
  });

  it('returns 400 for an unparseable origin URL', async () => {
    const res = createRes();
    await addApprovedClient(
      createReq({ body: { origin: 'not a url', name: 'X' } }) as AuthRequest,
      res as unknown as Response
    );
    expect(res.statusCode).toBe(400);
    expect(mockAddApprovedClient).not.toHaveBeenCalled();
  });

  it('adds the client on the happy path', async () => {
    mockAddApprovedClient.mockResolvedValueOnce({
      origin: 'https://x.example',
      name: 'X',
      description: 'desc',
    });
    const res = createRes();
    await addApprovedClient(
      createReq({ body: { origin: 'https://x.example', name: 'X', description: 'desc' } }) as AuthRequest,
      res as unknown as Response
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, client: { origin: 'https://x.example' } });
  });

  it('returns 409 on a duplicate-key error', async () => {
    const dupErr: Error & { code?: number } = new Error('dup');
    dupErr.code = 11000;
    mockAddApprovedClient.mockRejectedValueOnce(dupErr);
    const res = createRes();
    await addApprovedClient(
      createReq({ body: { origin: 'https://x.example', name: 'X' } }) as AuthRequest,
      res as unknown as Response
    );
    expect(res.statusCode).toBe(409);
  });

  it('returns 500 on an unexpected error', async () => {
    mockAddApprovedClient.mockRejectedValueOnce(new Error('db down'));
    const res = createRes();
    await addApprovedClient(
      createReq({ body: { origin: 'https://x.example', name: 'X' } }) as AuthRequest,
      res as unknown as Response
    );
    expect(res.statusCode).toBe(500);
  });
});

describe('removeApprovedClient', () => {
  it('returns 400 when origin is missing', async () => {
    const res = createRes();
    await removeApprovedClient(createReq({ params: {} }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(mockRemoveApprovedClient).not.toHaveBeenCalled();
  });

  it('returns 404 when no client was removed', async () => {
    mockRemoveApprovedClient.mockResolvedValueOnce(false);
    const res = createRes();
    await removeApprovedClient(createReq({ params: { origin: 'https://x.example' } }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
  });

  it('removes the client on success', async () => {
    mockRemoveApprovedClient.mockResolvedValueOnce(true);
    const res = createRes();
    await removeApprovedClient(createReq({ params: { origin: 'https://x.example' } }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it('returns 500 when the service throws', async () => {
    mockRemoveApprovedClient.mockRejectedValueOnce(new Error('db down'));
    const res = createRes();
    await removeApprovedClient(createReq({ params: { origin: 'https://x.example' } }), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });
});

describe('listMyAuthorizedApps', () => {
  it('returns 401 when there is no authenticated user', async () => {
    const res = createRes();
    await listMyAuthorizedApps(createReq() as AuthRequest, res as unknown as Response);
    expect(res.statusCode).toBe(401);
    expect(mockGetUserAuthorizedApps).not.toHaveBeenCalled();
  });

  it('returns the authorized apps on success', async () => {
    mockGetUserAuthorizedApps.mockResolvedValueOnce([{ origin: 'https://mention.earth', name: 'Mention' }]);
    const req = createReq() as AuthRequest;
    req.user = { id: VALID_USER_ID } as AuthRequest['user'];
    const res = createRes();
    await listMyAuthorizedApps(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ apps: [{ origin: 'https://mention.earth', name: 'Mention' }] });
  });

  it('returns 500 when the service throws', async () => {
    mockGetUserAuthorizedApps.mockRejectedValueOnce(new Error('db down'));
    const req = createReq() as AuthRequest;
    req.user = { id: VALID_USER_ID } as AuthRequest['user'];
    const res = createRes();
    await listMyAuthorizedApps(req, res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });
});

describe('revokeMyAuthorizedApp', () => {
  function authedReq(params: Record<string, string>): AuthRequest {
    const req = createReq({ params }) as AuthRequest;
    req.user = { id: VALID_USER_ID } as AuthRequest['user'];
    return req;
  }

  it('returns 401 when there is no authenticated user', async () => {
    const res = createRes();
    await revokeMyAuthorizedApp(createReq({ params: { origin: 'https%3A%2F%2Fx.example' } }) as AuthRequest, res as unknown as Response);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when origin is missing', async () => {
    const res = createRes();
    await revokeMyAuthorizedApp(authedReq({}), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the origin is not decodable', async () => {
    const res = createRes();
    // A lone '%' is an invalid percent-encoding → decodeURIComponent throws.
    await revokeMyAuthorizedApp(authedReq({ origin: '%' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: 'Invalid origin encoding' });
  });

  it('returns 400 when the service rejects with a TypeError (invalid origin URL)', async () => {
    mockRevokeUserGrant.mockRejectedValueOnce(new TypeError('Invalid URL'));
    const res = createRes();
    await revokeMyAuthorizedApp(authedReq({ origin: 'https%3A%2F%2Fx.example' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: 'Invalid origin URL' });
  });

  it('returns 404 when no grant existed', async () => {
    mockRevokeUserGrant.mockResolvedValueOnce(false);
    const res = createRes();
    await revokeMyAuthorizedApp(authedReq({ origin: 'https%3A%2F%2Fx.example' }), res as unknown as Response);
    expect(res.statusCode).toBe(404);
  });

  it('revokes the grant on success', async () => {
    mockRevokeUserGrant.mockResolvedValueOnce(true);
    const res = createRes();
    await revokeMyAuthorizedApp(authedReq({ origin: 'https%3A%2F%2Fx.example' }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(mockRevokeUserGrant).toHaveBeenCalledWith(VALID_USER_ID, 'https://x.example');
  });

  it('returns 500 when the service throws a non-TypeError', async () => {
    mockRevokeUserGrant.mockRejectedValueOnce(new Error('db down'));
    const res = createRes();
    await revokeMyAuthorizedApp(authedReq({ origin: 'https%3A%2F%2Fx.example' }), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });
});
