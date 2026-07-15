/**
 * authorizeSessionWithBearer tests (b2 — cross-domain passkey hub).
 *
 * Bearer approval of a pending cross-app auth session keyed on the PUBLIC
 * authorizeCode (the auth.oxy.so passkey hub authorizes with its bearer,
 * never a local secp256k1 key). Security-review follow-up (PR #640):
 *
 *  - MEDIUM-1: the claim must be ATOMIC — a `findOneAndUpdate` conditioned on
 *    `status:'pending'` — so two concurrent authorizes of the same code
 *    cannot both mint a session. Verified directly here by simulating the
 *    atomic update losing the race (returns null).
 *  - An `originVerified:false` authorize (exactly the shape a login-CSRF
 *    attempt takes) must be logged for audit, even though it still succeeds
 *    server-side — the client-side mandatory consent screen is the primary
 *    defense (covered in the services-level OxyAuthChooser/hub-passkey tests).
 */

const mockAuthSessionFindOne = jest.fn();
const mockAuthSessionFindOneAndUpdate = jest.fn();
const mockApplicationFindById = jest.fn();
const mockCreateSession = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('../../models/AuthSession', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockAuthSessionFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockAuthSessionFindOneAndUpdate(...args),
  },
  AuthSession: {
    findOne: (...args: unknown[]) => mockAuthSessionFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockAuthSessionFindOneAndUpdate(...args),
  },
}));
// authSession.service.ts imports User for authorizeSessionWithSignedChallenge
// (unused by the function under test here) — mocked so the real Mongoose
// schema doesn't run under the global mongoose mock (which lacks Schema.set).
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: jest.fn() },
  default: { findOne: jest.fn() },
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
jest.mock('../../utils/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { authorizeSessionWithBearer } from '../authSession.service';

const AUTHORIZE_CODE = 'b'.repeat(32);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    authorizeCode: AUTHORIZE_CODE,
    authenticatedUserId: 'user-123',
    authenticatedPublicKey: 'pk-victim',
    deviceFingerprint: 'fp-1',
    req: {} as never,
    ...overrides,
  };
}

function pendingSession(over: Record<string, unknown> = {}) {
  return {
    sessionToken: 'secret-token',
    authorizeCode: AUTHORIZE_CODE,
    applicationId: { toString: () => 'app-1' },
    status: 'pending' as string,
    expiresAt: new Date(Date.now() + 60_000),
    originVerified: true,
    boundOrigin: 'https://mention.earth',
    deviceId: null as string | null,
    authorizedBy: null as string | null,
    authorizedUserId: null as unknown,
    authorizedSessionId: null as string | null,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authorizeSessionWithBearer', () => {
  it('atomically claims, mints a session, and binds it to the bearer-authenticated user', async () => {
    const session = pendingSession();
    mockAuthSessionFindOne.mockResolvedValueOnce(session);
    const claimed = pendingSession({ status: 'authorized' });
    mockAuthSessionFindOneAndUpdate.mockResolvedValueOnce(claimed);
    mockApplicationFindById.mockResolvedValueOnce({ name: 'Acme Widgets' });
    mockCreateSession.mockResolvedValueOnce({ sessionId: 'sess-1' });

    const outcome = await authorizeSessionWithBearer(baseInput());

    expect(outcome).toEqual({ ok: true, sessionToken: 'secret-token', sessionId: 'sess-1' });
    // The atomic claim is conditioned on status:'pending' + unexpired, and
    // sets the bearer-resolved identity — never anything client-asserted.
    expect(mockAuthSessionFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: session._id, status: 'pending', expiresAt: { $gt: expect.any(Date) } },
      { $set: expect.objectContaining({ status: 'authorized', authorizedUserId: 'user-123', authorizedBy: 'pk-victim' }) },
      { new: true },
    );
    expect(mockCreateSession).toHaveBeenCalledWith('user-123', expect.anything(), expect.objectContaining({ deviceName: 'Acme Widgets App' }));
    expect(claimed.authorizedSessionId).toBe('sess-1');
    expect(claimed.save).toHaveBeenCalledTimes(1);
    // Verified origin — no audit warning.
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('MEDIUM-1: rejects the loser of a concurrent authorize BEFORE minting a session (atomic burn)', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession());
    // The atomic update matched nothing — a concurrent request already won
    // the pending -> authorized transition.
    mockAuthSessionFindOneAndUpdate.mockResolvedValueOnce(null);

    const outcome = await authorizeSessionWithBearer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 404, message: 'Auth session not found or already processed' });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(null);

    const outcome = await authorizeSessionWithBearer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 404, message: 'Auth session not found or already processed' });
    expect(mockAuthSessionFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('returns 404 for an already-processed (non-pending) authorizeCode', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession({ status: 'authorized' }));

    const outcome = await authorizeSessionWithBearer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 404, message: 'Auth session not found or already processed' });
    expect(mockAuthSessionFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 for an expired authorizeCode WITHOUT attempting the atomic claim', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession({ expiresAt: new Date(Date.now() - 1000) }));

    const outcome = await authorizeSessionWithBearer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 400, message: 'Auth session has expired' });
    expect(mockAuthSessionFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('logs an audit warning when the session is authorized with an UNVERIFIED origin', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession({ originVerified: false }));
    const claimed = pendingSession({ status: 'authorized', originVerified: false });
    mockAuthSessionFindOneAndUpdate.mockResolvedValueOnce(claimed);
    mockApplicationFindById.mockResolvedValueOnce({ name: 'Acme Widgets' });
    mockCreateSession.mockResolvedValueOnce({ sessionId: 'sess-2' });

    const outcome = await authorizeSessionWithBearer(baseInput());

    expect(outcome.ok).toBe(true);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringMatching(/unverified origin/i),
      expect.objectContaining({ userId: 'user-123' }),
    );
  });

  it('mints onto the originating deviceId when the flow was created with one', async () => {
    mockAuthSessionFindOne.mockResolvedValueOnce(pendingSession({ deviceId: 'device-xyz' }));
    const claimed = pendingSession({ status: 'authorized', deviceId: 'device-xyz' });
    mockAuthSessionFindOneAndUpdate.mockResolvedValueOnce(claimed);
    mockApplicationFindById.mockResolvedValueOnce({ name: 'Acme Widgets' });
    mockCreateSession.mockResolvedValueOnce({ sessionId: 'sess-3' });

    await authorizeSessionWithBearer(baseInput());

    expect(mockCreateSession).toHaveBeenCalledWith('user-123', expect.anything(), expect.objectContaining({ deviceId: 'device-xyz' }));
  });
});
