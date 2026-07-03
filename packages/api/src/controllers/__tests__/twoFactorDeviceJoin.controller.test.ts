/**
 * verify2FALogin — central device join (priorSessionId)
 *
 * A 2FA-completed login must behave like the password sign-in path: when the
 * browser already has an account signed in (the IdP threads its active device
 * session as `priorSessionId`), the finalized session inherits that device's
 * central deviceId and the account is registered into the device authority.
 *
 * The real helper behavior (server-side sessionId re-validation + addAccount +
 * broadcast) is covered end-to-end by signIn.controller.test.ts. Here we mock
 * the shared helpers to assert `verify2FALogin` threads through them correctly.
 */

const mockJwtVerify = jest.fn();
const mockFindById = jest.fn();
const mockVerifyToken = jest.fn();
const mockCreateSession = jest.fn();
const mockResolvePriorDeviceId = jest.fn();
const mockJoinDeviceAfterSignIn = jest.fn();
const mockBuildSessionAuthResponse = jest.fn();
const mockIsLockedOut = jest.fn();
const mockRecordFailure = jest.fn();
const mockClearFailures = jest.fn();

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: mockJwtVerify, sign: jest.fn() },
  verify: mockJwtVerify,
  sign: jest.fn(),
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: mockFindById },
}));

jest.mock('../../services/twoFactor.service', () => ({
  __esModule: true,
  default: { verifyToken: mockVerifyToken, verifyBackupCode: jest.fn() },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: mockCreateSession },
}));

jest.mock('../session.controller', () => ({
  __esModule: true,
  buildSessionAuthResponse: mockBuildSessionAuthResponse,
  resolvePriorDeviceId: mockResolvePriorDeviceId,
  joinDeviceAfterSignIn: mockJoinDeviceAfterSignIn,
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: { logSignIn: jest.fn(), logSecurityEvent: jest.fn() },
}));

jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: mockIsLockedOut,
  recordFailure: mockRecordFailure,
  clearFailures: mockClearFailures,
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { Request, Response } from 'express';
import { verify2FALogin } from '../twoFactor.controller';

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

const finalizedSession = {
  sessionId: 'new-sess',
  deviceId: 'device-A',
  expiresAt: new Date(Date.now() + 60_000),
  accessToken: 'tok',
  deviceInfo: { deviceName: 'x', deviceType: 'desktop', platform: 'web' },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  mockJwtVerify.mockReturnValue({ userId: 'user-1', purpose: '2fa_challenge' });
  mockIsLockedOut.mockResolvedValue({ locked: false });
  mockClearFailures.mockResolvedValue(undefined);
  mockVerifyToken.mockReturnValue(true);
  mockFindById.mockReturnValue({
    select: jest.fn().mockResolvedValue({
      _id: { toString: () => 'user-1' },
      twoFactorAuth: { enabled: true, secret: 'totp-secret' },
      save: jest.fn().mockResolvedValue(undefined),
    }),
  });
  mockCreateSession.mockResolvedValue(finalizedSession);
  mockBuildSessionAuthResponse.mockReturnValue({ sessionId: 'new-sess', accessToken: 'tok' });
});

describe('verify2FALogin — central device join', () => {
  it('inherits the prior device and registers the account when priorSessionId resolves', async () => {
    mockResolvePriorDeviceId.mockResolvedValueOnce('device-A');

    const res = createMockRes();
    await verify2FALogin(
      createReq({ loginToken: 'lt', token: '123456', priorSessionId: 'prior-sess' }),
      res
    );

    expect(mockResolvePriorDeviceId).toHaveBeenCalledWith('prior-sess');
    expect(mockCreateSession).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.objectContaining({ deviceId: 'device-A' })
    );
    expect(mockJoinDeviceAfterSignIn).toHaveBeenCalledWith('device-A', 'user-1', 'new-sess');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'new-sess' })
    );
  });

  it('does not join the device when priorSessionId is absent/inactive', async () => {
    mockResolvePriorDeviceId.mockResolvedValueOnce(null);

    const res = createMockRes();
    await verify2FALogin(
      createReq({ loginToken: 'lt', token: '123456' }),
      res
    );

    const createOptions = mockCreateSession.mock.calls[0][2];
    expect(createOptions.deviceId).toBeUndefined();
    expect(mockJoinDeviceAfterSignIn).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'new-sess' })
    );
  });
});
