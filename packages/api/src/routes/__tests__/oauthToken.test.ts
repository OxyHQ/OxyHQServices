/**
 * POST /auth/oauth/token — RFC 6749 §4.1.3 authorization-code exchange.
 *
 * Pins two contracts at once:
 *
 *   1. THE STANDARD. A form-encoded request with `grant_type=authorization_code`,
 *      client authentication by `client_secret_post` or `client_secret_basic`,
 *      a FLAT §5.1 success body sent `no-store`, and §5.2 error documents with
 *      the right status codes. These are what make the endpoint usable by an
 *      off-the-shelf OAuth client.
 *
 *   2. THE SECURITY PROPERTIES the standardization must not cost us:
 *        - the client secret is verified in constant time BEFORE the code is
 *          exchanged, so a caller without it cannot reach the exchange at all;
 *        - a caller with neither a secret nor a PKCE verifier is rejected
 *          before any code lookup;
 *        - the PKCE verifier reaches `exchangeAuthCode` unaltered (the S256
 *          comparison itself is pinned in
 *          `services/__tests__/oauthCode.service.test.ts`);
 *        - every code-binding failure collapses to ONE `invalid_grant` body, so
 *          the endpoint cannot be used as an oracle for which check failed.
 *      Each is asserted through an observable the route cannot fake: whether
 *      `exchangeAuthCode` ran at all, and with what arguments.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockApplicationCredentialFindOne = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockApplicationSave = jest.fn();
const mockExchangeAuthCode = jest.fn();
const mockUserFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();
const mockFormatUserResponse = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: jest.fn(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

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
  authorizeSessionWithBearer: jest.fn(),
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn() },
  default: { create: jest.fn() },
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
  User: { findById: mockUserFindById },
  default: { findById: mockUserFindById },
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
  },
}));

jest.mock('../../services/deviceLogin.service', () => ({
  finalizeDeviceLogin: (...args: unknown[]) => mockFinalizeDeviceLogin(...args),
}));

jest.mock('../../services/oauthCode.service', () => ({
  issueAuthCode: jest.fn(),
  exchangeAuthCode: (...args: unknown[]) => mockExchangeAuthCode(...args),
  AUTH_CODE_TTL_MS: 60_000,
  canonicalizeOAuthRedirectUri: (uri: string) => uri,
}));

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

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

import crypto from 'crypto';
import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

interface TokenResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

async function requestRaw(
  server: http.Server,
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
): Promise<TokenResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path: '/auth/oauth/token',
        headers: {
          'content-type': contentType,
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
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

/**
 * POST an RFC-shaped token request: `application/x-www-form-urlencoded`, the
 * only encoding §4.1.3 allows.
 */
