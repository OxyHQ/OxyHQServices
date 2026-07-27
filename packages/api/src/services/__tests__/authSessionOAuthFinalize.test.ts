/**
 * OAuth-bound AuthSession finalization (issue #691, phase 3).
 *
 * One authorization request, one authorization code — forever. These tests pin
 * the security properties at the MODEL boundary (what actually reaches
 * `AuthSession.findOneAndUpdate` / `AuthCode.create`), because that is where the
 * single-use guarantee lives:
 *
 *  - exactly ONE `AuthCode` per request, even under concurrent finalizations
 *  - a finalized request can never mint a second code
 *  - the issued code is still single-use + PKCE-bound through `exchangeAuthCode`
 *  - a delegated subject is refused unless the approving identity holds
 *    `account:act_as` over it (the EXISTING act-as mechanism, mocked here)
 *  - device-sign-in requests are untouched: they still claim, and they can never
 *    be finalized into a code
 *
 * Models are mocked with faithful in-memory stores; all service logic is real.
 */

import * as crypto from 'crypto';

interface StoredAuthSession {
  _id: string;
  sessionToken: string;
  authorizeCode: string;
  applicationId: { toString: () => string };
  status: string;
  purpose?: string;
  oauth?: {
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: string[];
    subjectAccountId?: { toString: () => string };
  };
  finalizedAuthCodeId: unknown;
  authorizedUserId?: { toString: () => string };
  deviceId?: string;
  consumedAt?: Date;
  expiresAt: Date;
}

const authSessions = new Map<string, StoredAuthSession>();

/** Mongo semantics: `{ field: null }` matches null AND missing. */
function matchesNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

const mockAuthSessionFindOneAndUpdate = jest.fn(
  async (
    filter: Record<string, unknown>,
    update: { $set: Record<string, unknown> }
  ): Promise<StoredAuthSession | null> => {
    for (const doc of authSessions.values()) {
      if (filter._id !== undefined && doc._id !== filter._id) continue;
      if (filter.purpose !== undefined && doc.purpose !== filter.purpose) continue;
      if (filter.status !== undefined && doc.status !== filter.status) continue;
      if (filter.finalizedAuthCodeId === null && !matchesNullish(doc.finalizedAuthCodeId)) continue;
      Object.assign(doc, update.$set);
      return { ...doc };
    }
    return null;
  }
);

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: {
    // Return a SNAPSHOT (as a real driver would) so pre-claim reads can never
    // observe a concurrent claim — only the atomic update decides the winner.
    findOne: jest.fn(async (query: { sessionToken?: string }) => {
      for (const doc of authSessions.values()) {
        if (query.sessionToken && doc.sessionToken === query.sessionToken) return { ...doc };
      }
      return null;
    }),
    findOneAndUpdate: (...args: [Record<string, unknown>, { $set: Record<string, unknown> }]) =>
      mockAuthSessionFindOneAndUpdate(...args),
  },
}));

interface StoredCode {
  _id: string;
  codeHash: string;
  userId: string;
  operatedByUserId: string | null;
  appId: string;
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  scopes: string[];
  deviceId: string | null;
  usedAt: Date | null;
  expiresAt: Date;
}

const codes = new Map<string, StoredCode>();
const mockAuthCodeCreate = jest.fn(async (data: Record<string, unknown>) => {
  const record: StoredCode = {
    _id: String(data._id ?? `code-${codes.size + 1}`),
    codeHash: String(data.codeHash ?? ''),
    userId: String(data.userId ?? ''),
    operatedByUserId: data.operatedByUserId ? String(data.operatedByUserId) : null,
    appId: String(data.appId ?? ''),
    redirectUri: String(data.redirectUri ?? ''),
    codeChallenge: data.codeChallenge ? String(data.codeChallenge) : null,
    codeChallengeMethod: data.codeChallengeMethod ? String(data.codeChallengeMethod) : null,
    scopes: Array.isArray(data.scopes) ? (data.scopes as string[]) : [],
    deviceId: data.deviceId ? String(data.deviceId) : null,
    usedAt: null,
    expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(Date.now() + 60_000),
  };
  codes.set(record.codeHash, record);
  return record;
});

jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  default: {
    create: (...args: [Record<string, unknown>]) => mockAuthCodeCreate(...args),
    findOne: jest.fn(async (query: { codeHash: string }) => codes.get(query.codeHash) ?? null),
    findOneAndUpdate: jest.fn(
      async (filter: { _id: string; usedAt: null }, update: { $set: { usedAt: Date } }) => {
        for (const record of codes.values()) {
          if (record._id !== filter._id) continue;
          if (record.usedAt !== null) return null;
          record.usedAt = update.$set.usedAt;
          return record;
        }
        return null;
      }
    ),
  },
  AuthCode: {},
}));

const mockApplicationFindOne = jest.fn();
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: {
    findOne: (...args: unknown[]) => mockApplicationFindOne(...args),
    findById: jest.fn(),
  },
  default: {
    findOne: (...args: unknown[]) => mockApplicationFindOne(...args),
    findById: jest.fn(),
  },
}));

const mockUserFindById = jest.fn();
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn(), findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findOne: jest.fn(), findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

const mockAppGrantFindOneAndUpdate = jest.fn(async () => ({}));
jest.mock('../../models/AppGrant', () => ({
  __esModule: true,
  AppGrant: { findOneAndUpdate: (...args: unknown[]) => mockAppGrantFindOneAndUpdate(...args) },
  default: { findOneAndUpdate: (...args: unknown[]) => mockAppGrantFindOneAndUpdate(...args) },
}));

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

const mockCreateSession = jest.fn();
jest.mock('../session.service', () => ({
  __esModule: true,
  default: { createSession: (...args: unknown[]) => mockCreateSession(...args) },
}));

jest.mock('../signature.service', () => ({
  __esModule: true,
  default: { verifyChallengeResponse: jest.fn(), isValidPublicKey: jest.fn() },
}));

const mockVerifyActingAs = jest.fn();
jest.mock('../account.service', () => ({
  __esModule: true,
  accountService: { verifyActingAs: (...args: unknown[]) => mockVerifyActingAs(...args) },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { claimAuthSession, finalizeOAuthAuthorization } from '../authSession.service';
import { exchangeAuthCode } from '../oauthCode.service';

const APP_ID = '64f7c2a1b8e9d3f4a1c2b301';
const IDENTITY_ID = '64f7c2a1b8e9d3f4a1c2b401';
const ORG_ID = '64f7c2a1b8e9d3f4a1c2b402';
const REDIRECT_URI = 'https://mention.earth/oauth/callback';
const CODE_VERIFIER = 'a'.repeat(64);
const CODE_CHALLENGE = crypto
  .createHash('sha256')
  .update(CODE_VERIFIER)
  .digest('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

function activeApp(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => APP_ID },
    name: 'Mention',
    status: 'active',
    type: 'third_party',
    isOfficial: false,
    isInternal: false,
    scopes: ['user:read'],
    redirectUris: [REDIRECT_URI],
    ...overrides,
  };
}

function seedOAuthSession(overrides: Partial<StoredAuthSession> = {}): StoredAuthSession {
  const doc: StoredAuthSession = {
    _id: 'as-1',
    sessionToken: 'secret-session-token',
    authorizeCode: 'public-code',
    applicationId: { toString: () => APP_ID },
    status: 'authorized',
    purpose: 'oauth_authorization',
    oauth: {
      redirectUri: REDIRECT_URI,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256',
      scopes: ['user:read'],
    },
    finalizedAuthCodeId: null,
    authorizedUserId: { toString: () => IDENTITY_ID },
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
  authSessions.set(doc._id, doc);
  return doc;
}

beforeEach(() => {
  jest.clearAllMocks();
  authSessions.clear();
  codes.clear();
  mockApplicationFindOne.mockResolvedValue(activeApp());
  mockAppGrantFindOneAndUpdate.mockResolvedValue({});
});

describe('finalizeOAuthAuthorization — preconditions', () => {
  it('refuses a request that was never approved', async () => {
    seedOAuthSession({ status: 'pending' });

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'not_authorized' });
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });

  it('refuses a device sign-in request (wrong purpose) even when authorized', async () => {
    seedOAuthSession({ purpose: 'device_sign_in', oauth: undefined });

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'wrong_purpose' });
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });

  it('refuses an unknown sessionToken', async () => {
    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'nope' });

    expect(outcome).toEqual({ ok: false, reason: 'not_found' });
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });

  it('refuses an expired request', async () => {
    seedOAuthSession({ expiresAt: new Date(Date.now() - 1_000) });

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'expired' });
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });

  it('refuses when the application is no longer active', async () => {
    seedOAuthSession();
    mockApplicationFindOne.mockResolvedValue(null);

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'application_unavailable' });
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });

  it('refuses when the bound redirect URI is no longer registered', async () => {
    seedOAuthSession();
    mockApplicationFindOne.mockResolvedValue(
      activeApp({ redirectUris: ['https://mention.earth/other/callback'] })
    );

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'redirect_uri_unregistered' });
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });
});

