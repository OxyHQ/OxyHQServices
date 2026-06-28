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
  // Echo an explicitly-provided deviceId (the stableDeviceKey path feeds the
  // derived id in as `providedDeviceId`). Falls back to the fixed default when
  // no id is provided.
  extractDeviceInfo: jest
    .fn()
    .mockImplementation((_req: unknown, providedDeviceId?: string) => ({
      deviceId: providedDeviceId ?? 'device-123',
      deviceName: 'Test Device',
      deviceType: 'desktop',
      platform: 'web',
      browser: 'Chrome',
      os: 'Linux',
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      location: undefined,
      fingerprint: undefined,
    })),
  generateDeviceFingerprint: jest.fn().mockReturnValue('fingerprint-hash'),
  registerDevice: jest.fn().mockImplementation((info: Record<string, unknown>) => Promise.resolve(info)),
  // Use the REAL derivation so per-RP / per-user scoping is exercised end-to-end.
  deriveServiceDeviceId: jest.requireActual('../../utils/deviceUtils').deriveServiceDeviceId,
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

  /**
   * IdP/FedCM-issued sessions (stableDeviceKey path).
   *
   * Proves the production bug fix: a given (userId, clientOrigin) reuses ONE
   * session that refreshes its tokens/expiry, instead of minting a brand-new
   * "FedCM Sign-In" session on every exchange. Two DIFFERENT clientOrigins
   * derive two DIFFERENT deviceIds → two DIFFERENT sessions.
   */
  describe('createSession with stableDeviceKey (FedCM/IdP path)', () => {
    const SAVED_SALT = process.env.DEVICE_ID_SALT;
    const RP_A = 'https://relying.party.example';
    const RP_B = 'https://other.party.example';

    beforeEach(() => {
      process.env.DEVICE_ID_SALT = 'x'.repeat(48);
    });

    afterEach(() => {
      if (SAVED_SALT === undefined) {
        delete process.env.DEVICE_ID_SALT;
      } else {
        process.env.DEVICE_ID_SALT = SAVED_SALT;
      }
    });

    it('reuses the SAME session for repeated exchanges of the same (user, clientOrigin)', async () => {
      // First exchange: no existing device session → creates a brand-new one.
      // (The new-session path returns the constructed doc whose sessionId is a
      // freshly generated UUID, so we read it back rather than asserting it.)
      mockFindOneResults.push(null); // isNewDevice check: none
      mockFindOneResults.push(null); // active-session reuse lookup: none
      mockSave.mockResolvedValueOnce(undefined);

      const first = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: RP_A,
      });

      const firstSessionId = first.sessionId;
      expect(firstSessionId).toEqual(expect.any(String));
      // The deviceId persisted on the new session is the derived stable id, NOT
      // the IdP worker's random UA/IP id.
      const newDeviceId = (Session as unknown as jest.Mock).mock.calls[0][0].deviceId;
      expect(newDeviceId).toMatch(/^[0-9a-f]{32}$/);

      // Second exchange for the SAME (user, RP): the reuse lookup now finds the
      // existing session, and createSession refreshes its tokens/expiry rather
      // than minting a new row. The refresh branch returns the findOneAndUpdate
      // result, so its sessionId is what the caller receives.
      mockFindOneResults.push({ _id: 'mongo-id-123' }); // isNewDevice check: device already seen
      mockFindOneResults.push(
        createMockSession({ sessionId: firstSessionId }) // active-session reuse lookup: HIT
      );
      const refreshed = createMockSession({
        sessionId: firstSessionId,
        accessToken: 'refreshed-access-token',
      });
      mockFindOneAndUpdate.mockResolvedValueOnce(refreshed);

      const second = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: RP_A,
      });

      // SAME session id reused; the refresh path (findOneAndUpdate) ran exactly
      // once; save was called only ONCE total (the first, new-session call) —
      // no second row was minted.
      expect(second.sessionId).toBe(firstSessionId);
      expect(second.accessToken).toBe('refreshed-access-token');
      expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'mongo-id-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            previousAccessToken: 'mock-access-token',
            previousRefreshToken: 'mock-refresh-token',
            tokenRotatedAt: expect.any(Date),
          }),
        }),
        { new: true }
      );
      expect(mockSave).toHaveBeenCalledTimes(1);

      // Both exchanges keyed the reuse lookup on the SAME derived deviceId
      // (deterministic from userId + RP_A) — that's why the second call hit
      // the existing-session branch. Every Session.findOne reuse filter carries
      // that one deviceId.
      const reuseDeviceIds = (Session as unknown as jest.Mock).findOne.mock.calls
        .map((call: unknown[]) => (call[0] as { deviceId?: string })?.deviceId)
        .filter((d: string | undefined): d is string => typeof d === 'string');
      const uniqueDeviceIds = Array.from(new Set(reuseDeviceIds));
      expect(uniqueDeviceIds).toHaveLength(1);
      expect(uniqueDeviceIds[0]).toBe(newDeviceId);
    });

    it('creates DIFFERENT sessions for two DIFFERENT clientOrigins (per-RP deviceId)', async () => {
      // Exchange for RP_A → new session A.
      const sessA = createMockSession({ sessionId: 'fedcm-sess-A', deviceId: 'will-be-overwritten' });
      mockFindOneResults.push(null); // isNewDevice
      mockFindOneResults.push(null); // reuse lookup: none
      mockSave.mockResolvedValueOnce(sessA);

      await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: RP_A,
      });

      // Capture the deviceId used for RP_A from the Session constructor call.
      const ctorCallsAfterA = (Session as unknown as jest.Mock).mock.calls.length;
      const deviceIdA = (Session as unknown as jest.Mock).mock.calls[ctorCallsAfterA - 1][0].deviceId;

      // Exchange for RP_B → because the derived deviceId differs, the reuse
      // lookup misses and a new session is created.
      const sessB = createMockSession({ sessionId: 'fedcm-sess-B' });
      mockFindOneResults.push(null); // isNewDevice
      mockFindOneResults.push(null); // reuse lookup: none (different deviceId)
      mockSave.mockResolvedValueOnce(sessB);

      await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: RP_B,
      });

      const ctorCallsAfterB = (Session as unknown as jest.Mock).mock.calls.length;
      const deviceIdB = (Session as unknown as jest.Mock).mock.calls[ctorCallsAfterB - 1][0].deviceId;

      // Two distinct RPs → two distinct derived deviceIds → two distinct sessions.
      expect(deviceIdA).toMatch(/^[0-9a-f]{32}$/);
      expect(deviceIdB).toMatch(/^[0-9a-f]{32}$/);
      expect(deviceIdA).not.toBe(deviceIdB);
      expect(mockSave).toHaveBeenCalledTimes(2);
      expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
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

    it('should accept recently rotated previous access token within grace window', async () => {
      const mockSession = createMockSession({
        accessToken: 'new-access-token',
        previousAccessToken: 'old-access-token',
        tokenRotatedAt: new Date(),
      });
      mockFindOneResults.push(mockSession);

      const result = await sessionService.validateSession('old-access-token');

      expect(result).toBeDefined();
      expect(result!.session.sessionId).toBe('session-123');
    });

    it('should reject rotated-out access token after grace window', async () => {
      const mockSession = createMockSession({
        accessToken: 'new-access-token',
        previousAccessToken: 'old-access-token',
        tokenRotatedAt: new Date(Date.now() - 31_000),
      });
      mockFindOneResults.push(mockSession);

      const result = await sessionService.validateSession('old-access-token');

      expect(result).toBeNull();
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
