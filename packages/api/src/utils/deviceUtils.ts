import crypto from 'crypto';
import type { Request } from 'express';
import Session from '../models/Session';
import { logger } from './logger';
import { formatUserResponse } from './userTransform';
import sessionCache from './sessionCache';

export interface DeviceFingerprint {
  userAgent: string;
  platform: string;
  language?: string;
  timezone?: string;
  screen?: {
    width: number;
    height: number;
    colorDepth: number;
  };
  ipAddress: string;
}

export type DeviceFingerprintInput = DeviceFingerprint | string;

const CLIENT_FINGERPRINT_HEX_RE = /^[a-f0-9]{64}$/i;

export interface DeviceInfo {
  deviceId: string;
  deviceName?: string;
  deviceType: string;
  platform: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  fingerprint?: string;
  /**
   * How `deviceId` was sourced. Diagnostic only — never persisted on the
   * Session document. Useful when debugging multi-account device grouping.
   */
  deviceIdSource?: 'provided' | 'fingerprint-derived' | 'random';
}

const UNRESOLVABLE_IPS: ReadonlySet<string> = new Set(['unknown', '127.0.0.1', '::1']);

const PRE_AUTH_USER_SCOPE = 'pre-auth';

/**
 * Resolve the server-side device-id salt at call time.
 *
 * Read at call time (not module load) so tests and runtime config reloads
 * pick up `process.env.DEVICE_ID_SALT` changes without re-importing. The
 * env layer (`validateRequiredEnvVars`) is responsible for enforcing that
 * a salt is set in production and meets the minimum length; this function
 * MUST refuse to derive an id without a salt rather than fall back to an
 * empty string (which would silently weaken the hash to the legacy
 * pre-salt form across two users behind the same NAT).
 */
function getDeviceIdSalt(): string | null {
  const salt = process.env.DEVICE_ID_SALT;
  if (!salt || salt.length === 0) {
    return null;
  }
  return salt;
}

/**
 * Derive a stable, non-PII deviceId from a request's User-Agent + IP +
 * Accept-Language, scoped by a server-side salt and (optionally) the
 * authenticated `userId`. The output is the first 32 hex chars of
 * `sha256("${salt}|${userScope}|${ua}|${ip}|${lang}")`, which gives roughly
 * 128 bits of entropy in the digest space.
 *
 * **Why salt + userId?** Without them, two distinct users behind the same
 * NAT/proxy/office using the same Chrome version + Accept-Language would
 * derive the SAME deviceId — leaking the existence of one user's sessions
 * to the other via `getDeviceActiveSessions`, and enabling cross-tenant
 * session termination via `logoutAllDeviceSessions`. Scoping by `userId`
 * makes the device-grouping per-user (the multi-account browser-switcher
 * is driven separately by indexed refresh cookies, not by this id).
 *
 * Pre-auth callers (e.g. signup, before the user record exists) MAY pass
 * `userId = null`; the resulting id is stable for the pre-auth phase but
 * deterministically distinct from any post-auth id derived from the same
 * UA/IP/lang.
 *
 * Falls back to `null` when:
 *   - the server-side salt is unset (caller should fall back to a random id);
 *   - the User-Agent is missing or the literal string `'unknown'`;
 *   - the IP is missing or one of the unresolvable sentinels
 *     (`'unknown'`, `'127.0.0.1'`, `'::1'`) — those would deterministically
 *     collide across totally unrelated requests.
 */
