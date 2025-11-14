import crypto from 'crypto';
import { Request } from 'express';
import Session from '../models/Session';
import { logger } from './logger';

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
}

/**
 * Generate a device fingerprint for device identification
 * This helps identify if it's the same physical device
 */
export const generateDeviceFingerprint = (fingerprint: DeviceFingerprint): string => {
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
 * Extract device information from request
 */
export const extractDeviceInfo = (req: Request, providedDeviceId?: string, deviceName?: string): DeviceInfo => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const platformHeader = req.headers['sec-ch-ua-platform'];
  const platform = (typeof platformHeader === 'string' ? platformHeader.replace(/"/g, '') : 'unknown');
  
  // Parse user agent for browser and OS info
  const browser = parseUserAgentBrowser(userAgent);
  const os = parseUserAgentOS(userAgent);
  const deviceType = parseDeviceType(userAgent);
  
  return {
    deviceId: providedDeviceId || generateDeviceId(),
    deviceName: deviceName || generateDefaultDeviceName(browser, os),
    deviceType,
    platform,
    browser,
    os,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent,
    location: req.headers['cf-ipcountry'] as string || undefined, // Cloudflare country header
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
  try {
    const query: any = {
      'deviceInfo.fingerprint': fingerprint,
      isActive: true,
      expiresAt: { $gt: new Date() }
    };
    
    // If userId provided, prefer devices used by this user
    if (userId) {
      query.userId = userId;
    }
    
    const session = await Session.findOne(query).sort({ 'deviceInfo.lastActive': -1 });
    
    if (session) {
      logger.info(`[DeviceUtils] Found existing device ID for fingerprint: ${fingerprint.substring(0, 8)}...`);
      return session.deviceId;
    }
    
    return null;
  } catch (error) {
    logger.error('[DeviceUtils] Error finding existing device ID:', error);
    return null;
  }
};

/**
 * Register or update device information
 */
export const registerDevice = async (deviceInfo: DeviceInfo, fingerprint?: string): Promise<DeviceInfo> => {
  try {
    // If fingerprint provided, try to find existing device ID
    if (fingerprint) {
      const existingDeviceId = await findExistingDeviceId(fingerprint);
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
    .populate('userId', 'username email avatar name')
    .lean()
    .sort({ 
      'deviceInfo.lastActive': -1, // Most recent first
      'sessionId': 1 // Secondary sort by sessionId for stability
    })
    .limit(50) // Limit results to prevent excessive data transfer
    .exec();

    // Map sessions and deduplicate by userId - keep only most recent session per user
    const userSessionMap = new Map<string, any>();
    
    for (const session of sessions) {
      const user = session.userId as any;
      if (!user || typeof user !== 'object') continue;
      
      const userId = user._id?.toString() || user.id;
      if (!userId) continue;
      
      // If we already have a session for this user, keep the one with more recent lastActive
      const existing = userSessionMap.get(userId);
      if (existing) {
        const existingTime = new Date(existing.lastActive || existing.createdAt || 0).getTime();
        const currentTime = new Date(session.deviceInfo?.lastActive || session.createdAt || 0).getTime();
        if (currentTime <= existingTime) {
          continue; // Keep existing (more recent)
        }
      }
      
      // Ensure name.full exists (virtuals may not be included with lean)
      let name = user.name;
      if (name && typeof name === 'object') {
        const first = (name.first as string) || '';
        const last = (name.last as string) || '';
        if (!name.full) {
          name = {
            ...name,
            full: [first, last].filter(Boolean).join(' ').trim()
          };
        }
      }
      
      const userData = {
        id: userId,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        ...user,
        // Ensure name.full is set (override spread if needed)
        name: name
      };

      // Remove MongoDB _id if we have id
      if (userData._id && userData.id) {
        delete userData._id;
      }

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
      query._id = { $ne: excludeSessionId };
    }
    
    const result = await Session.updateMany(query, {
      $set: {
        isActive: false,
        loggedOutAt: new Date()
      }
    });
    
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