describe('finalizeOAuthAuthorization — atomic, single-use minting', () => {
  it('mints exactly one AuthCode and spends the request', async () => {
    seedOAuthSession({ deviceId: 'device-rp-1' });

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({
      ok: true,
      code: expect.any(String),
      redirectUri: REDIRECT_URI,
      expiresIn: 60,
    });
    expect(mockAuthCodeCreate).toHaveBeenCalledTimes(1);

    const created = mockAuthCodeCreate.mock.calls[0][0];
    // Bound to the approving identity, the app, the exact redirect, PKCE and scopes.
    expect(created.userId).toBe(IDENTITY_ID);
    expect(created.operatedByUserId).toBeNull();
    expect(created.appId).toBe(APP_ID);
    expect(created.redirectUri).toBe(REDIRECT_URI);
    expect(created.codeChallenge).toBe(CODE_CHALLENGE);
    expect(created.codeChallengeMethod).toBe('S256');
    expect(created.scopes).toEqual(['user:read']);
    // Threads the originating RP device instead of sprawling a new one.
    expect(created.deviceId).toBe('device-rp-1');
    // The raw code is NEVER stored — only its hash.
    expect(JSON.stringify(created)).not.toContain((outcome as { code: string }).code);

    // The request is spent: consumed + the code id reserved on the row.
    const stored = authSessions.get('as-1');
    expect(stored?.status).toBe('consumed');
    expect(stored?.finalizedAuthCodeId).toBe(created._id);
    expect(stored?.consumedAt).toBeInstanceOf(Date);
  });

  it('two concurrent finalizations yield exactly ONE AuthCode', async () => {
    seedOAuthSession();

    const [first, second] = await Promise.all([
      finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' }),
      finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' }),
    ]);

    // Both raced past the read-only preconditions; only one won the atomic claim.
    expect(mockAuthSessionFindOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mockAuthCodeCreate).toHaveBeenCalledTimes(1);

    const outcomes = [first, second];
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toEqual([{ ok: false, reason: 'already_finalized' }]);
  });

  it('a finalized request can never mint a second code', async () => {
    seedOAuthSession();

    const first = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });
    expect(first.ok).toBe(true);

    const replay = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(replay).toEqual({ ok: false, reason: 'already_finalized' });
    expect(mockAuthCodeCreate).toHaveBeenCalledTimes(1);
  });

  it('records the third-party grant so the app stays revocable in Connected apps', async () => {
    seedOAuthSession();

    await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(mockAppGrantFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('never records a grant for a trusted first-party app (auto-approved)', async () => {
    seedOAuthSession();
    mockApplicationFindOne.mockResolvedValue(activeApp({ type: 'first_party', isOfficial: true }));

    await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(mockAuthCodeCreate).toHaveBeenCalledTimes(1);
    expect(mockAppGrantFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('finalizeOAuthAuthorization — issued code stays single-use + PKCE bound', () => {
  it('exchanges once with the correct verifier and never again', async () => {
    seedOAuthSession();
    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });
    if (!outcome.ok) throw new Error('expected finalization to succeed');

    const wrongVerifier = await exchangeAuthCode({
      rawCode: outcome.code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: 'b'.repeat(64),
    });
    expect(wrongVerifier).toEqual({ ok: false, reason: 'invalid_grant' });

    const first = await exchangeAuthCode({
      rawCode: outcome.code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });
    expect(first.ok).toBe(true);

    const replay = await exchangeAuthCode({
      rawCode: outcome.code,
      appId: APP_ID,
      redirectUri: REDIRECT_URI,
      codeVerifier: CODE_VERIFIER,
    });
    expect(replay).toEqual({ ok: false, reason: 'invalid_grant' });
  });

  it('intersects requested scopes with the application registered scopes', async () => {
    seedOAuthSession({
      oauth: {
        redirectUri: REDIRECT_URI,
        codeChallenge: CODE_CHALLENGE,
        codeChallengeMethod: 'S256',
        scopes: ['user:read', 'signals:write', 'bogus:scope'],
      },
    });
    mockApplicationFindOne.mockResolvedValue(
      activeApp({ scopes: ['user:read', 'signals:write'] })
    );

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });
    if (!outcome.ok) throw new Error('expected finalization to succeed');

    expect(mockAuthCodeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['user:read', 'signals:write'] })
    );
    expect(mockAppGrantFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $addToSet: { scopes: { $each: ['user:read', 'signals:write'] } },
      }),
      expect.anything()
    );
  });

  it('refuses the exchange when the redirect URI does not match the binding', async () => {
    seedOAuthSession();
    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });
    if (!outcome.ok) throw new Error('expected finalization to succeed');

    const mismatched = await exchangeAuthCode({
      rawCode: outcome.code,
      appId: APP_ID,
      redirectUri: 'https://evil.example/callback',
      codeVerifier: CODE_VERIFIER,
    });

    expect(mismatched).toEqual({ ok: false, reason: 'invalid_grant' });
  });
});

