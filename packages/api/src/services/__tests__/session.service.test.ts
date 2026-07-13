/**
 * Session Service Tests
 *
 * Tests for session creation, validation, and management
 */

const mockSave = jest.fn();
const mockUpdateOne = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockDetachMigratedAccount = jest.fn();

/**
 * Creates a chainable mock that supports .select().lean() and .lean() patterns.
 * Each call to mockFindOne pushes a resolved value; subsequent chained methods pass it through.
 *
 * The returned value is ALSO a thenable so `await Session.findOne(...)` (the
 * refresh path, which awaits the query directly with no `.lean()`) resolves to
 * the queued doc, while `.select().lean()` / `.lean()` read chains keep working.
 * Mirrors session.service.managedSwitch.test.ts.
 */
const mockFindOneResults: unknown[] = [];
const mockFindOne = jest.fn().mockImplementation(() => {
  const value = mockFindOneResults.shift() ?? null;
  const p = Promise.resolve(value);
  return Object.assign(p, {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
    lean: jest.fn().mockResolvedValue(value),
    populate: jest.fn().mockResolvedValue(value),
  });
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

// The reused-session deviceId migration best-effort detaches the account from
// the OLD device doc via deviceSessionService — mock it to observe the call
// without touching the DeviceSession model.
jest.mock('../deviceSession.service', () => ({
  __esModule: true,
  default: {
    detachMigratedAccount: mockDetachMigratedAccount,
  },
}));

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import jwt from 'jsonwebtoken';
import sessionService from '../session.service';
import Session from '../../models/Session';
import sessionCache from '../../utils/sessionCache';
import { generateSessionTokens, validateAccessToken } from '../../utils/sessionUtils';
import { deriveServiceDeviceId } from '../../utils/deviceUtils';
import type { Request } from 'express';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

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
    mockDetachMigratedAccount.mockResolvedValue(undefined);
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

  /**
   * Explicit `deviceId` option (device unification plumbing).
   *
   * An explicit central deviceId (e.g. threaded from a FedCM id_token
   * `deviceId` claim) is used VERBATIM — bypassing both the UA/IP-derived
   * default and the `stableDeviceKey` derivation. Precedence: deviceId >
   * stableDeviceKey > UA/IP > random.
   */
  describe('createSession with an explicit deviceId (unification)', () => {
    const SAVED_SALT = process.env.DEVICE_ID_SALT;

    afterEach(() => {
      if (SAVED_SALT === undefined) {
        delete process.env.DEVICE_ID_SALT;
      } else {
        process.env.DEVICE_ID_SALT = SAVED_SALT;
      }
    });

    it('uses the explicit deviceId verbatim as the created session deviceId', async () => {
      mockFindOneResults.push(null); // isNewDevice check: none
      mockFindOneResults.push(null); // active-session reuse lookup: none
      mockSave.mockResolvedValueOnce(undefined);

      const result = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        deviceId: 'central-device-abc123',
      });

      expect(result.deviceId).toBe('central-device-abc123');
      const ctorArgs = (Session as unknown as jest.Mock).mock.calls[0][0] as { deviceId?: string };
      expect(ctorArgs.deviceId).toBe('central-device-abc123');
    });

    it('takes precedence over stableDeviceKey when both are supplied', async () => {
      process.env.DEVICE_ID_SALT = 'x'.repeat(48);
      mockFindOneResults.push(null); // isNewDevice check: none
      mockFindOneResults.push(null); // active-session reuse lookup: none
      mockSave.mockResolvedValueOnce(undefined);

      const result = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: 'https://relying.party.example',
        deviceId: 'central-device-wins',
      });

      // The explicit deviceId wins outright — it is NOT the 32-hex-char
      // derived stableDeviceKey id.
      expect(result.deviceId).toBe('central-device-wins');
      expect(result.deviceId).not.toMatch(/^[0-9a-f]{32}$/);
    });

    it('reuses the SAME session across repeated calls with the same explicit deviceId', async () => {
      mockFindOneResults.push(null); // isNewDevice check: none
      mockFindOneResults.push(null); // active-session reuse lookup: none
      mockSave.mockResolvedValueOnce(undefined);

      const first = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        deviceId: 'central-device-reuse',
      });

      mockFindOneResults.push({ _id: 'mongo-id-123' }); // isNewDevice check: device already seen
      mockFindOneResults.push(
        createMockSession({ sessionId: first.sessionId, deviceId: 'central-device-reuse' })
      );
      const refreshed = createMockSession({
        sessionId: first.sessionId,
        deviceId: 'central-device-reuse',
        accessToken: 'refreshed-access-token',
      });
      mockFindOneAndUpdate.mockResolvedValueOnce(refreshed);

      const second = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        deviceId: 'central-device-reuse',
      });

      expect(second.sessionId).toBe(first.sessionId);
      expect(second.accessToken).toBe('refreshed-access-token');
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Reused-session deviceId migration.
   *
   * When a caller supplies an explicit central deviceId (e.g. the FedCM/SSO
   * exchange threading a real device from the id_token) but the reused session
   * sits on a DIFFERENT legacy per-origin device, the session must HOP onto the
   * caller's device: its stored deviceId is updated, the re-minted access token
   * carries the new deviceId, and the account is detached from the old device
   * doc so the graveyard doc stops advertising a live-looking account. No hop
   * when no explicit deviceId is given, or when it already matches.
   */
  describe('createSession deviceId migration on reuse', () => {
    const SAVED_SALT = process.env.DEVICE_ID_SALT;
    const RP = 'https://console.oxy.so';
    const CENTRAL = 'central-device-real';

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

    it('migrates a reused legacy per-origin session onto the caller central device', async () => {
      const originDeviceId = deriveServiceDeviceId('user-123', RP);
      expect(originDeviceId).not.toBe(CENTRAL);

      // isNewDevice check (keyed on the central target) → none.
      mockFindOneResults.push(null);
      // PRIMARY reuse lookup (central target) → none: nothing on the real device yet.
      mockFindOneResults.push(null);
      // SECONDARY legacy lookup (origin-derived device) → HIT: the pre-unification session.
      mockFindOneResults.push(
        createMockSession({ sessionId: 'legacy-sess', deviceId: originDeviceId })
      );
      const migrated = createMockSession({
        sessionId: 'legacy-sess',
        deviceId: CENTRAL,
        accessToken: 'migrated-access-token',
      });
      mockFindOneAndUpdate.mockResolvedValueOnce(migrated);

      const result = await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: RP,
        deviceId: CENTRAL,
      });

      // Same session row reused (no new row minted), now on the central device.
      expect(mockSave).not.toHaveBeenCalled();
      expect(result.sessionId).toBe('legacy-sess');
      expect(result.deviceId).toBe(CENTRAL);

      // The reuse update $set migrated the stored deviceId to the central id.
      const updateArg = mockFindOneAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
      expect(updateArg.$set.deviceId).toBe(CENTRAL);

      // The re-minted JWT embeds the NEW deviceId (3rd generateSessionTokens arg).
      const tokenCalls = (generateSessionTokens as jest.Mock).mock.calls;
      expect(tokenCalls[tokenCalls.length - 1][2]).toBe(CENTRAL);

      // The old device doc's entry for this account is detached; the migrated
      // session id is preserved (never deactivated).
      expect(mockDetachMigratedAccount).toHaveBeenCalledWith(originDeviceId, 'user-123', 'legacy-sess');
    });

    it('does NOT migrate on reuse when no explicit deviceId is supplied', async () => {
      // Pure stableDeviceKey path: the reuse lookup keys on the origin-derived
      // device and any UA/IP mismatch must NOT move the session.
      mockFindOneResults.push({ _id: 'mongo-id-123' }); // isNewDevice: seen
      mockFindOneResults.push(
        createMockSession({ sessionId: 'sess-x', deviceId: 'device-old' })
      ); // PRIMARY reuse lookup: HIT
      mockFindOneAndUpdate.mockResolvedValueOnce(
        createMockSession({ sessionId: 'sess-x', deviceId: 'device-old' })
      );

      await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: RP,
      });

      const updateArg = mockFindOneAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
      expect(updateArg.$set.deviceId).toBeUndefined();
      expect(mockDetachMigratedAccount).not.toHaveBeenCalled();
    });

    it('performs NO migration side-effects when the explicit deviceId already matches', async () => {
      mockFindOneResults.push({ _id: 'mongo-id-123' }); // isNewDevice: seen
      mockFindOneResults.push(
        createMockSession({ sessionId: 'sess-y', deviceId: CENTRAL })
      ); // PRIMARY reuse lookup: HIT, already on the central device
      mockFindOneAndUpdate.mockResolvedValueOnce(
        createMockSession({ sessionId: 'sess-y', deviceId: CENTRAL })
      );

      await sessionService.createSession('user-123', createMockRequest(), {
        deviceName: 'FedCM Sign-In',
        deviceId: CENTRAL,
      });

      const updateArg = mockFindOneAndUpdate.mock.calls[0][1] as { $set: Record<string, unknown> };
      expect(updateArg.$set.deviceId).toBeUndefined();
      expect(mockDetachMigratedAccount).not.toHaveBeenCalled();
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

  /**
   * Sliding (idle) session lifetime.
   *
   * `Session.expiresAt` must be an IDLE timeout, not a hard absolute cap: any
   * successful USE of the session (a device-token mint or a refresh rotation)
   * pushes the 7-day window forward, so a continuously-used device-first session
   * never dies. A truly idle session (no mint/refresh for 7 days) still expires.
   *
   * Two chokepoints slide the window, without ever double-writing:
   *   - getAccessToken's still-valid branch — the mint path when NO rotation
   *     happens (the stored 15-min access token is still valid).
   *   - refreshTokens — every token rotation (direct refresh + the mint path
   *     when the stored access token has expired).
   */
  describe('sliding session window on use (getAccessToken mint path)', () => {
    const SAVED_SECRET = process.env.ACCESS_TOKEN_SECRET;
    const ACCESS_SECRET = 'test-access-secret';

    beforeEach(() => {
      process.env.ACCESS_TOKEN_SECRET = ACCESS_SECRET;
    });

    afterEach(() => {
      if (SAVED_SECRET === undefined) {
        delete process.env.ACCESS_TOKEN_SECRET;
      } else {
        process.env.ACCESS_TOKEN_SECRET = SAVED_SECRET;
      }
    });

    it('slides expiresAt forward when a still-valid session is used to mint (no rotation) and stays mintable', async () => {
      // A live access token (exp ~15m in the future) → getAccessToken returns it
      // WITHOUT rotating, but must still push the session window forward.
      const validAccessToken = jwt.sign(
        { userId: 'user-123', sessionId: 'session-123' },
        ACCESS_SECRET,
        { expiresIn: '15m' }
      );
      // Session is on the verge of expiry (still live — findOne returns it).
      const nearExpiry = new Date(Date.now() + 60_000);
      mockFindOneResults.push(
        createMockSession({ accessToken: validAccessToken, expiresAt: nearExpiry })
      );
      mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      const before = Date.now();
      const result = await sessionService.getAccessToken('session-123');

      expect(result).not.toBeNull();
      // Same (still-valid) token handed back — the session remains mintable.
      expect(result!.accessToken).toBe(validAccessToken);
      // The window slid ~7 days forward, well past the near-expiry it had.
      expect(result!.expiresAt.getTime()).toBeGreaterThan(before + SIX_DAYS_MS);
      expect(result!.expiresAt.getTime()).toBeGreaterThan(nearExpiry.getTime());
      // The slide was persisted with the idle-renewal filter (never a rotation).
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { sessionId: 'session-123', isActive: true },
        { $set: { expiresAt: expect.any(Date), updatedAt: expect.any(Date) } }
      );
      const persisted = (mockUpdateOne.mock.calls[0][1] as { $set: { expiresAt: Date } }).$set.expiresAt;
      expect(persisted.getTime()).toBeGreaterThan(before + SIX_DAYS_MS);
    });

    it('does NOT renew (no slide) and mints nothing for an idle-expired/absent session', async () => {
      // An idle session past 7 days is excluded by getSession's
      // `expiresAt: { $gt: now }` filter (and TTL-deleted), so findOne returns
      // null: nothing is minted and the window is never renewed without use.
      mockFindOneResults.push(null);

      const result = await sessionService.getAccessToken('session-123');

      expect(result).toBeNull();
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('still returns the valid token if persisting the slide fails (best-effort renewal)', async () => {
      const validAccessToken = jwt.sign(
        { userId: 'user-123', sessionId: 'session-123' },
        ACCESS_SECRET,
        { expiresIn: '15m' }
      );
      mockFindOneResults.push(createMockSession({ accessToken: validAccessToken }));
      mockUpdateOne.mockRejectedValueOnce(new Error('transient write failure'));

      const result = await sessionService.getAccessToken('session-123');

      // A transient slide-write failure must not break an otherwise-valid mint.
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe(validAccessToken);
    });
  });

  describe('sliding session window on use (refreshTokens rotation path)', () => {
    it('slides expiresAt forward on a successful rotation', async () => {
      const nearExpiry = new Date(Date.now() + 60_000);
      const save = jest.fn().mockResolvedValue(undefined);
      // refreshTokens awaits `Session.findOne(...)` directly (no `.lean()`), so
      // the queued value is a mongoose-like doc carrying `.save()`.
      const sessionDoc = {
        sessionId: 'session-123',
        userId: { toString: () => 'user-123' },
        deviceId: 'device-123',
        accessToken: 'old-access-token',
        refreshToken: 'mock-refresh-token',
        deviceInfo: { lastActive: new Date() },
        isActive: true,
        expiresAt: nearExpiry,
        save,
      };
      mockFindOneResults.push(sessionDoc);

      const before = Date.now();
      const result = await sessionService.refreshTokens('mock-refresh-token');

      expect(result).not.toBeNull();
      expect(save).toHaveBeenCalledTimes(1);
      // The rotation slid the window ~7 days forward, past the near-expiry.
      expect(sessionDoc.expiresAt.getTime()).toBeGreaterThan(before + SIX_DAYS_MS);
      expect(sessionDoc.expiresAt.getTime()).toBeGreaterThan(nearExpiry.getTime());
      expect(result!.session.expiresAt.getTime()).toBeGreaterThan(before + SIX_DAYS_MS);
      // Sanity: the slide never exceeds a full 7-day renewal from now.
      expect(sessionDoc.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS);
    });
  });
});
