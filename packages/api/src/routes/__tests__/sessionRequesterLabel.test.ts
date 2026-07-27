/**
 * Requester descriptor for the "Sign in with Oxy" approval screen (issue #691).
 *
 * The approval screen must be able to say WHERE a request came from
 * ("Chrome on Windows") without ever displaying the QR / deep-link payload,
 * which the requester controls. `POST /auth/session/create` therefore derives a
 * COARSE browser/OS label from its OWN request User-Agent and persists it; only
 * that label is exposed by `GET /auth/session/approve-info/:authorizeCode`.
 *
 * These tests pin the privacy invariants as hard as the feature itself: the raw
 * User-Agent is never stored or returned, no IP / geolocation / country is
 * captured anywhere on the path, native callers persist `null` rather than an
 * invented label, and a garbage User-Agent degrades to `null` too.
 *
 * Uses the REAL request validation and the REAL label derivation; only Mongoose
 * models / services are mocked.
 */

import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

const mockAuthSessionFindOne = jest.fn();
const mockAuthSessionCreate = jest.fn();
const mockApplicationFindById = jest.fn();
const mockApplicationCredentialFindOne = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  serviceAuthMiddleware: jest.fn(),
  rejectQueryToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: mockAuthSessionFindOne, create: mockAuthSessionCreate },
  AuthSession: { findOne: mockAuthSessionFindOne, create: mockAuthSessionCreate },
}));
jest.mock('../../models/Session', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../services/authSession.service', () => ({
  ...jest.requireActual('../../services/authSession.service'),
  claimAuthSession: jest.fn(),
  authorizeSessionWithSignedChallenge: jest.fn(),
}));
jest.mock('../../models/AuthCode', () => ({ __esModule: true, AuthCode: { create: jest.fn() }, default: { create: jest.fn() } }));
// The global mongoose mock omits `Types.ObjectId`; a faithful 24-hex check keeps
// the create handler's ObjectId guard running.
jest.mock('../../utils/validation', () => ({
  isValidObjectId: (id: string) => /^[a-fA-F0-9]{24}$/.test(id),
}));
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findOne: jest.fn(), findById: mockApplicationFindById },
  default: { findOne: jest.fn(), findById: mockApplicationFindById },
}));
jest.mock('../../models/ApplicationCredential', () => ({
  __esModule: true,
  ApplicationCredential: { findOne: mockApplicationCredentialFindOne },
  default: { findOne: mockApplicationCredentialFindOne },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: mockUserFindById },
  default: { findOne: jest.fn(), findById: mockUserFindById },
}));
jest.mock('../../utils/userTransform', () => ({ formatUserResponse: jest.fn() }));
jest.mock('../../utils/authSessionSocket', () => ({
  emitAuthSessionUpdate: jest.fn(),
  emitAuthSessionProgress: jest.fn(),
}));
jest.mock('../../services/session.service', () => ({ __esModule: true, default: { createSession: jest.fn() } }));
jest.mock('../../services/oauthCode.service', () => ({ issueAuthCode: jest.fn(), exchangeAuthCode: jest.fn(), AUTH_CODE_TTL_MS: 60_000 }));
jest.mock('../../services/signature.service', () => ({ __esModule: true, default: { verifyChallengeResponse: jest.fn(), isValidPublicKey: jest.fn() } }));
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
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() },
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: { data?: Record<string, unknown> };
}

async function requestJson(
  method: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
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
            resolve({ status: res.statusCode ?? 0, body: raw.length > 0 ? JSON.parse(raw) : {} });
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

const THIRD_PARTY_APP_ID = '64f7c2a1b8e9d3f4a1c2b301';

/** A third-party app: not platform-trusted, so no registered-origin gate runs. */
function thirdPartyApp() {
  return {
    _id: { toString: () => THIRD_PARTY_APP_ID },
    name: 'Acme Widgets',
    type: 'third_party',
    status: 'active',
    isOfficial: false,
    isInternal: false,
    scopes: ['user:read'],
    createdByUserId: { toString: () => 'owner-1' },
    redirectUris: ['https://acme.example/callback'],
  };
}

/** Real-world desktop Chrome UA — the version noise must never be persisted. */
const CHROME_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.127 Safari/537.36';
const FIREFOX_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0';
/** React Native / okhttp — a native caller, not a browser. */
const NATIVE_UA = 'okhttp/4.12.0';

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
  mockApplicationCredentialFindOne.mockResolvedValue({
    _id: { toString: () => 'cred-1' },
    publicKey: 'oxy_dk_client',
    applicationId: { toString: () => THIRD_PARTY_APP_ID },
    status: 'active',
  });
  mockApplicationFindById.mockResolvedValue(thirdPartyApp());
  mockUserFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
});

/** The single document `POST /auth/session/create` persisted. */
function createdDoc(): Record<string, unknown> {
  expect(mockAuthSessionCreate).toHaveBeenCalledTimes(1);
  return mockAuthSessionCreate.mock.calls[0][0] as Record<string, unknown>;
}

async function createSession(headers: Record<string, string>): Promise<JsonResponse> {
  return requestJson(
    'POST',
    '/auth/session/create',
    { sessionToken: `tok-${Math.random().toString(16).slice(2)}`, clientId: 'oxy_dk_client' },
    headers,
  );
}

