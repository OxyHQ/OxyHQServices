/**
 * SessionController.signIn tests
 *
 * Regression coverage for:
 *  - H5: constant-time username lookup. When the identifier resolves to
 *    no user, we must still execute a password verification call so the
 *    response timing is indistinguishable from the wrong-password branch.
 *  - H7: per-account invalid-attempt throttling. After repeated failures we
 *    return 429 + Retry-After for invalid credentials, but a correct
 *    password still clears failures and signs in so attackers cannot lock
 *    victims out of their accounts.
 */

const mockUserFindOne = jest.fn();
const mockVerifyPassword = jest.fn();
const mockHashPassword = jest.fn();
const mockValidatePasswordStrength = jest.fn();
const mockCreateSession = jest.fn();
const mockCheckForAnomalies = jest.fn().mockResolvedValue({ hasAnomalies: false });
const mockIsLockedOut = jest.fn();
const mockRecordFailure = jest.fn();
const mockClearFailures = jest.fn();

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findOne: mockUserFindOne, findById: jest.fn() },
  default: { findOne: mockUserFindOne },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../models/AuthChallenge', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RecoveryCode', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Notification', () => ({ __esModule: true, default: jest.fn() }));
// The session controller transitively imports deviceSession.service, which pulls
// in oauthCode.service -> AuthCode model. Mock it so module evaluation does not
// touch the (mocked) Mongoose Schema.Types.
jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn() },
  default: { create: jest.fn() },
}));

jest.mock('../../utils/password', () => ({
  verifyPassword: mockVerifyPassword,
  hashPassword: mockHashPassword,
  validatePasswordStrength: mockValidatePasswordStrength,
  generateAlphanumericCode: jest.fn().mockReturnValue('CODE12345Z'),
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: mockCreateSession },
}));

jest.mock('../../services/anomalyDetection.service', () => ({
  __esModule: true,
  default: { checkForAnomalies: mockCheckForAnomalies },
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: { logSignIn: jest.fn(), logSignOut: jest.fn(), logAccountRecovery: jest.fn() },
}));

jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: mockIsLockedOut,
  recordFailure: mockRecordFailure,
  clearFailures: mockClearFailures,
}));

jest.mock('../../services/signature.service', () => ({ __esModule: true, default: {} }));

jest.mock('../../utils/sessionCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn(), get: jest.fn(), set: jest.fn() },
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: jest.fn((user: { _id?: { toString(): string }; username?: string }) => ({
    id: user?._id?.toString() ?? 'unknown',
    username: user?.username ?? 'unknown',
  })),
}));

jest.mock('../../utils/deviceUtils', () => ({
  getDeviceActiveSessions: jest.fn(),
  logoutAllDeviceSessions: jest.fn(),
}));

jest.mock('../../server', () => ({ emitSessionUpdate: jest.fn() }));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { Request, Response } from 'express';
import { SessionController } from '../session.controller';

function createMockRes(): Response {
  const res = {} as Partial<Response>;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
}

function createReq(body: Record<string, unknown>): Request {
  return { body, headers: {}, ip: '127.0.0.1' } as unknown as Request;
}

function makeQuery(value: unknown) {
  return { select: jest.fn().mockResolvedValue(value) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsLockedOut.mockResolvedValue({ locked: false, attempts: 0 });
  mockRecordFailure.mockResolvedValue({ locked: false, attempts: 1 });
});

