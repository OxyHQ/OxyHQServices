import type { OxyServices } from '../../../core';
import type { ClientSession } from '../../../models/session';

interface DeviceSession {
  sessionId: string;
  deviceId?: string;
  deviceName?: string;
  expiresAt?: string;
  lastActive?: string;
  user?: { id?: string; _id?: { toString(): string } };
  userId?: string;
  isCurrent?: boolean;
}

export interface FetchSessionsWithFallbackOptions {
  fallbackDeviceId?: string;
  fallbackUserId?: string;
  logger?: (message: string, error?: unknown) => void;
}

export interface ValidateSessionBatchOptions {
  useHeaderValidation?: boolean;
  maxConcurrency?: number;
}

export interface SessionValidationResult {
  sessionId: string;
  valid: boolean;
  user?: unknown;
  raw?: unknown;
  error?: unknown;
}

/**
 * Normalize backend session payloads into `ClientSession` objects.
 *
 * @param sessions - Raw session array returned from the API
 * @param fallbackDeviceId - Device identifier to use when missing from payload
 * @param fallbackUserId - User identifier to use when missing from payload
 */
export const mapSessionsToClient = (
  sessions: DeviceSession[],
  fallbackDeviceId?: string,
  fallbackUserId?: string,
): ClientSession[] => {
  const now = new Date();

  return sessions.map((session) => ({
    sessionId: session.sessionId,
    deviceId: session.deviceId || fallbackDeviceId || '',
    expiresAt: session.expiresAt || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    lastActive: session.lastActive || now.toISOString(),
    userId:
      session.user?.id ||
      session.userId ||
      (session.user?._id ? session.user._id.toString() : undefined) ||
      fallbackUserId ||
      '',
    isCurrent: Boolean(session.isCurrent),
  }));
};

/**
 * Fetch device sessions with fallback to the legacy session endpoint when needed.
 *
 * @param oxyServices - Oxy service instance
 * @param sessionId - Session identifier to fetch
 * @param options - Optional fallback options
 */
export const fetchSessionsWithFallback = async (
  oxyServices: Pick<OxyServices, 'getDeviceSessions' | 'getSessionsBySessionId'>,
  sessionId: string,
  {
    fallbackDeviceId,
    fallbackUserId,
    logger,
  }: FetchSessionsWithFallbackOptions = {},
): Promise<ClientSession[]> => {
  try {
    const deviceSessions = await oxyServices.getDeviceSessions(sessionId);
    return mapSessionsToClient(deviceSessions, fallbackDeviceId, fallbackUserId);
  } catch (error) {
    if (__DEV__ && logger) {
      logger('Failed to get device sessions, falling back to user sessions', error);
    } else if (__DEV__) {
      console.warn('Failed to get device sessions, falling back to user sessions:', error);
    }

    const userSessions = await oxyServices.getSessionsBySessionId(sessionId);
    return mapSessionsToClient(userSessions, fallbackDeviceId, fallbackUserId);
  }
};

/**
 * Validate multiple sessions concurrently with configurable concurrency.
 *
 * @param oxyServices - Oxy service instance
 * @param sessionIds - Session identifiers to validate
 * @param options - Validation options
 */
export const validateSessionBatch = async (
  oxyServices: Pick<OxyServices, 'validateSession'>,
  sessionIds: string[],
  { useHeaderValidation = true, maxConcurrency = 5 }: ValidateSessionBatchOptions = {},
): Promise<SessionValidationResult[]> => {
  if (!sessionIds.length) {
    return [];
  }

  const uniqueSessionIds = Array.from(new Set(sessionIds));
  const safeConcurrency = Math.max(1, Math.min(maxConcurrency, uniqueSessionIds.length));
  const results: SessionValidationResult[] = [];
  let index = 0;

  const worker = async () => {
    while (index < uniqueSessionIds.length) {
      const currentIndex = index;
      index += 1;
      const sessionId = uniqueSessionIds[currentIndex];

      try {
        const validation = await oxyServices.validateSession(sessionId, { useHeaderValidation });
        const valid = Boolean(validation?.valid);

        results.push({
          sessionId,
          valid,
          user: validation?.user,
          raw: validation,
        });
      } catch (error) {
        results.push({
          sessionId,
          valid: false,
          error,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, worker));

  return results;
};