describe('POST /auth/session/create — coarse requester label', () => {
  it('persists a coarse browser/OS label for a browser caller', async () => {
    const res = await createSession({
      'user-agent': CHROME_WINDOWS_UA,
      origin: 'https://acme.example',
    });

    expect(res.status).toBe(200);
    expect(createdDoc().requesterLabel).toBe('Chrome on Windows');
  });

  it('derives the label from the OS too (Firefox on macOS)', async () => {
    const res = await createSession({
      'user-agent': FIREFOX_MAC_UA,
      origin: 'https://acme.example',
    });

    expect(res.status).toBe(200);
    expect(createdDoc().requesterLabel).toBe('Firefox on macOS');
  });

  it('NEVER persists the raw User-Agent — only the coarse label', async () => {
    await createSession({ 'user-agent': CHROME_WINDOWS_UA, origin: 'https://acme.example' });

    const doc = createdDoc();
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain(CHROME_WINDOWS_UA);
    // No version, engine, or architecture detail survives the derivation.
    expect(serialized).not.toContain('126.0.6478.127');
    expect(serialized).not.toContain('AppleWebKit');
    expect(serialized).not.toContain('Win64');
    expect(Object.keys(doc)).not.toContain('userAgent');
  });

  it('persists NO ip address, location, or country anywhere on the path', async () => {
    await createSession({
      'user-agent': CHROME_WINDOWS_UA,
      origin: 'https://acme.example',
      'cf-ipcountry': 'ES',
      'x-forwarded-for': '203.0.113.7',
    });

    const doc = createdDoc();
    expect(Object.keys(doc).filter((key) => /ip|location|country|geo/i.test(key))).toEqual([]);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('203.0.113.7');
    expect(serialized).not.toContain('ES');
  });

  it('persists null for a NATIVE caller (no browser context, no browser UA)', async () => {
    const res = await createSession({ 'user-agent': NATIVE_UA });

    expect(res.status).toBe(200);
    expect(createdDoc().requesterLabel).toBeNull();
  });

  it('persists null when there is no browser context, even for a browser-shaped UA', async () => {
    // No Origin and no Referer → the caller cannot be a browser doing this POST,
    // so a browser-shaped User-Agent is never taken at face value.
    const res = await createSession({ 'user-agent': CHROME_WINDOWS_UA });

    expect(res.status).toBe(200);
    expect(createdDoc().requesterLabel).toBeNull();
  });

  it.each([
    ['junk', '!!!! 12345 ????'],
    ['a non-browser HTTP client', 'curl/8.4.0'],
    ['the literal "unknown" placeholder', 'unknown'],
    ['an OS with no identifiable browser', 'SomeBot/1.0 (Windows NT 10.0)'],
  ])('persists null for %s rather than a junk label', async (_label, userAgent) => {
    const res = await createSession({ 'user-agent': userAgent, origin: 'https://acme.example' });

    expect(res.status).toBe(200);
    expect(createdDoc().requesterLabel).toBeNull();
  });

  it('never echoes the label back to the REQUESTER (it is for the approver only)', async () => {
    const res = await createSession({
      'user-agent': CHROME_WINDOWS_UA,
      origin: 'https://acme.example',
    });

    expect(res.body.data).toBeDefined();
    expect(Object.keys(res.body.data ?? {})).not.toContain('requesterLabel');
  });
});

describe('GET /auth/session/approve-info/:authorizeCode — requester label exposure', () => {
  function pendingSession(overrides: Record<string, unknown>) {
    return {
      sessionToken: 'SECRET-do-not-leak',
      authorizeCode: 'code-1',
      applicationId: { toString: () => THIRD_PARTY_APP_ID },
      boundOrigin: 'https://acme.example',
      deviceId: 'device-of-the-requester',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      save: jest.fn(),
      ...overrides,
    };
  }

  it('exposes the persisted coarse label', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession({ requesterLabel: 'Chrome on Windows' }));

    const res = await requestJson('GET', '/auth/session/approve-info/code-1', null);

    expect(res.status).toBe(200);
    expect(res.body.data?.requesterLabel).toBe('Chrome on Windows');
  });

  it('returns null when the row has no label (native caller / row predating the field)', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession({}));

    const res = await requestJson('GET', '/auth/session/approve-info/code-1', null);

    expect(res.status).toBe(200);
    expect(res.body.data?.requesterLabel).toBeNull();
  });

  it('leaks nothing beyond the coarse label — no UA, no ip, no deviceId, no secret', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(
      pendingSession({ requesterLabel: 'Chrome on Windows' }),
    );

    const res = await requestJson('GET', '/auth/session/approve-info/code-1', null, {
      'user-agent': CHROME_WINDOWS_UA,
      'x-forwarded-for': '203.0.113.7',
    });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('SECRET-do-not-leak');
    expect(serialized).not.toContain(CHROME_WINDOWS_UA);
    expect(serialized).not.toContain('203.0.113.7');
    expect(serialized).not.toContain('device-of-the-requester');
    expect(Object.keys(res.body.data ?? {}).filter((key) => /ip|location|country|geo|userAgent|deviceId/i.test(key)))
      .toEqual([]);
  });
});
