/**
 * twoFactor.controller.verify2FALogin tests
 *
 * Regression coverage for the security-alert parity between the password login
 * path (`session.controller.signIn`) and the 2FA completion path: a successful
 * `POST /security/2fa/verify-login` MUST run anomaly detection and attach a
 * `securityAlert` to the session response when anomalies are detected — same
 * shape the password path emits.
 */

const mockUserFindById = jest.fn();
const mockVerifyToken = jest.fn();
const mockVerifyBackupCode = jest.fn();
const mockCreateSession = jest.fn();
const mockCheckForAnomalies = jest.fn();
const mockFinalizeDeviceLogin = jest.fn();
const mockBuildSessionAuthResponse = jest.fn();
const mockJwtVerify = jest.fn();
const mockIsLockedOut = jest.fn();
const mockRecordFailure = jest.fn();
const mockClearFailures = jest.fn();
const mockLogSignIn = jest.fn();

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: (...a: unknown[]) => mockJwtVerify(...a), sign: jest.fn() },
  verify: (...a: unknown[]) => mockJwtVerify(...a),
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: mockUserFindById },
  buildAuthMethod: jest.fn(),
}));

jest.mock('../../services/twoFactor.service', () => ({
  __esModule: true,
  default: {
    verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
    verifyBackupCode: (...a: unknown[]) => mockVerifyBackupCode(...a),
  },
}));

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: { createSession: (...a: unknown[]) => mockCreateSession(...a) },
}));

jest.mock('../../services/anomalyDetection.service', () => ({
  __esModule: true,
  default: { checkForAnomalies: (...a: unknown[]) => mockCheckForAnomalies(...a) },
}));

jest.mock('../../services/deviceLogin.service', () => ({
  finalizeDeviceLogin: (...a: unknown[]) => mockFinalizeDeviceLogin(...a),
}));

// `./session.controller` transitively imports the full model/service graph.
// Mock it so we only need its `buildSessionAuthResponse` export here.
jest.mock('../session.controller', () => ({
  __esModule: true,
  buildSessionAuthResponse: (...a: unknown[]) => mockBuildSessionAuthResponse(...a),
  sessionCreateOptionsFromBody: (body: {
    deviceName?: string;
    deviceFingerprint?: string;
    deviceId?: string;
  }) => ({
    deviceName: body.deviceName,
    deviceFingerprint: body.deviceFingerprint,
    ...(typeof body.deviceId === 'string' && body.deviceId.trim()
      ? { deviceId: body.deviceId.trim() }
      : {}),
  }),
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: { logSignIn: (...a: unknown[]) => mockLogSignIn(...a), logSecurityEvent: jest.fn() },
}));

jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: (...a: unknown[]) => mockIsLockedOut(...a),
  recordFailure: (...a: unknown[]) => mockRecordFailure(...a),
  clearFailures: (...a: unknown[]) => mockClearFailures(...a),
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

const FAKE_SESSION = {
  sessionId: 's1',
  deviceId: 'd1',
  expiresAt: new Date(Date.now() + 60_000),
  accessToken: 'tok',
  deviceInfo: { deviceName: 'x', deviceType: 'desktop', platform: 'web' },
};

function makeUser() {
  return {
    _id: { toString: () => 'user-1' },
    username: 'alice',
    twoFactorAuth: { enabled: true, secret: 'SECRET', backupCodes: [] },
    save: jest.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  mockJwtVerify.mockReturnValue({ userId: 'user-1', purpose: '2fa_challenge' });
  mockIsLockedOut.mockResolvedValue({ locked: false, attempts: 0 });
  mockRecordFailure.mockResolvedValue({ locked: false, attempts: 1 });
  mockClearFailures.mockResolvedValue(undefined);
  mockCreateSession.mockResolvedValue(FAKE_SESSION);
  mockFinalizeDeviceLogin.mockResolvedValue({ deviceSecret: 'ds1' });
  mockBuildSessionAuthResponse.mockReturnValue({
    sessionId: FAKE_SESSION.sessionId,
    deviceId: FAKE_SESSION.deviceId,
    expiresAt: FAKE_SESSION.expiresAt.toISOString(),
    accessToken: FAKE_SESSION.accessToken,
    user: { id: 'user-1', username: 'alice' },
  });
});

describe('verify2FALogin — anomaly detection parity', () => {
  it('attaches a securityAlert to the session response when anomalies are detected', async () => {
    mockUserFindById.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) });
    mockVerifyToken.mockReturnValue(true);
    mockCheckForAnomalies.mockResolvedValueOnce({
      hasAnomalies: true,
      anomalies: [{ type: 'new_device', reason: 'Login from new device' }],
    });

    const res = createMockRes();
    await verify2FALogin(createReq({ loginToken: 'lt', token: '123456' }), res);

    // Anomaly detection ran for the verified user, BEFORE the session was minted.
    expect(mockCheckForAnomalies).toHaveBeenCalledWith('user-1', expect.anything());
    const invocationOrder =
      mockCheckForAnomalies.mock.invocationCallOrder[0] < mockCreateSession.mock.invocationCallOrder[0];
    expect(invocationOrder).toBe(true);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.securityAlert).toEqual({
      message: 'Unusual activity detected on your account',
      anomalies: [{ type: 'new_device', reason: 'Login from new device' }],
    });
    expect(body.sessionId).toBe('s1');
    expect(body.deviceSecret).toBe('ds1');
  });

  it('omits securityAlert when no anomalies are detected (common case)', async () => {
    mockUserFindById.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) });
    mockVerifyToken.mockReturnValue(true);
    mockCheckForAnomalies.mockResolvedValueOnce({ hasAnomalies: false, anomalies: [] });

    const res = createMockRes();
    await verify2FALogin(createReq({ loginToken: 'lt', token: '123456' }), res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.securityAlert).toBeUndefined();
    expect(body.sessionId).toBe('s1');
  });

  it('does NOT run anomaly detection when the 2FA token is invalid', async () => {
    mockUserFindById.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(makeUser()) });
    mockVerifyToken.mockReturnValue(false);

    const res = createMockRes();
    await verify2FALogin(createReq({ loginToken: 'lt', token: '000000' }), res);

    expect(mockCheckForAnomalies).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
