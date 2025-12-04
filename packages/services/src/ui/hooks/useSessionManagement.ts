import { useCallback, useMemo, useRef, useState } from 'react';
import type { ApiError, User } from '../../../models/interfaces';
import type { ClientSession } from '../../../models/session';
import { mergeSessions, normalizeAndSortSessions, sessionsArraysEqual } from '../../../utils/sessionUtils';
import { fetchSessionsWithFallback, mapSessionsToClient, validateSessionBatch } from '../utils/sessionHelpers';
import { getStorageKeys, type StorageInterface } from '../utils/storageHelpers';
import { handleAuthError, isInvalidSessionError } from '../utils/errorHandlers';
import type { OxyServices } from '../../../core';

export interface UseSessionManagementOptions {
  oxyServices: OxyServices;
  storage: StorageInterface | null;
  storageKeyPrefix?: string;
  loginSuccess: (user: User) => void;
  logoutStore: () => void;
  applyLanguagePreference: (user: User) => Promise<void>;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void;
  setAuthError?: (message: string | null) => void;
  logger?: (message: string, error?: unknown) => void;
  setTokenReady?: (ready: boolean) => void;
}

export interface UseSessionManagementResult {
  sessions: ClientSession[];
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  updateSessions: (incoming: ClientSession[], options?: { merge?: boolean }) => void;
  switchSession: (sessionId: string) => Promise<User>;
  refreshSessions: (activeUserId?: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  saveActiveSessionId: (sessionId: string) => Promise<void>;
  trackRemovedSession: (sessionId: string) => void;
  storageKeys: ReturnType<typeof getStorageKeys>;
  isRefreshInFlight: boolean;
}

const DEFAULT_SAVE_ERROR_MESSAGE = 'Failed to save session data';
const CLEAR_STORAGE_ERROR = 'Failed to clear storage';

/**
 * Manage session state, persistence, and high-level multi-session operations.
 *
 * @param options - Session management configuration
 */
export const useSessionManagement = ({
  oxyServices,
  storage,
  storageKeyPrefix,
  loginSuccess,
  logoutStore,
  applyLanguagePreference,
  onAuthStateChange,
  onError,
  setAuthError,
  logger,
  setTokenReady,
}: UseSessionManagementOptions): UseSessionManagementResult => {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const removedSessionsRef = useRef<Set<string>>(new Set());
  const lastRefreshRef = useRef<number>(0);

  const storageKeys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  const saveSessionIds = useCallback(
    async (sessionIds: string[]): Promise<void> => {
      if (!storage) return;
      try {
        const uniqueIds = Array.from(new Set(sessionIds));
        await storage.setItem(storageKeys.sessionIds, JSON.stringify(uniqueIds));
      } catch (error) {
        if (logger) {
          logger(DEFAULT_SAVE_ERROR_MESSAGE, error);
        } else if (__DEV__) {
          console.warn('Failed to save session IDs:', error);
        }
      }
    },
    [logger, storage, storageKeys.sessionIds],
  );

  const updateSessions = useCallback(
    (incoming: ClientSession[], options: { merge?: boolean } = {}): void => {
      setSessions((prevSessions) => {
        const processed = options.merge
          ? mergeSessions(prevSessions, incoming, activeSessionId, false)
          : normalizeAndSortSessions(incoming, activeSessionId, false);

        if (storage) {
          void saveSessionIds(processed.map((session) => session.sessionId));
        }

        if (sessionsArraysEqual(prevSessions, processed)) {
          return prevSessions;
        }
        return processed;
      });
    },
    [activeSessionId, saveSessionIds, storage],
  );

  const saveActiveSessionId = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!storage) return;
      try {
        await storage.setItem(storageKeys.activeSessionId, sessionId);
      } catch (error) {
        handleAuthError(error, {
          defaultMessage: DEFAULT_SAVE_ERROR_MESSAGE,
          code: 'SESSION_PERSISTENCE_ERROR',
          onError,
          setAuthError,
          logger,
        });
      }
    },
    [logger, onError, setAuthError, storage, storageKeys.activeSessionId],
  );

  const removeActiveSessionId = useCallback(async (): Promise<void> => {
    if (!storage) return;
    try {
      await storage.removeItem(storageKeys.activeSessionId);
    } catch (error) {
      handleAuthError(error, {
        defaultMessage: DEFAULT_SAVE_ERROR_MESSAGE,
        code: 'SESSION_PERSISTENCE_ERROR',
        onError,
        setAuthError,
        logger,
      });
    }
  }, [logger, onError, setAuthError, storage, storageKeys.activeSessionId]);

  const clearSessionStorage = useCallback(async (): Promise<void> => {
    if (!storage) return;
    try {
      await storage.removeItem(storageKeys.activeSessionId);
      await storage.removeItem(storageKeys.sessionIds);
    } catch (error) {
      handleAuthError(error, {
        defaultMessage: CLEAR_STORAGE_ERROR,
        code: 'STORAGE_ERROR',
        onError,
        setAuthError,
        logger,
      });
    }
  }, [logger, onError, setAuthError, storage, storageKeys.activeSessionId, storageKeys.sessionIds]);

  const clearSessionState = useCallback(async (): Promise<void> => {
    setSessions([]);
    setActiveSessionId(null);
    logoutStore();
    await clearSessionStorage();
    onAuthStateChange?.(null);
  }, [clearSessionStorage, logoutStore, onAuthStateChange]);

  const activateSession = useCallback(
    async (sessionId: string, user: User): Promise<void> => {
      await oxyServices.getTokenBySession(sessionId);
      setTokenReady?.(true);
      setActiveSessionId(sessionId);
      loginSuccess(user);
      await saveActiveSessionId(sessionId);
      await applyLanguagePreference(user);
      onAuthStateChange?.(user);
    },
    [
      applyLanguagePreference,
      loginSuccess,
      onAuthStateChange,
      oxyServices,
      saveActiveSessionId,
      setTokenReady,
    ],
  );

  const trackRemovedSession = useCallback((sessionId: string) => {
    removedSessionsRef.current.add(sessionId);
    setTimeout(() => {
      removedSessionsRef.current.delete(sessionId);
    }, 5000);
  }, []);

  const findReplacementSession = useCallback(
    async (sessionIds: string[]): Promise<User | null> => {
      if (!sessionIds.length) {
        return null;
      }

      const validationResults = await validateSessionBatch(oxyServices, sessionIds, {
        maxConcurrency: 3,
      });

      const validSession = validationResults.find((result) => result.valid);
      if (!validSession) {
        return null;
      }

      const validation = await oxyServices.validateSession(validSession.sessionId, {
        useHeaderValidation: true,
      });

      if (!validation?.valid || !validation.user) {
        return null;
      }

      const user = validation.user as User;
      await activateSession(validSession.sessionId, user);
      return user;
    },
    [activateSession, oxyServices],
  );

  const switchSession = useCallback(
    async (sessionId: string): Promise<User> => {
      try {
        const validation = await oxyServices.validateSession(sessionId, { useHeaderValidation: true });
        if (!validation?.valid) {
          throw new Error('Session is invalid or expired');
        }

        if (!validation.user) {
          throw new Error('User data not available from session validation');
        }

        const user = validation.user as User;
        await activateSession(sessionId, user);

        try {
          const deviceSessions = await fetchSessionsWithFallback(oxyServices, sessionId, {
            fallbackUserId: user.id,
            logger,
          });
          updateSessions(deviceSessions, { merge: true });
        } catch (error) {
          if (__DEV__) {
            console.warn('Failed to synchronize sessions after switch:', error);
          }
        }

        return user;
      } catch (error) {
        const invalidSession = isInvalidSessionError(error);

        if (invalidSession) {
          updateSessions(sessions.filter((session) => session.sessionId !== sessionId), {
            merge: false,
          });
          if (sessionId === activeSessionId) {
            const otherSessionIds = sessions
              .filter(
                (session) =>
                  session.sessionId !== sessionId && !removedSessionsRef.current.has(session.sessionId),
              )
              .map((session) => session.sessionId);

            const replacementUser = await findReplacementSession(otherSessionIds);
            if (replacementUser) {
              return replacementUser;
            }
          }
        }

        handleAuthError(error, {
          defaultMessage: 'Failed to switch session',
          code: invalidSession ? 'INVALID_SESSION' : 'SESSION_SWITCH_ERROR',
          onError,
          setAuthError,
          logger,
        });
        throw error instanceof Error ? error : new Error('Failed to switch session');
      }
    },
    [
      activateSession,
      activeSessionId,
      findReplacementSession,
      logger,
      loginSuccess,
      onError,
      oxyServices,
      sessions,
      setAuthError,
      updateSessions,
    ],
  );

  const refreshSessions = useCallback(
    async (activeUserId?: string): Promise<void> => {
      if (!activeSessionId) return;

      if (refreshInFlightRef.current) {
        await refreshInFlightRef.current;
        return;
      }

      const now = Date.now();
      if (now - lastRefreshRef.current < 500) {
        return;
      }
      lastRefreshRef.current = now;

      const refreshPromise = (async () => {
        try {
          const deviceSessions = await fetchSessionsWithFallback(oxyServices, activeSessionId, {
            fallbackUserId: activeUserId,
            logger,
          });
          updateSessions(deviceSessions, { merge: true });
        } catch (error) {
          if (isInvalidSessionError(error)) {
            const otherSessions = sessions
              .filter(
                (session) =>
                  session.sessionId !== activeSessionId &&
                  !removedSessionsRef.current.has(session.sessionId),
              )
              .map((session) => session.sessionId);

            const replacementUser = await findReplacementSession(otherSessions);
            if (!replacementUser) {
              await clearSessionState();
            }
            return;
          }

          handleAuthError(error, {
            defaultMessage: 'Failed to refresh sessions',
            code: 'SESSION_REFRESH_ERROR',
            onError,
            setAuthError,
            logger,
          });
        } finally {
          refreshInFlightRef.current = null;
          lastRefreshRef.current = Date.now();
        }
      })();

      refreshInFlightRef.current = refreshPromise;
      await refreshPromise;
    },
    [
      activeSessionId,
      clearSessionState,
      findReplacementSession,
      logger,
      onError,
      oxyServices,
      sessions,
      setAuthError,
      updateSessions,
    ],
  );

  const isRefreshInFlight = Boolean(refreshInFlightRef.current);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    updateSessions,
    switchSession,
    refreshSessions,
    clearSessionState,
    saveActiveSessionId,
    trackRemovedSession,
    storageKeys,
    isRefreshInFlight,
  };
};