describe('SessionController.signIn (H5)', () => {
  it('still calls verifyPassword when the user does not exist (constant-time)', async () => {
    mockUserFindOne.mockReturnValueOnce(makeQuery(null));
    mockVerifyPassword.mockResolvedValueOnce(false);

    const res = createMockRes();
    await SessionController.signIn(createReq({ identifier: 'ghost', password: 'whatever' }), res);

    expect(mockVerifyPassword).toHaveBeenCalledTimes(1);
    // The first arg is the supplied password; the second is the dummy hash.
    const args = mockVerifyPassword.mock.calls[0];
    expect(args[0]).toBe('whatever');
    expect(args[1]).toMatch(/^\$argon2id\$/);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
  });

  it('returns 401 (not 429) on a single bad password when not locked', async () => {
    mockUserFindOne.mockReturnValueOnce(
      makeQuery({ _id: 'u', password: 'real-hash', twoFactorAuth: { enabled: false } })
    );
    mockVerifyPassword.mockResolvedValueOnce(false);

    const res = createMockRes();
    await SessionController.signIn(createReq({ identifier: 'alice', password: 'wrong' }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
    expect(mockRecordFailure).toHaveBeenCalledWith({
      scope: 'login',
      identifier: 'alice',
    });
  });

  it('locks the account after the threshold and returns 429 + Retry-After', async () => {
    mockUserFindOne.mockReturnValueOnce(
      makeQuery({ _id: 'u', password: 'real-hash', twoFactorAuth: { enabled: false } })
    );
    mockVerifyPassword.mockResolvedValueOnce(false);
    mockRecordFailure.mockResolvedValueOnce({ locked: true, retryAfterSeconds: 900, attempts: 5 });

    const res = createMockRes();
    await SessionController.signIn(createReq({ identifier: 'alice', password: 'wrong' }), res);

    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '900');
    expect(res.status).toHaveBeenCalledWith(429);
    // CRITICAL: the response body MUST NOT reveal the lockout state to
    // unauthenticated callers — same message as plain wrong credentials.
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
  });

  it('does not pre-check lockout before credential verification', async () => {
    mockIsLockedOut.mockResolvedValueOnce({ locked: true, retryAfterSeconds: 300, attempts: 5 });
    mockUserFindOne.mockReturnValueOnce(makeQuery(null));
    mockVerifyPassword.mockResolvedValueOnce(false);

    const res = createMockRes();
    await SessionController.signIn(createReq({ identifier: 'alice', password: 'whatever' }), res);

    expect(mockIsLockedOut).not.toHaveBeenCalled();
    expect(mockUserFindOne).toHaveBeenCalled();
    expect(mockVerifyPassword).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid credentials' });
  });

  it('clears the lockout counter on a successful sign-in', async () => {
    const fakeSession = {
      sessionId: 's1',
      deviceId: 'd1',
      expiresAt: new Date(Date.now() + 60_000),
      accessToken: 'tok',
      deviceInfo: { deviceName: 'x', deviceType: 'desktop', platform: 'web' },
    };
    mockUserFindOne.mockReturnValueOnce(
      makeQuery({
        _id: { toString: () => 'user-1' },
        password: 'real-hash',
        username: 'alice',
        twoFactorAuth: { enabled: false },
      })
    );
    mockVerifyPassword.mockResolvedValueOnce(true);
    mockCreateSession.mockResolvedValueOnce(fakeSession);

    const res = createMockRes();
    await SessionController.signIn(createReq({ identifier: 'alice', password: 'right' }), res);

    expect(mockClearFailures).toHaveBeenCalledWith({ scope: 'login', identifier: 'alice' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', accessToken: 'tok' })
    );
  });
});

describe('SessionController.requestPasswordReset (H8)', () => {
  beforeEach(() => {
    delete process.env.OXY_DEV_RECOVERY_DEBUG;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    delete process.env.OXY_DEV_RECOVERY_DEBUG;
  });

  it('does NOT include devCode when OXY_DEV_RECOVERY_DEBUG is unset (even in dev)', async () => {
    process.env.NODE_ENV = 'development';
    mockUserFindOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'user-1', password: 'hash' }),
      }),
    });
    mockHashPassword.mockResolvedValueOnce('hashed-code');

    // RecoveryCode model is mocked, but the controller calls it for
    // updateMany / create. We provide just enough surface to no-op.
    const recoveryMock = jest.requireMock('../../models/RecoveryCode');
    recoveryMock.default.updateMany = jest.fn().mockResolvedValue({});
    recoveryMock.default.create = jest.fn().mockResolvedValue({});

    const res = createMockRes();
    await SessionController.requestPasswordReset(
      createReq({ identifier: 'alice' }),
      res
    );

    const responseBody = (res.json as jest.Mock).mock.calls[0][0];
    expect(responseBody.devCode).toBeUndefined();
  });

  it('includes devCode ONLY when OXY_DEV_RECOVERY_DEBUG is explicitly enabled', async () => {
    process.env.OXY_DEV_RECOVERY_DEBUG = 'true';
    mockUserFindOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'user-1', password: 'hash' }),
      }),
    });
    mockHashPassword.mockResolvedValueOnce('hashed-code');

    const recoveryMock = jest.requireMock('../../models/RecoveryCode');
    recoveryMock.default.updateMany = jest.fn().mockResolvedValue({});
    recoveryMock.default.create = jest.fn().mockResolvedValue({});

    const res = createMockRes();
    await SessionController.requestPasswordReset(
      createReq({ identifier: 'alice' }),
      res
    );

    const responseBody = (res.json as jest.Mock).mock.calls[0][0];
    expect(responseBody.devCode).toBe('CODE12345Z');
  });
});
