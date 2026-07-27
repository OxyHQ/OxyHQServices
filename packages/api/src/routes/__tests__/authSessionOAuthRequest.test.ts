/**
 * OAuth-bound authorization requests on the ONE `AuthSession` model (issue #691,
 * phase 3).
 *
 * `POST /auth/session/create` optionally carries an `oauth` binding that turns
 * the request into an OAuth authorization request; every delivery surface
 * (popup, push, QR, verified app link) then approves that SAME request and it
 * finalizes into one standard OAuth authorization code. These tests pin the
 * wire contract and the security gates at the route boundary:
 *
 *  - the redirect URI is matched with the SAME exact allowlist check
 *    `POST /auth/oauth/authorize` uses; a miss is an error, NEVER a redirect
 *  - only S256 PKCE is accepted
 *  - the approval screen sees `purpose` + a sanitized delegated subject, and
 *    still no secret whatsoever
 *  - a delegated subject is refused unless the approving identity holds
 *    `account:act_as` over it, and approving an OAuth request mints no session
 *  - device sign-in requests behave exactly as before
 *
 * Real request validation (`validate`) and the real `authSession.service` logic
 * run; only models / infrastructure are mocked.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockAuthSessionFindOne = jest.fn();
const mockAuthSessionCreate = jest.fn();
const mockApplicationFindOne = jest.fn();
const mockApplicationFindById = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockVerifyActingAs = jest.fn();
const mockFinalizeOAuthAuthorization = jest.fn();
const mockEmitAuthSessionUpdate = jest.fn();
const mockBroadcastSessionAccountsChanged = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// REAL request validation — the OAuth binding schema must actually be exercised.
jest.unmock('../../middleware/validate');

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: mockAuthSessionFindOne, create: mockAuthSessionCreate, findOneAndUpdate: jest.fn() },
  AuthSession: { findOne: mockAuthSessionFindOne, create: mockAuthSessionCreate, findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/Session', () => ({ __esModule: true, default: { findOne: jest.fn() } }));

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn() },
  default: { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: mockApplicationFindOne, findById: mockApplicationFindById },
  default: { findOne: mockApplicationFindOne, findById: mockApplicationFindById },
}));

jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: mockApplicationCredentialFindOne },
  default: { findOne: mockApplicationCredentialFindOne },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findOne: jest.fn(), findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

// Real service logic (redirect matching, purpose branching, delegation gate);
// only the terminal finalization is stubbed so the ROUTE mapping is what is
// asserted here — its internals are covered in
// `services/__tests__/authSessionOAuthFinalize.test.ts`.
jest.mock('../../services/authSession.service', () => ({
  ...jest.requireActual('../../services/authSession.service'),
  finalizeOAuthAuthorization: (...args: unknown[]) => mockFinalizeOAuthAuthorization(...args),
}));

jest.mock('../../services/account.service', () => ({
  __esModule: true,
  accountService: { verifyActingAs: (...args: unknown[]) => mockVerifyActingAs(...args) },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: (...args: unknown[]) => mockCreateSession(...args), getAccessToken: jest.fn() },
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

jest.mock('../../utils/userTransform', () => ({ formatUserResponse: jest.fn() }));
jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: (...args: unknown[]) => mockEmitAuthSessionUpdate(...args),
}));
jest.mock('../../utils/socket', () => ({
  broadcastSessionAccountsChanged: (...args: unknown[]) => mockBroadcastSessionAccountsChanged(...args),
}));

jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(), signUp: jest.fn(), signIn: jest.fn(), requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(), requestPasswordReset: jest.fn(), verifyRecoveryCode: jest.fn(),
    resetPassword: jest.fn(), getUserByPublicKey: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: string;
  body: { error?: string; message?: string; data?: Record<string, unknown> };
}

async function requestJson(
  method: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(payload ?? {});
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
              raw,
              body: raw.length > 0 ? JSON.parse(raw) : {},
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const APP_ID = '64f7c2a1b8e9d3f4a1c2b301';
const ORG_ID = '64f7c2a1b8e9d3f4a1c2b402';
const IDENTITY_ID = '64f7c2a1b8e9d3f4a1c2b401';
const REDIRECT_URI = 'https://mention.earth/oauth/callback';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function thirdPartyApp(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => APP_ID },
    name: 'Mention',
    description: 'A third-party integration',
    type: 'third_party',
    status: 'active',
    isOfficial: false,
    isInternal: false,
    scopes: ['user:read', 'files:read'],
    redirectUris: [REDIRECT_URI],
    createdByUserId: { toString: () => 'owner-1' },
    ...overrides,
  };
}

function usableCredential() {
  return {
    _id: { toString: () => 'cred-1' },
    publicKey: 'oxy_dk_client',
    applicationId: { toString: () => APP_ID },
    status: 'active',
  };
}

function oauthBinding(overrides: Record<string, unknown> = {}) {
  return {
    redirectUri: REDIRECT_URI,
    codeChallenge: CODE_CHALLENGE,
    codeChallengeMethod: 'S256',
    scope: 'user:read',
    ...overrides,
  };
}

let server: http.Server;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => { server.close(done); });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthSessionFindOne.mockResolvedValue(null);
  mockAuthSessionCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    ...doc,
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt : new Date(Date.now() + 60_000),
    status: doc.status ?? 'pending',
  }));
  mockAuthMiddleware.mockImplementation((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      _id: { toString: () => IDENTITY_ID },
      publicKey: 'pk-identity',
      username: 'nate',
    };
    next();
  });
});

describe('POST /auth/session/create — OAuth binding', () => {
  it('binds the OAuth request context and marks the purpose', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential());
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-1',
      clientId: 'oxy_dk_client',
      oauth: oauthBinding({ subjectAccountId: ORG_ID }),
    });

    expect(res.status).toBe(200);
    const created = mockAuthSessionCreate.mock.calls[0][0] as {
      purpose: string;
      oauth: {
        redirectUri: string;
        codeChallenge: string;
        codeChallengeMethod: string;
        scopes: string[];
        subjectAccountId?: string;
      };
    };
    expect(created.purpose).toBe('oauth_authorization');
    expect(created.oauth).toEqual({
      redirectUri: REDIRECT_URI,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256',
      // Normalized exactly like POST /auth/oauth/authorize.
      scopes: ['user:read'],
      subjectAccountId: ORG_ID,
    });
  });

  it('rejects an unregistered redirect URI with 403 and NO redirect (RFC 6749 §3.1.2.4)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential());
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-bad-redirect',
      clientId: 'oxy_dk_client',
      oauth: oauthBinding({ redirectUri: 'https://evil.example/callback' }),
    });

    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a prefix/suffix variation of a registered redirect URI (exact match only)', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential());
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-prefix',
      clientId: 'oxy_dk_client',
      oauth: oauthBinding({ redirectUri: `${REDIRECT_URI}/../evil` }),
    });

    expect(res.status).toBe(403);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-S256 code challenge method', async () => {
    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-plain',
      clientId: 'oxy_dk_client',
      oauth: oauthBinding({ codeChallengeMethod: 'plain' }),
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects an OAuth binding with no PKCE challenge', async () => {
    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-nopkce',
      clientId: 'oxy_dk_client',
      oauth: { redirectUri: REDIRECT_URI, codeChallengeMethod: 'S256' },
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects an OAuth binding identified only by applicationId (no client_id)', async () => {
    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-noclient',
      applicationId: APP_ID,
      oauth: oauthBinding(),
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a malformed subjectAccountId', async () => {
    mockApplicationCredentialFindOne.mockResolvedValueOnce(usableCredential());
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-oauth-badsubject',
      clientId: 'oxy_dk_client',
      oauth: oauthBinding({ subjectAccountId: 'not-an-objectid' }),
    });

    expect(res.status).toBe(400);
    expect(mockAuthSessionCreate).not.toHaveBeenCalled();
  });

  it('leaves a plain device sign-in request untouched (no oauth block)', async () => {
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());

    const res = await requestJson('POST', '/auth/session/create', {
      sessionToken: 'tok-device',
      applicationId: APP_ID,
    });

    expect(res.status).toBe(200);
    const created = mockAuthSessionCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.purpose).toBe('device_sign_in');
    expect(created).not.toHaveProperty('oauth');
  });
});

describe('GET /auth/session/approve-info/:authorizeCode — purpose + delegated subject', () => {
  function oauthRow(overrides: Record<string, unknown> = {}) {
    return {
      sessionToken: 'SECRET-do-not-leak',
      authorizeCode: 'code-oauth',
      applicationId: { toString: () => APP_ID },
      boundOrigin: 'https://mention.earth',
      originVerified: false,
      status: 'pending',
      purpose: 'oauth_authorization',
      oauth: {
        redirectUri: REDIRECT_URI,
        codeChallenge: CODE_CHALLENGE,
        codeChallengeMethod: 'S256',
        scopes: ['user:read'],
        subjectAccountId: { toString: () => ORG_ID },
      },
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
      ...overrides,
    };
  }

  it('exposes the purpose and a sanitized delegated subject, and leaks nothing else', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(oauthRow());
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());
    // Developer-name lookup, then the delegated subject lookup.
    mockUserFindById
      .mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve({ username: 'ada' }) }) })
      .mockReturnValueOnce({
        select: () => ({
          lean: () => Promise.resolve({
            _id: { toString: () => ORG_ID },
            username: 'oxy',
            name: { displayName: 'The Oxy Collective' },
          }),
        }),
      });

    const res = await requestJson('GET', '/auth/session/approve-info/code-oauth', null);

    expect(res.status).toBe(200);
    const data = res.body.data as {
      purpose: string;
      subjectAccount: { id: string; username: string; displayName: string };
      scopes: string[];
    };
    expect(data.purpose).toBe('oauth_authorization');
    expect(data.subjectAccount).toEqual({
      id: ORG_ID,
      username: 'oxy',
      displayName: 'The Oxy Collective',
    });
    // What the app will ACTUALLY receive — the requested scopes, not the app's
    // full registered set.
    expect(data.scopes).toEqual(['user:read']);
    // No secret, no PKCE binding, no redirect target on this PUBLIC endpoint.
    expect(res.raw).not.toContain('SECRET-do-not-leak');
    expect(res.raw).not.toContain(CODE_CHALLENGE);
    expect(res.raw).not.toContain(REDIRECT_URI);
  });

  it('reports a device sign-in request as such with no subject account', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(
      oauthRow({ purpose: 'device_sign_in', oauth: undefined })
    );
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());
    mockUserFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const res = await requestJson('GET', '/auth/session/approve-info/code-oauth', null);

    expect(res.status).toBe(200);
    const data = res.body.data as { purpose: string; subjectAccount: null; scopes: string[] };
    expect(data.purpose).toBe('device_sign_in');
    expect(data.subjectAccount).toBeNull();
    // Unchanged behaviour: the app's registered scopes.
    expect(data.scopes).toEqual(['user:read', 'files:read']);
  });
});

describe('POST /auth/session/authorize/:sessionToken — delegated subject + no session mint', () => {
  function pendingOAuthRow(overrides: Record<string, unknown> = {}) {
    return {
      sessionToken: 'tok-oauth-approve',
      applicationId: { toString: () => APP_ID },
      status: 'pending',
      purpose: 'oauth_authorization',
      oauth: {
        redirectUri: REDIRECT_URI,
        codeChallenge: CODE_CHALLENGE,
        codeChallengeMethod: 'S256',
        scopes: ['user:read'],
        subjectAccountId: { toString: () => ORG_ID },
      },
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('refuses an approval whose identity cannot act as the delegated subject', async () => {
    const row = pendingOAuthRow();
    mockAuthSessionFindOne.mockResolvedValueOnce(row);
    mockUserFindById.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ kind: 'organization', accountStatus: 'active' }) }),
    });
    mockVerifyActingAs.mockResolvedValueOnce(null);

    const res = await requestJson('POST', '/auth/session/authorize/tok-oauth-approve', {}, {
      Authorization: 'Bearer valid',
    });

    expect(res.status).toBe(403);
    expect(mockVerifyActingAs).toHaveBeenCalledWith(IDENTITY_ID, ORG_ID);
    expect(row.save).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('authorizes a permitted delegated subject WITHOUT minting a session', async () => {
    const row = pendingOAuthRow();
    mockAuthSessionFindOne.mockResolvedValueOnce(row);
    mockUserFindById.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ kind: 'organization', accountStatus: 'active' }) }),
    });
    mockVerifyActingAs.mockResolvedValueOnce('admin');

    const res = await requestJson('POST', '/auth/session/authorize/tok-oauth-approve', {}, {
      Authorization: 'Bearer valid',
    });

    expect(res.status).toBe(200);
    // An OAuth request's result is an authorization code — never a session here.
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(row.status).toBe('authorized');
    expect(row.save).toHaveBeenCalled();
    expect(res.body.data).not.toHaveProperty('sessionId');
    // Nothing was minted, so no account-graph refetch is broadcast.
    expect(mockBroadcastSessionAccountsChanged).not.toHaveBeenCalled();
  });

  it('still mints a session for a device sign-in approval (unchanged)', async () => {
    const row = pendingOAuthRow({ purpose: 'device_sign_in', oauth: undefined });
    mockAuthSessionFindOne.mockResolvedValueOnce(row);
    mockApplicationFindById.mockResolvedValueOnce(thirdPartyApp());
    mockCreateSession.mockResolvedValueOnce({ sessionId: 'sess-1', deviceId: 'dev-1' });

    const res = await requestJson('POST', '/auth/session/authorize/tok-oauth-approve', {}, {
      Authorization: 'Bearer valid',
    });

    expect(res.status).toBe(200);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockVerifyActingAs).not.toHaveBeenCalled();
    expect((res.body.data as { sessionId: string }).sessionId).toBe('sess-1');
    expect(mockBroadcastSessionAccountsChanged).toHaveBeenCalled();
  });
});

describe('POST /auth/session/finalize/:sessionToken', () => {
  it('returns the authorization code, its redirect target, and the TTL', async () => {
    mockFinalizeOAuthAuthorization.mockResolvedValueOnce({
      ok: true,
      code: 'raw-authorization-code',
      redirectUri: REDIRECT_URI,
      expiresIn: 60,
    });

    const res = await requestJson('POST', '/auth/session/finalize/tok-oauth-approve', {});

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      code: 'raw-authorization-code',
      redirectUri: REDIRECT_URI,
      expiresIn: 60,
    });
    expect(mockFinalizeOAuthAuthorization).toHaveBeenCalledWith({
      sessionToken: 'tok-oauth-approve',
    });
  });

  it('needs no bearer token — the secret sessionToken IS the credential', async () => {
    mockFinalizeOAuthAuthorization.mockResolvedValueOnce({
      ok: true,
      code: 'raw-authorization-code',
      redirectUri: REDIRECT_URI,
      expiresIn: 60,
    });

    const res = await requestJson('POST', '/auth/session/finalize/tok-oauth-approve', {});

    expect(res.status).toBe(200);
    expect(mockAuthMiddleware).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found'],
    ['wrong_purpose'],
    ['not_authorized'],
    ['expired'],
    ['already_finalized'],
    ['delegation_denied'],
    ['redirect_uri_unregistered'],
  ])('collapses the "%s" rejection into one generic invalid_grant', async (reason) => {
    mockFinalizeOAuthAuthorization.mockResolvedValueOnce({ ok: false, reason });

    const res = await requestJson('POST', '/auth/session/finalize/tok-oauth-approve', {});

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('invalid_grant');
    // The precise reason never reaches the client.
    expect(res.raw).not.toContain(reason);
  });
});