describe('finalizeOAuthAuthorization — delegated subject', () => {
  function seedDelegated() {
    return seedOAuthSession({
      oauth: {
        redirectUri: REDIRECT_URI,
        codeChallenge: CODE_CHALLENGE,
        codeChallengeMethod: 'S256',
        scopes: ['user:read'],
        subjectAccountId: { toString: () => ORG_ID },
      },
    });
  }

  function mockSubjectAccount(account: { kind?: string; accountStatus?: string } | null) {
    mockUserFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(account) }) });
  }

  it('refuses when the approving identity does not hold act_as over the subject', async () => {
    seedDelegated();
    mockSubjectAccount({ kind: 'organization', accountStatus: 'active' });
    mockVerifyActingAs.mockResolvedValue(null);

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'delegation_denied' });
    expect(mockVerifyActingAs).toHaveBeenCalledWith(IDENTITY_ID, ORG_ID);
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
    // Nothing was spent — a refused delegation must not consume the request.
    expect(authSessions.get('as-1')?.status).toBe('authorized');
  });

  it('refuses a PERSONAL account as a delegated subject (that would be impersonation)', async () => {
    seedDelegated();
    mockSubjectAccount({ kind: 'personal', accountStatus: 'active' });

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'delegation_denied' });
    expect(mockVerifyActingAs).not.toHaveBeenCalled();
    expect(mockAuthCodeCreate).not.toHaveBeenCalled();
  });

  it('issues the code FOR the subject account with the approving identity recorded', async () => {
    seedDelegated();
    mockSubjectAccount({ kind: 'organization', accountStatus: 'active' });
    mockVerifyActingAs.mockResolvedValue('admin');

    const outcome = await finalizeOAuthAuthorization({ sessionToken: 'secret-session-token' });

    expect(outcome.ok).toBe(true);
    expect(mockAuthCodeCreate).toHaveBeenCalledTimes(1);
    const created = mockAuthCodeCreate.mock.calls[0][0];
    // The two ids are modelled explicitly — never conflated.
    expect(created.userId).toBe(ORG_ID);
    expect(created.operatedByUserId).toBe(IDENTITY_ID);
  });
});

describe('device sign-in requests are unaffected', () => {
  it('still claims a device sign-in request', async () => {
    seedOAuthSession({ purpose: 'device_sign_in', oauth: undefined });

    const outcome = await claimAuthSession({ sessionToken: 'secret-session-token' });

    expect(outcome.ok).toBe(true);
    expect(mockAuthSessionFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'authorized' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'consumed' }) }),
      expect.anything()
    );
  });

  it('still claims a legacy row that predates the purpose field', async () => {
    seedOAuthSession({ purpose: undefined, oauth: undefined });

    const outcome = await claimAuthSession({ sessionToken: 'secret-session-token' });

    expect(outcome.ok).toBe(true);
  });

  it('refuses to claim an OAuth authorization request (no access token for a code flow)', async () => {
    seedOAuthSession();

    const outcome = await claimAuthSession({ sessionToken: 'secret-session-token' });

    expect(outcome).toEqual({ ok: false, reason: 'wrong_purpose' });
    expect(mockAuthSessionFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
