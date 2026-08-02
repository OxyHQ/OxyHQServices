/**
 * `POST /auth/oauth/token` — RFC 6749 conformance AND legacy-dialect regression.
 *
 * The endpoint serves two wire dialects (see THE DIALECT RULE in
 * `utils/oauthTokenRequest.ts`). These tests pin BOTH halves of the contract,
 * because the whole point of the dual dialect is that adding standards
 * compliance changed nothing for the clients that already existed:
 *
 *   RFC 6749  — snake_case + `grant_type`, form-encoded or JSON,
 *               `client_secret_basic` and `client_secret_post`, FLAT success
 *               body (§5.1), FLAT error body with the spec status (§5.2), and
 *               the `refresh_token` grant (§6) with its client binding.
 *   Legacy    — camelCase JSON, `{ data: … }` envelope, 401 `{error,message}`
 *               errors. Byte-for-byte what `@oxyhq/core.exchangeOAuthCode` and
 *               `docs/auth/integration-guide.md` already parse.
 *
 * The router is REAL. Only the data sources are stubbed — in particular the
 * client-secret comparison runs the real SHA-256 + `timingSafeEqual` path
 * against a real hash, and request parsing/validation is the real parser.
 *
 * Note: PKCE verification itself lives in `exchangeAuthCode` and is covered by
 * `services/__tests__/oauthCode.service.test.ts`. Here `exchangeAuthCode` is
 * stubbed, so these tests assert that the verifier is FORWARDED to it verbatim,
 * not that it is checked.
 */

import express from 'express';
import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockExchangeAuthCode = jest.fn();
const mockCreateSession = jest.fn();
const mockGetSession = jest.fn();
const mockRefreshTokens = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();
const mockFormatUserResponse = jest.fn();
const mockValidateRefreshToken = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// NOTE: `middleware/validate` is deliberately NOT mocked away for the token
// route — that route validates through the real parser + real Zod schemas, so
// a validation regression is caught here rather than hidden behind a stub.
jest.mock('../../middleware/validate', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  AuthSession: { findOne: jest.fn() },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('../../services/authSession.service', () => ({
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn(), findOne: jest.fn() },
  default: { create: jest.fn(), findOne: jest.fn() },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: mockApplicationCredentialFindOne },
  default: { findOne: mockApplicationCredentialFindOne },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: mockApplicationFindOne },
  default: { findOne: mockApplicationFindOne },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: mockUserFindById },
  default: { findOne: jest.fn(), findById: mockUserFindById },
}));

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: (...args: unknown[]) => mockFormatUserResponse(...args),
}));

jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    getSession: (...args: unknown[]) => mockGetSession(...args),
    refreshTokens: (...args: unknown[]) => mockRefreshTokens(...args),
  },
}));

jest.mock('../../services/deviceLogin.service', () => ({
  finalizeDeviceLogin: (...args: unknown[]) => mockFinalizeDeviceLogin(...args),
}));

jest.mock('../../services/oauthCode.service', () => {
  const actual = jest.requireActual('../../services/oauthCode.service') as typeof import('../../services/oauthCode.service');
  return {
    ...actual,
    issueAuthCode: jest.fn(),
    exchangeAuthCode: (...args: unknown[]) => mockExchangeAuthCode(...args),
  };
});

// Only `validateRefreshToken` is stubbed; `ACCESS_TOKEN_TTL_SECONDS` stays REAL
// so the asserted `expires_in` is the lifetime the tokens actually have.
jest.mock('../../utils/sessionUtils', () => {
  const actual = jest.requireActual('../../utils/sessionUtils') as typeof import('../../utils/sessionUtils');
  return {
    ...actual,
    validateRefreshToken: (...args: unknown[]) => mockValidateRefreshToken(...args),
  };
});

jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {
    isValidPublicKey: jest.fn(),
    verifyChallengeResponse: jest.fn(),
    verifyRegistrationSignature: jest.fn(),
    verifySignature: jest.fn(),
    generateChallenge: jest.fn(),
    shortenPublicKey: jest.fn(),
  },
}));

jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(),
    signUp: jest.fn(),
    signIn: jest.fn(),
    requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(),
    requestPasswordReset: jest.fn(),
    verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(),
    getUserByPublicKey: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../socialAuth', () => ({
  __esModule: true,
  default: express.Router(),
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../utils/sessionUtils';

const CLIENT_ID = 'oxy_dk_test_client';
const CLIENT_SECRET = 'super-secret-value';
const CLIENT_SECRET_HASH = crypto.createHash('sha256').update(CLIENT_SECRET).digest('hex');
const REDIRECT_URI = 'https://app.example.com/callback';
const CODE_VERIFIER = 'v'.repeat(64);
const SESSION_ID = 'session-abc-123';
const DEVICE_ID = 'device-xyz-789';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

async function post(
  path: string,
  contentType: string,
  payload: string,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path,
        headers: {
          'content-type': contentType,
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: raw.length > 0 ? JSON.parse(raw) : {},
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function postForm(params: Record<string, string>, headers: Record<string, string> = {}) {
  return post(
    '/auth/oauth/token',
    'application/x-www-form-urlencoded',
    new URLSearchParams(params).toString(),
    headers,
  );
}

function postJson(payload: unknown, headers: Record<string, string> = {}) {
  return post('/auth/oauth/token', 'application/json', JSON.stringify(payload), headers);
}

function basicAuth(clientId: string, clientSecret: string): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
  };
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  // Mirrors server.ts: both parsers are mounted globally.
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();

  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: { toString: () => 'user-1' } };
      next();
    },
  );

  mockApplicationCredentialFindOne.mockResolvedValue({
    _id: { toString: () => 'cred-1' },
    publicKey: CLIENT_ID,
    applicationId: 'app-1',
    status: 'active',
    secretHash: CLIENT_SECRET_HASH,
  });

  mockApplicationFindOne.mockResolvedValue({
    _id: { toString: () => 'app-1' },
    name: 'Test App',
    status: 'active',
    redirectUris: [REDIRECT_URI],
    save: jest.fn().mockResolvedValue(undefined),
  });

  mockExchangeAuthCode.mockResolvedValue({
    ok: true,
    code: { userId: 'user-1', deviceId: DEVICE_ID, scopes: ['openid', 'user:read'] },
  });

  mockUserFindById.mockResolvedValue({ _id: { toString: () => 'user-1' }, username: 'tester' });

  mockCreateSession.mockResolvedValue({
    sessionId: SESSION_ID,
    deviceId: DEVICE_ID,
    accessToken: 'the-access-token',
    refreshToken: 'the-refresh-token',
  });

  mockFinalizeDeviceLogin.mockResolvedValue({ deviceSecret: 'the-device-secret' });

  mockFormatUserResponse.mockReturnValue({ id: 'user-1', username: 'tester' });
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 6749 §4.1.3 — authorization_code grant
// ─────────────────────────────────────────────────────────────────────────────

