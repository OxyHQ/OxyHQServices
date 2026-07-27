/**
 * authorizeSessionWithSignedChallenge tests (C2 — key-signed QR handoff).
 *
 * The Commons vault approves a cross-app session with its LOCAL key (no bearer):
 * it proves key control with a single-use challenge signature, and the resolved
 * SIGNER becomes the authorizing user. This isolates that service so each branch
 * is asserted independently: challenge validity, signature, atomic burn, the
 * pending/unexpired authorizeCode binding, signer→user resolution, and the
 * authorized-session binding (incl. double-approve idempotency).
 *
 * `SignatureService.verifyChallengeResponse` is mocked (its crypto is covered in
 * signature.service tests) so each branch is deterministic.
 */

const mockChallengeFindOne = jest.fn();
const mockChallengeFindOneAndUpdate = jest.fn();
const mockAuthSessionFindOne = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserFindById = jest.fn();
const mockApplicationFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockVerifyChallengeResponse = jest.fn();
const mockVerifyActingAs = jest.fn();

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockChallengeFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockChallengeFindOneAndUpdate(...args),
  },
}));
jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockAuthSessionFindOne(...args) },
  AuthSession: { findOne: (...args: unknown[]) => mockAuthSessionFindOne(...args) },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
  default: {
    findOne: (...args: unknown[]) => mockUserFindOne(...args),
    findById: (...args: unknown[]) => mockUserFindById(...args),
  },
}));
// The delegated-subject gate reuses the EXISTING act-as mechanism, imported
// lazily by the service (mirroring session.service's managed-session re-check).
jest.mock('../account.service', () => ({
  __esModule: true,
  accountService: { verifyActingAs: (...args: unknown[]) => mockVerifyActingAs(...args) },
}));
jest.mock('../../models/Application', () => ({
  __esModule: true,
  Application: { findById: (...args: unknown[]) => mockApplicationFindById(...args) },
  default: { findById: (...args: unknown[]) => mockApplicationFindById(...args) },
}));
jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: (...args: unknown[]) => mockCreateSession(...args) },
}));
jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: { verifyChallengeResponse: (...args: unknown[]) => mockVerifyChallengeResponse(...args) },
}));

import { authorizeSessionWithSignedChallenge } from '../authSession.service';

const PUBLIC_KEY = '02abc123';
const AUTHORIZE_CODE = 'a'.repeat(32);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    authorizeCode: AUTHORIZE_CODE,
    publicKey: PUBLIC_KEY,
    challenge: 'chal-1',
    signature: 'sig-1',
    timestamp: Date.now(),
    deviceFingerprint: 'fp-1',
    req: {} as never,
    ...overrides,
  };
}