export function deriveStableDeviceId(
  userAgent: string,
  ip: string | undefined,
  acceptLanguage: string,
  userId?: string | null
): string | null {
  if (!userAgent || userAgent === 'unknown') {
    return null;
  }
  if (!ip || UNRESOLVABLE_IPS.has(ip)) {
    return null;
  }
  const salt = getDeviceIdSalt();
  if (!salt) {
    return null;
  }
  const userScope = userId && userId.length > 0 ? userId : PRE_AUTH_USER_SCOPE;
  return crypto
    .createHash('sha256')
    .update(`${salt}|${userScope}|${userAgent}|${ip}|${acceptLanguage}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Derive a stable, non-PII deviceId for a session minted server-to-server on
 * behalf of a caller with no stable client identity of its own, keyed by
 * `(userId, key)` instead of the request's UA/IP. The output is the first 32
 * hex chars of `sha256("${salt}|${userId}|idp|${key}")`. The `idp` hash
 * segment is FIXED cryptographic derivation material for server-minted sessions.
 *
 * **Why a separate helper?** A server-to-server mint has no meaningful
 * User-Agent (`'unknown'`) and a per-call egress IP. Feeding those into
 * `deriveStableDeviceId` would yield a fresh random id every call → a
 * brand-new session row each time. Keying off a stable per-caller key (`key`)
 * instead makes one `(user, RP)` reuse a single session that simply refreshes
 * its tokens/expiry.
 *
 * **Why the `'idp'` namespace segment?** It guarantees the output can never
 * collide with an IP/UA-derived id from `deriveStableDeviceId` (whose hash
 * input never contains the literal `idp` in that position), so the two
 * device-id spaces stay disjoint.
 *
 * **Per-user scoping is MANDATORY (security review H1):** `userId` is mixed
 * into the hash so two users with the same RP `key` can never derive the same
 * deviceId, which would otherwise leak/terminate one user's session via the
 * other.
 *
 * **Fail-closed on missing salt:** production ALWAYS has `DEVICE_ID_SALT` set
 * (`validateRequiredEnvVars` enforces it). Unlike `deriveStableDeviceId`
 * (which falls back to a random id when the salt is unset), this path MUST NOT
 * silently sprawl a new session per call, so it THROWS instead of returning a
 * weak/unsalted id.
 *
 * @param userId - Authenticated user id. Required for per-user scoping.
 * @param key - Stable per-RP key (e.g. the RP client origin / token audience).
 * @throws Error when `DEVICE_ID_SALT` is unset (fail-closed).
 */
export function deriveServiceDeviceId(userId: string, key: string): string {
  const salt = getDeviceIdSalt();
  if (!salt) {
    throw new Error(
      'deriveServiceDeviceId: DEVICE_ID_SALT is not set. ' +
        'Refusing to derive an unsalted IdP device id (would sprawl one session per request).'
    );
  }
  return crypto
    .createHash('sha256')
    .update(`${salt}|${userId}|idp|${key}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Generate a device fingerprint for device identification
 * This helps identify if it's the same physical device
 */
export const generateDeviceFingerprint = (fingerprint: DeviceFingerprintInput): string => {
  if (typeof fingerprint === 'string') {
    const clientFingerprint = fingerprint.trim();
    if (CLIENT_FINGERPRINT_HEX_RE.test(clientFingerprint)) {
      return clientFingerprint.toLowerCase();
    }

    return crypto.createHash('sha256').update(clientFingerprint).digest('hex');
  }

  const fingerprintString = [
    fingerprint.userAgent,
    fingerprint.platform,
    fingerprint.language,
    fingerprint.timezone,
    fingerprint.screen ? `${fingerprint.screen.width}x${fingerprint.screen.height}x${fingerprint.screen.colorDepth}` : '',
    // Don't include IP in fingerprint as it can change
  ].filter(Boolean).join('|');
  
  return crypto.createHash('sha256').update(fingerprintString).digest('hex');
};

/**
 * Extract device information from request.
 *
 * @param req - Express request to read headers/IP from.
 * @param providedDeviceId - Optional explicit deviceId supplied by the client.
 * @param deviceName - Optional explicit device name supplied by the client.
 * @param userId - Optional authenticated user id. When set, the derived
 *   deviceId is scoped to this user so two distinct users behind the same
 *   NAT/proxy on the same browser do NOT collide on the same id. Pre-auth
 *   callers (signup, device bootstrap before a session exists) should pass
 *   `null` / omit.
 */
export const extractDeviceInfo = (
  req: Request,
  providedDeviceId?: string,
  deviceName?: string,
  userId?: string | null
): DeviceInfo => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const platformHeader = req.headers['sec-ch-ua-platform'];
  const platform = (typeof platformHeader === 'string' ? platformHeader.replace(/"/g, '') : 'unknown');

  // Parse user agent for browser and OS info
  const browser = parseUserAgentBrowser(userAgent);
  const os = parseUserAgentOS(userAgent);
  const deviceType = parseDeviceType(userAgent);

  const ipAddress = req.ip || req.connection.remoteAddress;
  const acceptLanguageHeader = req.headers['accept-language'];
  const acceptLanguage = typeof acceptLanguageHeader === 'string' ? acceptLanguageHeader : '';

  // Stable deviceId fallback. The derived id is salted + user-scoped (see
  // `deriveStableDeviceId`) so device-grouping is per-user; the multi-account
  // browser switcher is driven by indexed refresh cookies, not by this id.
  // We fall back to a random id when ANY of the inputs is unresolvable.
  let resolvedDeviceId = providedDeviceId;
  let deviceIdSource: DeviceInfo['deviceIdSource'] = providedDeviceId ? 'provided' : 'random';
  if (!resolvedDeviceId) {
    const derived = deriveStableDeviceId(userAgent, ipAddress, acceptLanguage, userId);
    if (derived) {
      resolvedDeviceId = derived;
      deviceIdSource = 'fingerprint-derived';
    } else {
      resolvedDeviceId = generateDeviceId();
      deviceIdSource = 'random';
    }
  }

  return {
    deviceId: resolvedDeviceId,
    deviceName: deviceName || generateDefaultDeviceName(browser, os),
    deviceType,
    platform,
    browser,
    os,
    ipAddress,
    userAgent,
    location: req.headers['cf-ipcountry'] as string || undefined, // Cloudflare country header
    deviceIdSource,
  };
};

/**
 * Generate a device ID
 */
export const generateDeviceId = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Generate a default device name based on browser and OS
 */
export const generateDefaultDeviceName = (browser?: string, os?: string): string => {
  const browserName = browser || 'Browser';
  const osName = os || 'Unknown OS';
  return `${browserName} on ${osName}`;
};

/**
 * Find existing device ID for a device fingerprint
 * This helps reuse device IDs for the same physical device
 */
export const findExistingDeviceId = async (fingerprint: string, userId?: string): Promise<string | null> => {
  if (!fingerprint) return null;

  try {
    const query: Record<string, unknown> = {
      'deviceInfo.fingerprint': fingerprint,
      isActive: true,
      expiresAt: { $gt: new Date() }
    };
    
    if (userId) {
      query.userId = userId;
    }
    
    const session = await Session.findOne(query)
      .sort({ 'deviceInfo.lastActive': -1 })
      .select('deviceId')
      .lean()
      .limit(1)
      .exec();
    
    return session?.deviceId || null;
  } catch (error) {
    logger.error('[DeviceUtils] Error finding existing device ID', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
};

/**
 * Register or update device information
 * @param deviceInfo - Device information to register
 * @param fingerprint - Optional device fingerprint for device reuse
 * @param userId - Optional user ID to optimize device lookup queries
 */
export const registerDevice = async (
  deviceInfo: DeviceInfo, 
  fingerprint?: string,
  userId?: string
): Promise<DeviceInfo> => {
  try {
    // If fingerprint provided, try to find existing device ID
    // Pass userId to optimize query - reduces Session collection scan
    if (fingerprint) {
      const existingDeviceId = await findExistingDeviceId(fingerprint, userId);
      if (existingDeviceId) {
        deviceInfo.deviceId = existingDeviceId;
      }
      deviceInfo.fingerprint = fingerprint;
    }
    
    logger.info(`[DeviceUtils] Registered device: ${deviceInfo.deviceId} (${deviceInfo.deviceName})`);
    return deviceInfo;
  } catch (error) {
    logger.error('[DeviceUtils] Error registering device:', error);
    return deviceInfo;
  }
};

/** One deduplicated device session row returned by {@link getDeviceActiveSessions}. */
interface DeviceSessionEntry {
  sessionId: string;
  user: ReturnType<typeof formatUserResponse>;
  lastActive: string | Date;
  createdAt: Date;
  deviceId: string;
  expiresAt: Date;
  isCurrent: boolean;
}

/**
 * Get all active sessions for a specific device
 * Deduplicates by userId - returns only one session per user (most recent)
 * Marks current session with isCurrent flag
 */
export const getDeviceActiveSessions = async (deviceId: string, currentSessionId?: string) => {
  try {
    const now = new Date();
    // Use lean() for better performance - returns plain JS objects instead of Mongoose documents
    // Query optimized to use compound index: { deviceId: 1, isActive: 1, expiresAt: 1 }
    const sessions = await Session.find({
      deviceId,
      isActive: true,
      expiresAt: { $gt: now }
    })
    .populate('userId', 'username email avatar name color')
    .lean()
    .sort({ 
      'deviceInfo.lastActive': -1, // Most recent first
      'sessionId': 1 // Secondary sort by sessionId for stability
    })
    .limit(50) // Limit results to prevent excessive data transfer
    .exec();

    // Map sessions and deduplicate by userId - keep only most recent session per user
    const userSessionMap = new Map<string, DeviceSessionEntry>();
    
    for (const session of sessions) {
      const user: unknown = session.userId;
      if (!user || typeof user !== 'object') continue;

      const formattedUser = formatUserResponse(user);
      if (!formattedUser?.id) continue;

      const userId = formattedUser.id;

      // If we already have a session for this user, keep the one with more recent lastActive
      const existing = userSessionMap.get(userId);
      if (existing) {
        const existingTime = new Date(existing.lastActive || existing.createdAt || 0).getTime();
        const currentTime = new Date(session.deviceInfo?.lastActive || session.createdAt || 0).getTime();
        if (currentTime <= existingTime) {
          continue; // Keep existing (more recent)
        }
      }
      
      const userData = formattedUser;

      userSessionMap.set(userId, {
        sessionId: session.sessionId,
        user: userData,
        lastActive: session.deviceInfo?.lastActive || session.createdAt || new Date().toISOString(),
        createdAt: session.createdAt,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt,
        isCurrent: currentSessionId ? session.sessionId === currentSessionId : false
      });
    }

    return Array.from(userSessionMap.values());
  } catch (error) {
    logger.error('[DeviceUtils] Error getting device sessions:', error);
    return [];
  }
};

/**
 * Logout all sessions for a specific device
 */
export const logoutAllDeviceSessions = async (deviceId: string, excludeSessionId?: string) => {
  try {
    const query: any = {
      deviceId,
      isActive: true
    };
    
    if (excludeSessionId) {
      query.sessionId = { $ne: excludeSessionId };
    }
    
    // Get sessionIds before updating for cache invalidation
    const sessions = await Session.find(query).select('sessionId').lean().exec();
    const sessionIds = sessions.map(s => s.sessionId);
    
    const result = await Session.updateMany(query, {
      $set: {
        isActive: false,
        loggedOutAt: new Date()
      }
    });
    
    // Invalidate session cache for all affected sessions
    for (const sessionId of sessionIds) {
      sessionCache.invalidate(sessionId);
    }
    
    logger.info(`[DeviceUtils] Logged out ${result.modifiedCount} sessions for device: ${deviceId}`);
    return result.modifiedCount;
  } catch (error) {
    logger.error('[DeviceUtils] Error logging out device sessions:', error);
    return 0;
  }
};

// Helper functions for parsing user agent
function parseUserAgentBrowser(userAgent: string): string {
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  if (userAgent.includes('Opera')) return 'Opera';
  return 'Unknown';
}

function parseUserAgentOS(userAgent: string): string {
  if (userAgent.includes('Windows')) return 'Windows';
  if (userAgent.includes('Mac OS')) return 'macOS';
  if (userAgent.includes('Linux')) return 'Linux';
  if (userAgent.includes('Android')) return 'Android';
  if (userAgent.includes('iOS')) return 'iOS';
  return 'Unknown';
}

function parseDeviceType(userAgent: string): string {
  if (userAgent.includes('Mobile')) return 'mobile';
  if (userAgent.includes('Tablet')) return 'tablet';
  return 'desktop';
}
