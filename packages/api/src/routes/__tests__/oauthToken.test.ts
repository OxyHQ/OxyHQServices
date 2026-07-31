/**
 * `POST /auth/oauth/token`, against a REAL Postgres.
 *
 * The code→token exchange. What is real here and what is mocked follows what the
 * port actually changed: the CLIENT resolution (credential row, usability,
 * constant-time secret check), the user read and the `applications.last_used_at`
 * write all run against Postgres; `exchangeAuthCode` (`auth_codes` is a separate
 * port), `session.service` and `deviceLogin.service` are mocked collaborators.
 *
 * The previous version mocked `models/ApplicationCredential` and
 * `models/Application` and therefore never exercised the secret comparison
 * against a stored hash at all.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import * as nodeCrypto from 'node:crypto';
import { randomUUID } from 'node:crypto';

const mockExchangeAuthCode = jest.fn();
const mockCreateSession = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/authUtils', () => ({
  extractTokenFromRequest: () => null,
  decodeToken: () => null,
}));
jest.mock('../../services/oauthCode.service', () => {
  const actual = jest.requireActual<typeof import('../../services/oauthCode.service')>(
    '../../services/oauthCode.service',
  );
  return {
    ...actual,
    issueAuthCode: jest.fn(),
    exchangeAuthCode: (...args: unknown[]) => mockExchangeAuthCode(...args),
  };
});
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    getAccessToken: jest.fn(),
  },
}));
jest.mock('../../services/deviceLogin.service', () => ({
  finalizeDeviceLogin: (...args: unknown[]) => mockFinalizeDeviceLogin(...args),
}));
jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
  emitAuthSessionProgress: jest.fn(),
}));
jest.mock('../../utils/socket', () => ({ broadcastSessionAccountsChanged: jest.fn() }));
jest.mock('../../controllers/session.controller', () => ({
  SessionController: {
    register: jest.fn(),
    requestChallenge: jest.fn(),
    verifyChallenge: jest.fn(),
    getUserByPublicKey: jest.fn(),
  },
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { eq } from 'drizzle-orm';
import { closePostgres, connectPostgres, getDb } from '../../config/postgres';
import { applicationCredentials } from '../../db/schema/applicationCredentials';
import { applications } from '../../db/schema/applications';
import { users } from '../../db/schema/users';
import { errorHandler } from '../../middleware/errorHandler';
import authRouter from '../auth';

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

const REDIRECT_URI = 'https://acme.example/oauth/callback';
/** A well-formed PKCE verifier — `oauthTokenSchema` enforces 43–128 chars. */
const PKCE_VERIFIER = 'v'.repeat(43);

let server: http.Server;

function post(body: unknown): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port: address.port,
        path: '/auth/oauth/token',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }),
        );
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sha256 = (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex');

async function client(
  credentialFields: Partial<typeof applicationCredentials.$inferInsert> = {},
  appFields: Partial<typeof applications.$inferInsert> = {},
): Promise<{ clientId: string; applicationId: string }> {
  const [owner] = await getDb().insert(users).values({}).returning({ id: users.id });
  const [app] = await getDb()
    .insert(applications)
    .values({
      name: `App ${randomUUID()}`,
      type: 'third_party',
      redirectUris: [REDIRECT_URI],
      ...appFields,
      ownerAccountId: owner.id,
    })
    .returning({ id: applications.id });
  const clientId = `oxy_dk_${randomUUID().replace(/-/g, '')}`;
  await getDb()
    .insert(applicationCredentials)
    .values({
      applicationId: app.id,
      name: 'client',
      type: 'public',
      environment: 'production',
      ...credentialFields,
      publicKey: clientId,
    });
  return { clientId, applicationId: app.id };
}

/** The subject of the grant — a real `users` row the exchange resolves. */
async function subject(fields: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await getDb().insert(users).values(fields).returning({ id: users.id });
  return row.id;
}

beforeAll(async () => {
  await connectPostgres();
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closePostgres();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSession.mockResolvedValue({
    sessionId: 'sess-1',
    deviceId: 'device-1',
    accessToken: 'access-token-1',
  });
  mockFinalizeDeviceLogin.mockResolvedValue({ deviceSecret: 'device-secret-1' });
});

describe('POST /auth/oauth/token — the happy path', () => {
  it('returns the device-first session fields on a PKCE public-client exchange', async () => {
    const { clientId, applicationId } = await client();
    const userId = await subject({ nameFirst: 'Ada', nameLast: 'Lovelace' });
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId, deviceId: null, operatedByUserId: null },
    });

    const res = await post({
      code: 'auth-code-1',
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: PKCE_VERIFIER,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      access_token: 'access-token-1',
      token_type: 'Bearer',
      session_id: 'sess-1',
      deviceId: 'device-1',
      deviceSecret: 'device-secret-1',
    });
    // The zero-cookie transport hands out no refresh token.
    expect(res.body.data).not.toHaveProperty('refresh_token');
    const user = (res.body.data as { user: { id: string; name: { displayName?: string } } }).user;
    expect(user.id).toBe(userId);
    expect(user.name.displayName).toBe('Ada Lovelace');

    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({
        rawCode: 'auth-code-1',
        appId: applicationId,
        redirectUri: REDIRECT_URI,
        clientSecretProvided: false,
        codeVerifier: PKCE_VERIFIER,
      }),
    );
  });

  it('stamps applications.last_used_at', async () => {
    const { clientId, applicationId } = await client();
    await getDb()
      .update(applications)
      .set({ lastUsedAt: null })
      .where(eq(applications.id, applicationId));
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: await subject(), deviceId: null, operatedByUserId: null },
    });

    await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    const [app] = await getDb()
      .select({ lastUsedAt: applications.lastUsedAt })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .limit(1);
    expect(app.lastUsedAt).toBeInstanceOf(Date);
  });

  it('threads the originating device and the delegated operator onto the session', async () => {
    const { clientId } = await client();
    const org = await subject({ kind: 'organization' });
    const operator = await subject();
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: org, deviceId: '  dev-shared  ', operatedByUserId: operator },
    });

    await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(mockCreateSession).toHaveBeenCalledWith(
      org,
      expect.anything(),
      expect.objectContaining({ deviceId: 'dev-shared', operatedByUserId: operator }),
    );
  });

  it('never serializes a protected user column into the token response', async () => {
    const { clientId } = await client();
    const userId = await subject({ phone: '+15550001111', refreshToken: 'user-refresh-token' });
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId, deviceId: null, operatedByUserId: null },
    });

    const res = await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('+15550001111');
    expect(serialized).not.toContain('user-refresh-token');
  });
});