describe('RFC 6749 dialect — authorization_code grant', () => {
  it('accepts a form-encoded snake_case request with grant_type and client_secret_post', async () => {
    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(200);
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCode: 'the-code',
        appId: 'app-1',
        redirectUri: REDIRECT_URI,
        clientSecretProvided: true,
      }),
    );
  });

  it('accepts client_secret_basic credentials (the MAS default)', async () => {
    const res = await postForm(
      {
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: REDIRECT_URI,
      },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(200);
    expect(mockApplicationCredentialFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: CLIENT_ID }),
    );
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecretProvided: true }),
    );
  });

  it('accepts a snake_case JSON body too — the dialect is the parameter set, not the encoding', async () => {
    const res = await postJson({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('data');
  });

  it('returns a FLAT RFC 6749 §5.1 success body with no envelope', async () => {
    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).toEqual({
      access_token: 'the-access-token',
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: 'the-refresh-token',
      scope: 'openid user:read',
      session_id: SESSION_ID,
      device_id: DEVICE_ID,
      device_secret: 'the-device-secret',
    });
    // The user profile belongs to the UserInfo endpoint, not the token response.
    expect(res.body).not.toHaveProperty('user');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('omits `scope` when the authorization code carried none', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: 'user-1', deviceId: DEVICE_ID, scopes: [] },
    });

    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('scope');
  });

  it('forwards a PKCE code_verifier verbatim for a public client', async () => {
    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });

    expect(res.status).toBe(200);
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({
        codeVerifier: CODE_VERIFIER,
        clientSecretProvided: false,
      }),
    );
  });

  it('records the client on the session so it can later refresh (RFC 6749 §6 binding)', async () => {
    await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({ oauthClientId: CLIENT_ID }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 6749 §5.2 — flat errors with the spec status codes
// ─────────────────────────────────────────────────────────────────────────────

describe('RFC 6749 dialect — flat error bodies (§5.2)', () => {
  it('returns 401 invalid_client with a WWW-Authenticate challenge when Basic credentials are wrong', async () => {
    const res = await postForm(
      {
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: REDIRECT_URI,
      },
      basicAuth(CLIENT_ID, 'the-wrong-secret'),
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'invalid_client',
      error_description: 'Client authentication failed',
    });
    expect(res.headers['www-authenticate']).toMatch(/^Basic /);
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_client for an unknown client_id', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: 'oxy_dk_unknown',
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    // No WWW-Authenticate: the client did not use the Authorization header.
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('returns 400 invalid_grant (NOT 401) when the code exchange fails', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({ ok: false, reason: 'invalid_grant' });

    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'a-replayed-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid_grant',
      error_description: 'The authorization code is invalid, expired, or already used',
    });
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('message');
  });

  it('returns 400 invalid_request when grant_type is missing', async () => {
    const res = await postForm({
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toContain('grant_type');
  });

  it('returns 400 unsupported_grant_type for a grant this endpoint does not implement', async () => {
    const res = await postForm({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('sets Cache-Control: no-store on error responses too', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({ ok: false, reason: 'invalid_grant' });

    const res = await postForm({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RFC 6749 §6 — refresh_token grant
// ─────────────────────────────────────────────────────────────────────────────

describe('RFC 6749 dialect — refresh_token grant (§6)', () => {
  beforeEach(() => {
    mockValidateRefreshToken.mockReturnValue({
      valid: true,
      payload: { userId: 'user-1', sessionId: SESSION_ID, deviceId: DEVICE_ID, type: 'refresh' },
    });
    mockGetSession.mockResolvedValue({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      oauthClientIds: [CLIENT_ID],
    });
    mockRefreshTokens.mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      session: { sessionId: SESSION_ID, deviceId: DEVICE_ID },
    });
  });

  it('rotates the session and returns a flat body', async () => {
    const res = await postForm(
      { grant_type: 'refresh_token', refresh_token: 'the-refresh-token' },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      access_token: 'rotated-access-token',
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: 'rotated-refresh-token',
      session_id: SESSION_ID,
      device_id: DEVICE_ID,
    });
    expect(mockRefreshTokens).toHaveBeenCalledWith('the-refresh-token');
  });

  it('accepts client_secret_post for the refresh grant as well', async () => {
    const res = await postForm({
      grant_type: 'refresh_token',
      refresh_token: 'the-refresh-token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    expect(res.status).toBe(200);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
  });

  it('refuses — WITHOUT rotating — a refresh token that was not issued to this client', async () => {
    mockGetSession.mockResolvedValueOnce({
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      oauthClientIds: ['oxy_dk_some_other_client'],
    });

    const res = await postForm(
      { grant_type: 'refresh_token', refresh_token: 'the-refresh-token' },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid_grant',
      error_description: 'The refresh token was not issued to this client',
    });
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it('refuses a session the OAuth token endpoint never minted (password login / device flow)', async () => {
    mockGetSession.mockResolvedValueOnce({ sessionId: SESSION_ID, deviceId: DEVICE_ID });

    const res = await postForm(
      { grant_type: 'refresh_token', refresh_token: 'the-refresh-token' },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it('refuses a refresh token that does not decode to a session', async () => {
    mockValidateRefreshToken.mockReturnValueOnce({ valid: false, error: 'invalid' });

    const res = await postForm(
      { grant_type: 'refresh_token', refresh_token: 'garbage' },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it('surfaces a rejected rotation as invalid_grant', async () => {
    mockRefreshTokens.mockResolvedValueOnce(null);

    const res = await postForm(
      { grant_type: 'refresh_token', refresh_token: 'the-refresh-token' },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid_grant',
      error_description: 'The refresh token is invalid or expired',
    });
  });

  it('requires client authentication from a confidential client (§6)', async () => {
    const res = await postForm({
      grant_type: 'refresh_token',
      refresh_token: 'the-refresh-token',
      client_id: CLIENT_ID,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it('lets a public client (no registered secret) refresh on the binding alone', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce({
      _id: { toString: () => 'cred-1' },
      publicKey: CLIENT_ID,
      applicationId: 'app-1',
      status: 'active',
    });

    const res = await postForm({
      grant_type: 'refresh_token',
      refresh_token: 'the-refresh-token',
      client_id: CLIENT_ID,
    });

    expect(res.status).toBe(200);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
  });

  it('rejects scope narrowing it cannot honour rather than over-granting', async () => {
    const res = await postForm(
      {
        grant_type: 'refresh_token',
        refresh_token: 'the-refresh-token',
        scope: 'user:read',
      },
      basicAuth(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy dialect — must be byte-for-byte unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('legacy dialect — unchanged for existing callers', () => {
  it('keeps the { data: … } envelope and the inline user for the camelCase body @oxyhq/core sends', async () => {
    const res = await postJson({
      code: 'the-code',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        access_token: 'the-access-token',
        refresh_token: 'the-refresh-token',
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        session_id: SESSION_ID,
        deviceId: DEVICE_ID,
        deviceSecret: 'the-device-secret',
        user: { id: 'user-1', username: 'tester' },
      },
    });
  });

  // The ONE deliberate change to the legacy path: RFC 6749 §5.1 forbids caching
  // a token response, and no client can be broken by a stricter cache
  // directive, so both dialects now carry it.
  it('also sets Cache-Control: no-store', async () => {
    const res = await postJson({
      code: 'the-code',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('keeps 401 { error, message } for an invalid grant', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({ ok: false, reason: 'invalid_grant' });

    const res = await postJson({
      code: 'a-replayed-code',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED', message: 'invalid_grant' });
  });

  it('keeps 401 { error, message } for an invalid client', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await postJson({
      code: 'the-code',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED', message: 'invalid_client' });
  });

  it('keeps the 400 "Validation failed" envelope for a malformed camelCase body', async () => {
    const res = await postJson({ code: 'the-code', clientId: CLIENT_ID });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'BAD_REQUEST', message: 'Validation failed' });
    expect(res.body).toHaveProperty('details');
  });

  it('still verifies a legacy clientSecret in constant time against the stored hash', async () => {
    const res = await postJson({
      code: 'the-code',
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      clientSecret: 'the-wrong-secret',
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED', message: 'invalid_client' });
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('has no refresh grant — a camelCase body is always the code exchange', async () => {
    const res = await postJson({
      grantType: 'refresh_token',
      refreshToken: 'the-refresh-token',
      clientId: CLIENT_ID,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'BAD_REQUEST', message: 'Validation failed' });
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });
});
