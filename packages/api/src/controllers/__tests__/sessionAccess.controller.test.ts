/**
 * Session controller authorization tests
 *
 * Regression coverage for C1 / H3: `/session/user/:sessionId` and
 * `/session/sessions/:sessionId` must require a valid bearer token AND verify
 * that the authenticated user owns the referenced session. Fresh access tokens
 * now come only from first-party refresh-cookie flows and explicit auth claims.
 *
 * Strategy: mock `session.service.validateSessionById` and
 * every ownership-mismatch branch without spinning up Mongo.
 */

const mockValidateSessionById = jest.fn();
const mockGetUserActiveSessions = jest.fn();

jest.mock('../../services/session.service', () => ({
  __esModule: true,
  default: {
    validateSessionById: mockValidateSessionById,
    getUserActiveSessions: mockGetUserActiveSessions,
  },
}));

jest.mock('../../services/anomalyDetection.service', () => ({
  __esModule: true,
  default: { checkForAnomalies: jest.fn() },
}));

jest.mock('../../services/securityActivityService', () => ({
  __esModule: true,
  default: {
    logSignIn: jest.fn(),
    logSignOut: jest.fn(),
    logAccountRecovery: jest.fn(),
  },
}));

jest.mock('../../services/loginLockout.service', () => ({
  isLockedOut: jest.fn().mockResolvedValue({ locked: false, attempts: 0 }),
  recordFailure: jest.fn().mockResolvedValue({ locked: false, attempts: 0 }),
  clearFailures: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/userTransform', () => ({
  formatUserResponse: jest.fn((user: { _id?: { toString(): string }; username?: string }) => ({
    id: user?._id?.toString() ?? 'unknown',
    username: user?.username ?? 'unknown',
  })),
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/sessionCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn(), get: jest.fn(), set: jest.fn() },
}));

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findOne: jest.fn(),
    findById: jest.fn(),
  },
}));

jest.mock('../../models/Session', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock('../../models/AuthChallenge', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../models/RecoveryCode', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../models/Notification', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../models/RefreshToken', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
}));
// The session controller transitively imports refreshToken.service, which pulls
// in oauthCode.service -> AuthCode model. Mock it so module evaluation does not
// touch the (mocked) Mongoose Schema.Types.
jest.mock('../../models/AuthCode', () => ({
  __esModule: true,
  AuthCode: { create: jest.fn() },
  default: { create: jest.fn() },
}));

jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../utils/deviceUtils', () => ({
  getDeviceActiveSessions: jest.fn(),
  logoutAllDeviceSessions: jest.fn(),
}));

jest.mock('../../server', () => ({
  emitSessionUpdate: jest.fn(),
}));

import { Request, Response } from 'express';
import { SessionController } from '../session.controller';
import type { AuthRequest } from '../../middleware/auth';

const SESSION_OWNER_ID = '64f7c2a1b8e9d3f4a1c2b3d4';
const ATTACKER_USER_ID = '74f7c2a1b8e9d3f4a1c2b3d5';
const TARGET_SESSION_ID = 'sess-victim';

function createMockRes(): Response {
  const res = {} as Partial<Response>;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
}

function authRequestAs(userId: string, sessionId = TARGET_SESSION_ID): AuthRequest {
  return {
    params: { sessionId },
    user: { _id: userId, id: userId },
    headers: {},
  } as unknown as AuthRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SessionController.getUserBySession (C1)', () => {
  it('returns 401 if the request was not authenticated', async () => {
    const req = { params: { sessionId: TARGET_SESSION_ID }, headers: {} } as unknown as AuthRequest;
    const res = createMockRes();

    await SessionController.getUserBySession(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockValidateSessionById).not.toHaveBeenCalled();
  });

  it('returns 404 (not 200) when the session is owned by a different user', async () => {
    mockValidateSessionById.mockResolvedValueOnce({
      session: { userId: SESSION_OWNER_ID, sessionId: TARGET_SESSION_ID },
      user: { _id: SESSION_OWNER_ID, username: 'victim' },
    });
    const req = authRequestAs(ATTACKER_USER_ID);
    const res = createMockRes();

    await SessionController.getUserBySession(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Session not found' });
  });

  it('returns the user when the authenticated user owns the session', async () => {
    mockValidateSessionById.mockResolvedValueOnce({
      session: { userId: SESSION_OWNER_ID, sessionId: TARGET_SESSION_ID },
      user: { _id: SESSION_OWNER_ID, username: 'me' },
    });
    const req = authRequestAs(SESSION_OWNER_ID);
    const res = createMockRes();

    await SessionController.getUserBySession(req, res);

    expect(res.json).toHaveBeenCalledWith({ id: SESSION_OWNER_ID, username: 'me' });
  });
});