async function requestForm(
  server: http.Server,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<TokenResponse> {
  return requestRaw(
    server,
    new URLSearchParams(params).toString(),
    'application/x-www-form-urlencoded',
    headers,
  );
}

const APP_ID = '507f1f77bcf86cd799439011';
const CLIENT_ID = 'oxy_dk_test_client';
const CLIENT_SECRET = 'super-secret-value';
const CLIENT_SECRET_HASH = crypto.createHash('sha256').update(CLIENT_SECRET).digest('hex');
const REDIRECT_URI = 'https://app.example/callback';
const CODE_VERIFIER = 'a'.repeat(64);

/** The single description every code-binding failure must report (no oracle). */
const INVALID_GRANT_DESCRIPTION =
  'The authorization code is invalid, expired, already used, or was not issued for this client and redirect URI.';

function basicHeader(clientId: string, clientSecret: string): Record<string, string> {
  const encoded = Buffer.from(
    `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
  ).toString('base64');
  return { authorization: `Basic ${encoded}` };
}

/** The minimal valid public-client (PKCE) request. */
function pkceParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    grant_type: 'authorization_code',
    code: 'auth-code-1',
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: CODE_VERIFIER,
    ...overrides,
  };
}

/** A credential whose stored hash matches {@link CLIENT_SECRET}. */
function confidentialCredential() {
  return {
    publicKey: CLIENT_ID,
    status: 'active',
    applicationId: APP_ID,
    secretHash: CLIENT_SECRET_HASH,
  };
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  // Mirrors `server.ts`: the token endpoint is reachable only because the app
  // parses urlencoded bodies.
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

  mockApplicationCredentialFindOne.mockResolvedValue({
    publicKey: CLIENT_ID,
    status: 'active',
    applicationId: APP_ID,
    secretHash: null,
  });
  mockApplicationFindOne.mockResolvedValue({
    _id: { toString: () => APP_ID },
    status: 'active',
    name: 'Test App',
    save: mockApplicationSave,
  });
  mockExchangeAuthCode.mockResolvedValue({
    ok: true,
    code: { userId: 'user-1', deviceId: 'device-from-code', scopes: [] },
  });
  mockUserFindById.mockResolvedValue({
    _id: { toString: () => 'user-1' },
    username: 'tester',
  });
  mockCreateSession.mockResolvedValue({
    sessionId: 'sess-1',
    deviceId: 'device-1',
    accessToken: 'access-token-1',
  });
  mockFinalizeDeviceLogin.mockResolvedValue({ deviceSecret: 'device-secret-1' });
  mockFormatUserResponse.mockReturnValue({ id: 'user-1', username: 'tester' });
  mockApplicationSave.mockResolvedValue(undefined);
});

describe('POST /auth/oauth/token — RFC 6749 §5.1 success response', () => {
  it('returns a FLAT token document (no `data` wrapper) for a PKCE public client', async () => {
    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(200);
    // The point of the change: the standard members sit at the TOP LEVEL.
    expect(res.body).toMatchObject({
      access_token: 'access-token-1',
      token_type: 'Bearer',
      expires_in: 900,
      session_id: 'sess-1',
      deviceId: 'device-1',
      deviceSecret: 'device-secret-1',
      user: { id: 'user-1', username: 'tester' },
    });
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('refresh_token');
  });

  it('sends the credentials with `Cache-Control: no-store` (§5.1)', async () => {
    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
  });

  it('reports the granted scope as a space-delimited string', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: 'user-1', scopes: ['profile:read', 'email:read'] },
    });

    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('profile:read email:read');
  });

  it('omits `scope` entirely when the grant carries none', async () => {
    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('scope');
  });
});

describe('POST /auth/oauth/token — request validation (RFC 6749 §5.2)', () => {
  it('rejects a request with no grant_type as unsupported_grant_type', async () => {
    const params = pkceParams();
    delete params.grant_type;

    const res = await requestForm(server, params);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_grant_type',
      error_description: expect.any(String),
    });
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects a grant_type this endpoint does not implement', async () => {
    const res = await requestForm(server, pkceParams({ grant_type: 'refresh_token' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects a JSON body — §4.1.3 fixes the encoding as form-urlencoded', async () => {
    const res = await requestRaw(
      server,
      JSON.stringify(pkceParams()),
      'application/json',
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects a request missing `code`', async () => {
    const params = pkceParams();
    delete params.code;

    const res = await requestForm(server, params);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects a request missing `redirect_uri`', async () => {
    const params = pkceParams();
    delete params.redirect_uri;

    const res = await requestForm(server, params);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects a request that names no client at all', async () => {
    const params = pkceParams();
    delete params.client_id;

    const res = await requestForm(server, params);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
  });
});

describe('POST /auth/oauth/token — client authentication (RFC 6749 §2.3)', () => {
  it('accepts client_secret_basic and exchanges as a confidential client', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(confidentialCredential());

    const res = await requestForm(
      server,
      { grant_type: 'authorization_code', code: 'auth-code-1', redirect_uri: REDIRECT_URI },
      basicHeader(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(200);
    // The client id came from the Basic header, not the body.
    expect(mockApplicationCredentialFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: CLIENT_ID }),
    );
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecretProvided: true }),
    );
  });

  it('accepts client_secret_post', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(confidentialCredential());

    const res = await requestForm(server, {
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    expect(res.status).toBe(200);
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecretProvided: true }),
    );
  });

  it('rejects using Basic AND a body client_secret at once (§2.3)', async () => {
    const res = await requestForm(
      server,
      {
        grant_type: 'authorization_code',
        code: 'auth-code-1',
        redirect_uri: REDIRECT_URI,
        client_secret: CLIENT_SECRET,
      },
      basicHeader(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
  });

  it('rejects a body client_id that contradicts the Basic header', async () => {
    const res = await requestForm(
      server,
      {
        grant_type: 'authorization_code',
        code: 'auth-code-1',
        redirect_uri: REDIRECT_URI,
        client_id: 'oxy_dk_someone_else',
      },
      basicHeader(CLIENT_ID, CLIENT_SECRET),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
  });

  it('rejects an Authorization scheme other than Basic, with a challenge', async () => {
    const res = await requestForm(server, pkceParams(), { authorization: 'Bearer some-token' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toContain('Basic');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('answers an unknown client with 401 invalid_client and a Basic challenge', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(null);

    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: 'invalid_client',
      error_description: expect.any(String),
    });
    expect(res.headers['www-authenticate']).toContain('Basic');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });
});

describe('POST /auth/oauth/token — security properties', () => {
  it('verifies the client secret BEFORE the code exchange: a wrong secret never reaches it', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(confidentialCredential());

    const res = await requestForm(server, {
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: 'wrong-secret',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    // The load-bearing assertion: an attacker without the secret cannot probe
    // the code-binding outcomes, because the exchange never runs.
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a secret asserted against a credential that has none', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce({
      publicKey: CLIENT_ID,
      status: 'active',
      applicationId: APP_ID,
      secretHash: null,
    });

    const res = await requestForm(server, {
      grant_type: 'authorization_code',
      code: 'auth-code-1',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects a caller that presents neither a client secret nor a PKCE verifier', async () => {
    const params = pkceParams();
    delete params.code_verifier;

    const res = await requestForm(server, params);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    // Rejected before any lookup — the code is never touched.
    expect(mockApplicationCredentialFindOne).not.toHaveBeenCalled();
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('forwards the PKCE verifier to the exchange unaltered', async () => {
    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(200);
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCode: 'auth-code-1',
        appId: APP_ID,
        redirectUri: REDIRECT_URI,
        clientSecretProvided: false,
        // Dropping or rewriting the verifier here would disable PKCE for every
        // public client; the S256 comparison itself is pinned in
        // `services/__tests__/oauthCode.service.test.ts`.
        codeVerifier: CODE_VERIFIER,
      }),
    );
  });

  it('rejects a PKCE verifier shorter than the RFC 7636 minimum', async () => {
    const res = await requestForm(server, pkceParams({ code_verifier: 'too-short' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('collapses every code-binding failure into one indistinguishable invalid_grant', async () => {
    mockExchangeAuthCode.mockResolvedValue({ ok: false, reason: 'invalid_grant' });

    const unknownCode = await requestForm(server, pkceParams({ code: 'never-issued' }));
    const replayedCode = await requestForm(server, pkceParams({ code: 'already-used' }));
    const otherRedirect = await requestForm(
      server,
      pkceParams({ redirect_uri: 'https://app.example/other' }),
    );

    for (const res of [unknownCode, replayedCode, otherRedirect]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'invalid_grant',
        error_description: INVALID_GRANT_DESCRIPTION,
      });
    }
    // Byte-identical bodies: the response cannot tell the causes apart.
    expect(replayedCode.body).toEqual(unknownCode.body);
    expect(otherRedirect.body).toEqual(unknownCode.body);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('reports a code with neither PKCE nor client secret as invalid_client', async () => {
    mockExchangeAuthCode.mockResolvedValueOnce({ ok: false, reason: 'invalid_client' });

    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns invalid_grant when the code resolves to a user that no longer exists', async () => {
    mockUserFindById.mockResolvedValueOnce(null);

    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('fails closed with server_error when deviceSecret minting fails', async () => {
    mockFinalizeDeviceLogin.mockResolvedValueOnce({});

    const res = await requestForm(server, pkceParams());

    expect(res.status).toBe(500);
    // Still RFC-shaped, and still says nothing about what broke internally.
    expect(res.body).toEqual({
      error: 'server_error',
      error_description: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('access_token');
  });
});