function leanChallenge() {
  return { lean: () => Promise.resolve({ _id: 'chal-id', publicKey: PUBLIC_KEY }) };
}
function leanUser(user: unknown) {
  return { lean: () => Promise.resolve(user) };
}
function pendingSession() {
  return {
    sessionToken: 'secret-token',
    authorizeCode: AUTHORIZE_CODE,
    applicationId: { toString: () => 'app-1' },
    status: 'pending' as string,
    expiresAt: new Date(Date.now() + 60_000),
    authorizedBy: null as string | null,
    authorizedUserId: null as unknown,
    authorizedSessionId: null as string | null,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authorizeSessionWithSignedChallenge', () => {
  it('authorizes and binds the verified signer as the session user', async () => {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id' }); // burn wins
    const session = pendingSession();
    mockAuthSessionFindOne.mockResolvedValueOnce(session);
    mockUserFindOne.mockReturnValueOnce(leanUser({ _id: { toString: () => 'user-123' }, username: 'nate' }));
    mockApplicationFindById.mockResolvedValueOnce({ name: 'Acme Widgets' });
    mockCreateSession.mockResolvedValueOnce({ sessionId: 'sess-1' });

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({
      ok: true,
      sessionToken: 'secret-token',
      sessionId: 'sess-1',
      userId: 'user-123',
      username: 'nate',
      publicKey: PUBLIC_KEY,
    });
    // Device label derives from the bound application.
    expect(mockCreateSession).toHaveBeenCalledWith('user-123', expect.anything(), expect.objectContaining({ deviceName: 'Acme Widgets App' }));
    // The session row is bound to the signer and persisted.
    expect(session.status).toBe('authorized');
    expect(session.authorizedBy).toBe(PUBLIC_KEY);
    expect(session.authorizedSessionId).toBe('sess-1');
    expect(session.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid signature with 401 and never burns the challenge', async () => {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(false);

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid signature' });
    expect(mockChallengeFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('rejects a missing/expired/used challenge with 401', async () => {
    mockChallengeFindOne.mockReturnValueOnce({ lean: () => Promise.resolve(null) });

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid or expired challenge' });
    expect(mockVerifyChallengeResponse).not.toHaveBeenCalled();
  });

  it('rejects when the atomic burn loses the race (concurrent consume) with 401', async () => {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce(null); // already burned

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid or expired challenge' });
    expect(mockAuthSessionFindOne).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown/non-pending authorizeCode', async () => {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id' });
    mockAuthSessionFindOne.mockResolvedValueOnce(null);

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({ ok: false, status: 404, message: 'Auth session not found or already processed' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 400 and marks the session expired when the authorizeCode has elapsed', async () => {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id' });
    const session = { ...pendingSession(), expiresAt: new Date(Date.now() - 1000), save: jest.fn().mockResolvedValue(undefined) };
    mockAuthSessionFindOne.mockResolvedValueOnce(session);

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({ ok: false, status: 400, message: 'Auth session has expired' });
    expect(session.status).toBe('expired');
    expect(session.save).toHaveBeenCalled();
  });

  it('returns 404 when no user owns the signer publicKey', async () => {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id' });
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession());
    mockUserFindOne.mockReturnValueOnce(leanUser(null));

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({ ok: false, status: 404, message: 'User not found' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('is idempotent: a second approval (session no longer pending) returns 404', async () => {
    // First approval succeeds.
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id' });
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession());
    mockUserFindOne.mockReturnValueOnce(leanUser({ _id: { toString: () => 'user-123' }, username: 'nate' }));
    mockApplicationFindById.mockResolvedValueOnce({ name: 'Acme' });
    mockCreateSession.mockResolvedValueOnce({ sessionId: 'sess-1' });
    const first = await authorizeSessionWithSignedChallenge(baseInput());
    expect(first.ok).toBe(true);

    // Second approval with a fresh challenge: the pending-status lookup misses.
    mockChallengeFindOne.mockReturnValueOnce({ lean: () => Promise.resolve({ _id: 'chal-id-2', publicKey: PUBLIC_KEY }) });
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id-2' });
    mockAuthSessionFindOne.mockResolvedValueOnce(null); // status is now 'authorized', not 'pending'
    const second = await authorizeSessionWithSignedChallenge(baseInput({ challenge: 'chal-2' }));

    expect(second).toEqual({ ok: false, status: 404, message: 'Auth session not found or already processed' });
  });
});

/**
 * The Commons vault is the PRIMARY approval surface, so the delegated-subject
 * permission gate has to hold here — not just on the bearer approval paths. The
 * identity never becomes the organisation; it authorises the app to act as it,
 * and only when it actually holds `account:act_as`.
 */
describe('authorizeSessionWithSignedChallenge — delegated subject (OAuth request)', () => {
  const ORG_ID = '64f7c2a1b8e9d3f4a1c2b402';

  function delegatedOAuthSession() {
    return {
      ...pendingSession(),
      purpose: 'oauth_authorization',
      oauth: {
        redirectUri: 'https://mention.earth/oauth/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        codeChallengeMethod: 'S256',
        scopes: ['user:read'],
        subjectAccountId: { toString: () => ORG_ID },
      },
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  function primeVerifiedSigner(session: unknown) {
    mockChallengeFindOne.mockReturnValueOnce(leanChallenge());
    mockVerifyChallengeResponse.mockReturnValueOnce(true);
    mockChallengeFindOneAndUpdate.mockResolvedValueOnce({ _id: 'chal-id' });
    mockAuthSessionFindOne.mockResolvedValueOnce(session);
    mockUserFindOne.mockReturnValueOnce(leanUser({ _id: { toString: () => 'user-123' }, username: 'nate' }));
  }

  it('refuses (403) when the signer cannot act as the delegated subject', async () => {
    const session = delegatedOAuthSession();
    primeVerifiedSigner(session);
    mockUserFindById.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ kind: 'organization', accountStatus: 'active' }) }),
    });
    mockVerifyActingAs.mockResolvedValueOnce(null);

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({
      ok: false,
      status: 403,
      message: 'Not authorized to act as the requested account',
    });
    expect(mockVerifyActingAs).toHaveBeenCalledWith('user-123', ORG_ID);
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
    expect(session.status).toBe('pending');
  });

  it('approves a permitted delegated subject and mints NO session (the result is a code)', async () => {
    const session = delegatedOAuthSession();
    primeVerifiedSigner(session);
    mockUserFindById.mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ kind: 'organization', accountStatus: 'active' }) }),
    });
    mockVerifyActingAs.mockResolvedValueOnce('admin');

    const outcome = await authorizeSessionWithSignedChallenge(baseInput());

    expect(outcome).toEqual({
      ok: true,
      sessionToken: 'secret-token',
      userId: 'user-123',
      username: 'nate',
      publicKey: PUBLIC_KEY,
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    // WHICH identity approved is recorded on the request.
    expect(session.status).toBe('authorized');
    expect(session.authorizedBy).toBe(PUBLIC_KEY);
    expect(session.authorizedSessionId).toBeNull();
    expect(session.save).toHaveBeenCalledTimes(1);
  });
});