describe('SessionController.getUserSessions (C1)', () => {
  it('does not enumerate sessions belonging to a different user', async () => {
    mockValidateSessionById.mockResolvedValueOnce({
      session: { userId: SESSION_OWNER_ID, sessionId: TARGET_SESSION_ID },
    });
    const req = authRequestAs(ATTACKER_USER_ID);
    const res = createMockRes();

    await SessionController.getUserSessions(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockGetUserActiveSessions).not.toHaveBeenCalled();
  });

  it('lists sessions for the authenticated owner', async () => {
    mockValidateSessionById.mockResolvedValueOnce({
      session: { userId: SESSION_OWNER_ID, sessionId: TARGET_SESSION_ID },
    });
    mockGetUserActiveSessions.mockResolvedValueOnce([
      {
        sessionId: TARGET_SESSION_ID,
        deviceId: 'dev-1',
        deviceInfo: { deviceName: 'iPhone' },
        isActive: true,
        userId: SESSION_OWNER_ID,
      },
    ]);
    const req = authRequestAs(SESSION_OWNER_ID);
    const res = createMockRes();

    await SessionController.getUserSessions(req, res);

    expect(mockGetUserActiveSessions).toHaveBeenCalledWith(SESSION_OWNER_ID);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: TARGET_SESSION_ID, deviceId: 'dev-1' }),
    ]);
  });
});

describe('SessionController.validateSession (deviceId chaining)', () => {
  it('includes deviceId in the response so the IdP can chain it into new sessions', async () => {
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    const lastActive = new Date('2026-07-01T00:00:00.000Z');
    mockValidateSessionById.mockResolvedValueOnce({
      session: {
        userId: SESSION_OWNER_ID,
        sessionId: TARGET_SESSION_ID,
        deviceId: 'dev-xyz',
        expiresAt,
        deviceInfo: { lastActive },
      },
      user: { _id: SESSION_OWNER_ID, username: 'me' },
    });
    const req = { params: { sessionId: TARGET_SESSION_ID }, header: jest.fn().mockReturnValue(undefined) } as unknown as Request;
    const res = createMockRes();

    await SessionController.validateSession(req, res);

    expect(res.json).toHaveBeenCalledWith({
      valid: true,
      expiresAt: expiresAt.toISOString(),
      lastActivity: lastActive.toISOString(),
      deviceId: 'dev-xyz',
      user: { id: SESSION_OWNER_ID, username: 'me' },
    });
  });
});

describe('SessionController.validateSessionFromHeader (deviceId chaining)', () => {
  it('includes deviceId in the response so the IdP can chain it into new sessions', async () => {
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    const lastActive = new Date('2026-07-01T00:00:00.000Z');
    mockValidateSessionById.mockResolvedValueOnce({
      session: {
        userId: SESSION_OWNER_ID,
        sessionId: TARGET_SESSION_ID,
        deviceId: 'dev-xyz',
        expiresAt,
        deviceInfo: { lastActive },
      },
      user: { _id: SESSION_OWNER_ID, username: 'me' },
    });
    const req = { params: { sessionId: TARGET_SESSION_ID }, header: jest.fn().mockReturnValue(undefined) } as unknown as Request;
    const res = createMockRes();

    await SessionController.validateSessionFromHeader(req, res);

    expect(res.json).toHaveBeenCalledWith({
      valid: true,
      expiresAt: expiresAt.toISOString(),
      lastActivity: lastActive.toISOString(),
      deviceId: 'dev-xyz',
      user: { id: SESSION_OWNER_ID, username: 'me' },
      sessionId: TARGET_SESSION_ID,
    });
  });
});