describe('POST /auth/oauth/token — the confidential-client secret', () => {
  it('accepts the correct secret and reports it to the exchange', async () => {
    const secret = randomUUID();
    const { clientId } = await client({ type: 'confidential', secretHash: sha256(secret) });
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: await subject(), deviceId: null, operatedByUserId: null },
    });

    const res = await post({
      code: 'c',
      clientId,
      redirectUri: REDIRECT_URI,
      clientSecret: secret,
    });

    expect(res.status).toBe(200);
    expect(mockExchangeAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecretProvided: true }),
    );
  });

  it('rejects a WRONG secret before the code is ever exchanged', async () => {
    const { clientId } = await client({
      type: 'confidential',
      secretHash: sha256(randomUUID()),
    });

    const res = await post({
      code: 'c',
      clientId,
      redirectUri: REDIRECT_URI,
      clientSecret: 'not-the-secret',
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'invalid_client' });
    // The probe never reaches the code-binding outcomes.
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('rejects an asserted secret against a credential that holds none', async () => {
    const { clientId } = await client();

    const res = await post({
      code: 'c',
      clientId,
      redirectUri: REDIRECT_URI,
      clientSecret: 'anything',
    });

    expect(res.status).toBe(401);
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });
});

describe('POST /auth/oauth/token — rejections', () => {
  it('returns 401 invalid_client for an unknown clientId', async () => {
    const res = await post({
      code: 'c',
      clientId: 'oxy_dk_unknown',
      redirectUri: REDIRECT_URI,
      codeVerifier: PKCE_VERIFIER,
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'invalid_client' });
  });

  it('returns 401 invalid_client for a REVOKED credential', async () => {
    const { clientId } = await client({ status: 'revoked' });

    const res = await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(res.status).toBe(401);
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_client when the application is no longer active', async () => {
    const { clientId } = await client({}, { status: 'suspended' });

    const res = await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(res.status).toBe(401);
    expect(mockExchangeAuthCode).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_grant when the exchange fails, minting no session', async () => {
    const { clientId } = await client();
    mockExchangeAuthCode.mockResolvedValueOnce({ ok: false, reason: 'invalid_grant' });

    const res = await post({ code: 'bad', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'invalid_grant' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_grant when the code subject no longer exists', async () => {
    const { clientId } = await client();
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: randomUUID(), deviceId: null, operatedByUserId: null },
    });

    const res = await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(res.status).toBe(401);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('fails CLOSED with 500 when the deviceSecret mint produced nothing', async () => {
    const { clientId } = await client();
    mockExchangeAuthCode.mockResolvedValueOnce({
      ok: true,
      code: { userId: await subject(), deviceId: null, operatedByUserId: null },
    });
    mockFinalizeDeviceLogin.mockResolvedValueOnce({});

    const res = await post({ code: 'c', clientId, redirectUri: REDIRECT_URI, codeVerifier: PKCE_VERIFIER });

    expect(res.status).toBe(500);
    expect(res.body.data).toBeUndefined();
  });
});
