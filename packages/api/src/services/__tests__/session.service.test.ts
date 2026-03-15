/**
 * Session Service Tests
 *
 * Tests for session creation, validation, and management
 */

const mockSave = jest.fn();
const mockUpdateOne = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindOneAndUpdate = jest.fn();

/**
 * Creates a chainable mock that supports .select().lean() and .lean() patterns.
 * Each call to mockFindOne pushes a resolved value; subsequent chained methods pass it through.
 */
const mockFindOneResults: unknown[] = [];
const mockFindOne = jest.fn().mockImplementation(() => {
  const value = mockFindOneResults.shift() ?? null;
  const chain = {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
    lean: jest.fn().mockResolvedValue(value),
    populate: jest.fn().mockResolvedValue(value),
  };
  return chain;
});

const mockFind = jest.fn();

jest.mock('../../models/Session', () => {
  const SessionConstructor = jest.fn().mockImplementation((data: Record<string, unknown>) => ({
    ...data,
    save: mockSave,
  }));
  Object.assign(SessionConstructor, {
    findOne: mockFindOne,
    find: mockFind,
    updateOne: mockUpdateOne,
    updateMany: mockUpdateMany,
    findOneAndUpdate: mockFindOneAndUpdate,
  });
  return { __esModule: true, default: SessionConstructor };
});

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'user-123', username: 'testuser' }),
      }),
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

jest.mock('../../utils/sessionCache', () => {
  const cache = new Map<string, unknown>();
  return {
    __esModule: true,
    default: {
      get: jest.fn((key: string) => cache.get(key) ?? null),
      set: jest.fn((key: string, value: unknown) => cache.set(key, value)),
      invalidate: jest.fn((key: string) => cache.delete(key)),
      invalidateUserSessions: jest.fn(),
      shouldUpdateLastActive: jest.fn().mockReturnValue(false),
      clearPendingLastActive: jest.fn(),
      _cache: cache,
    },
  };
});

jest.mock('../../utils/userCache', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockReturnValue(null),
    set: jest.fn(),
  },
}));

jest.mock('../../utils/sessionUtils', () => ({
  generateSessionTokens: jest.fn().mockReturnValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  }),
  validateAccessToken: jest.fn().mockReturnValue({
    valid: true,
    payload: { userId: 'user-123', sessionId: 'session-123', deviceId: 'device-123' },
  }),
  validateRefreshToken: jest.fn().mockReturnValue({
    valid: true,
    payload: { userId: 'user-123', sessionId: 'session-123', deviceId: 'device-123' },
  }),
}));

jest.mock('../../utils/deviceUtils', () => ({
  extractDeviceInfo: jest.fn().mockReturnValue({
    deviceId: 'device-123',
    deviceName: 'Test Device',
    deviceType: 'desktop',
    platform: 'web',
    browser: 'Chrome',
    os: 'Linux',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    location: undefined,
    fingerprint: undefined,
  }),
  generateDeviceFingerprint: jest.fn().mockReturnValue('fingerprint-hash'),
  registerDevice: jest.fn().mockImplementation((info: Record<string, unknown>) => Promise.resolve(info)),
}));

jest.mock('../securityActivityService', () => ({
  __esModule: true,
  default: {
    logDeviceAdded: jest.fn().mockResolvedValue(undefined),
  },
}));

import { describe, it, expect, beforeEach } from '@jest/globals';
import sessionService from '../session.service';
import Session from '../../models/Session';
import sessionCache from '../../utils/sessionCache';
import { validateAccessToken } from '../../utils/sessionUtils';
import { Request } from 'express';

function createMockSession(overrides: Record<string, unknown> = {}) {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    _id: 'mongo-id-123',
    sessionId: 'session-123',
    userId: 'user-123',
    deviceId: 'device-123',
    deviceInfo: {
      deviceName: 'Test Device',
      deviceType: 'desktop',
      platform: 'web',
      browser: 'Chrome',
      os: 'Linux',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      lastActive: new Date(),
    },
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    isActive: true,
    expiresAt: future,
    lastRefresh: new Date(),
    ...overrides,
  };
}

function createMockRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: { 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

describe('Session Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOneResults.length = 0;
    const cache = (sessionCache as unknown as { _cache: Map<string, unknown> })._cache;
    cache.clear();
  });

  describe('createSession', () => {
    it('should create a new session for valid user', async () => {
      const mockSession = createMockSession();
      mockFindOneResults.push(null); // no existing session on device (isNewDevice check)
      mockFindOneResults.push(null); // no active session to reuse
      mockSave.mockResolvedValueOnce(mockSession);

      const result = await sessionService.createSession('user-123', createMockRequest());

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.userId).toBe('user-123');
      expect(result.isActive).toBe(true);
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('should generate unique session ID', async () => {
      mockFindOneResults.push(null, null); // first call: isNewDevice + no active session
      mockFindOneResults.push(null, null); // second call: same
      mockSave.mockResolvedValue(undefined);

      const result1 = await sessionService.createSession('user-123', createMockRequest());
      const result2 = await sessionService.createSession('user-123', createMockRequest());

      expect(result1.sessionId).not.toBe(result2.sessionId);
    });

    it('should store device information', async () => {
      mockFindOneResults.push(null, null); // isNewDevice + no active session
      mockSave.mockResolvedValue(undefined);

      const result = await sessionService.createSession('user-123', createMockRequest());

      expect(result.deviceInfo).toBeDefined();
      expect(result.deviceInfo.deviceType).toBe('desktop');
      expect(result.deviceInfo.platform).toBe('web');
      expect(result.deviceInfo.browser).toBe('Chrome');
      expect(result.deviceInfo.ipAddress).toBe('127.0.0.1');
      expect(result.deviceId).toBe('device-123');
    });
  });

  describe('validateSession', () => {
    it('should validate active session', async () => {
      const mockSession = createMockSession();
      mockFindOneResults.push(mockSession);

      const result = await sessionService.validateSession('mock-access-token');

      expect(result).toBeDefined();
      expect(result!.session.sessionId).toBe('session-123');
      expect(result!.user).toBeDefined();
      expect(result!.payload).toBeDefined();
      expect(result!.payload.sessionId).toBe('session-123');
    });

    it('should reject expired session', async () => {
      (validateAccessToken as jest.Mock).mockReturnValueOnce({
        valid: false,
        error: 'expired',
      });

      const result = await sessionService.validateSession('expired-token');

      expect(result).toBeNull();
    });

    it('should reject invalidated session', async () => {
      (validateAccessToken as jest.Mock).mockReturnValueOnce({
        valid: true,
        payload: { userId: 'user-123', sessionId: 'inactive-session', deviceId: 'device-123' },
      });
      // Session not found (inactive or non-existent)
      mockFindOneResults.push(null);

      const result = await sessionService.validateSession('valid-token-but-inactive-session');

      expect(result).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('should revoke active session', async () => {
      mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      const result = await sessionService.deactivateSession('session-123');

      expect(result).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { sessionId: 'session-123', isActive: true },
        { $set: { isActive: false, updatedAt: expect.any(Date) } }
      );
      expect(sessionCache.invalidate).toHaveBeenCalledWith('session-123');
    });

    it('should prevent access with revoked session', async () => {
      // Deactivate the session
      mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });
      await sessionService.deactivateSession('session-123');

      // Attempt to validate — session lookup returns null (deactivated)
      (validateAccessToken as jest.Mock).mockReturnValueOnce({
        valid: true,
        payload: { userId: 'user-123', sessionId: 'session-123', deviceId: 'device-123' },
      });
      mockFindOneResults.push(null);

      const result = await sessionService.validateSession('mock-access-token');

      expect(result).toBeNull();
    });
  });
});
