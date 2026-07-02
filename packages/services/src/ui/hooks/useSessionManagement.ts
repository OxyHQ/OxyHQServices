import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isDev, type ApiError, type User } from '@oxyhq/core';
import type { ClientSession } from '@oxyhq/core';
import { mergeSessions, normalizeAndSortSessions, sessionsArraysEqual } from '@oxyhq/core';
import { fetchSessionsWithFallback } from '../utils/sessionHelpers';
import { getStorageKeys, type StorageInterface } from '../utils/storageHelpers';
import { handleAuthError, isInvalidSessionError } from '../utils/errorHandlers';
import type { OxyServices } from '@oxyhq/core';
import type { QueryClient } from '@tanstack/react-query';
import { clearQueryCache } from './queryClient';
import { isWebBrowser } from './useWebSSO';

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
  queryClient?: QueryClient | null;
}

export interface UseSessionManagementResult {
  sessions: ClientSession[];
  activeSessionId: string | null;
  setActiveSessionId: (sessionId: string | null) => void;
  updateSessions: (incoming: ClientSession[], options?: { merge?: boolean; preserveSessionIds?: string[] }) => void;
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
  queryClient,
}: UseSessionManagementOptions): UseSessionManagementResult => {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Refs to avoid recreating callbacks when sessions/activeSessionId change
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

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
        } else if (isDev()) {
          console.warn('Failed to save session IDs:', error);
        }
      }
    },
    [logger, storage, storageKeys.sessionIds],
  );

  const updateSessions = useCallback(
    (incoming: ClientSession[], options: { merge?: boolean; preserveSessionIds?: string[] } = {}): void => {
      setSessions((prevSessions) => {
        const processed = options.merge
          ? mergeSessions(prevSessions, incoming, activeSessionIdRef.current, false)
          : normalizeAndSortSessions(incoming, activeSessionIdRef.current, false);

        if (storage) {
          void saveSessionIds([
            ...processed.map((session) => session.sessionId),
            ...(options.preserveSessionIds ?? []),
          ]);
        }

        if (sessionsArraysEqual(prevSessions, processed)) {
          return prevSessions;
        }
        return processed;
      });
    },
    [saveSessionIds, storage],
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
      // Note: Identity sync state ('oxy_identity_synced') is managed by accounts app
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

    // Clear the access token on the client instance. Without this the
    // TokenStore retained the stale bearer until the next 401, leaving the
    // instance "logged in" at the HTTP layer and — via OxyProvider's
    // token-change mirror — leaking that stale token onto the shared
    // `oxyClient` singleton after sign-out. Clearing here fires
    // `onTokensChanged(null)`, propagating the logged-out state everywhere.
    oxyServices.clearTokens();

    // Clear TanStack Query cache (in-memory)
    if (queryClient) {
      queryClient.clear();
    }
    
    // Clear persisted query cache
    if (storage) {
      try {
        await clearQueryCache(storage);
      } catch (error) {
        if (logger) {
          logger('Failed to clear persisted query cache', error);
        }
      }
    }
    
    await clearSessionStorage();
    onAuthStateChange?.(null);
  }, [clearSessionStorage, logoutStore, onAuthStateChange, oxyServices, queryClient, storage, logger]);

  const activateSession = useCallback(
    async (sessionId: string, user: User): Promise<void> => {
      setTokenReady?.(true);
      setActiveSessionId(sessionId);
      loginSuccess(user);
      await saveActiveSessionId(sessionId);
      await applyLanguagePreference(user);
      onAuthStateChange?.(user);
    },
    [applyLanguagePreference, loginSuccess, onAuthStateChange, saveActiveSessionId, setTokenReady],
  );

  const removalTimerIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const trackRemovedSession = useCallback((sessionId: string) => {
    removedSessionsRef.current.add(sessionId);
    const timerId = setTimeout(() => {
      removedSessionsRef.current.delete(sessionId);
      removalTimerIdsRef.current.delete(timerId);
    }, 5000);
    removalTimerIdsRef.current.add(timerId);
  }, []);

  useEffect(() => {
    return () => {
      removalTimerIdsRef.current.forEach(clearTimeout);
    };
  }, []);

  const switchSession = useCallback(
    async (sessionId: string): Promise<User> => {
      try {
        // On web, the bearer must already be in memory (planted by
        // `claimSessionByToken`, a cold-boot silent-restore step, or a prior
        // `SessionClient` sync) before validating — there is no client-side
        // `oxy_rt` refresh-cookie slot to fall back on; the device account SET
        // is server-authoritative via `SessionClient` now. The native path
        // arrives here only after a bearer has been planted by
        // `claimSessionByToken` or secure shared-session restore.
        if (isWebBrowser() && !oxyServices.getAccessToken()) {
          throw new Error('Session is invalid or expired');
        }

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
          if (isDev()) {
            console.warn('Failed to synchronize sessions after switch:', error);
          }
        }

        return user;
      } catch (error) {
        const invalidSession = isInvalidSessionError(error);

        if (invalidSession) {
          // Server authority (`SessionClient` bootstrap/sync) reconciles which
          // account is actually active — just drop the invalid session from
          // the local view rather than guessing at a replacement.
          updateSessions(sessionsRef.current.filter((session) => session.sessionId !== sessionId), {
            merge: false,
          });
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
      logger,
      onError,
      oxyServices,
      setAuthError,
      updateSessions,
    ],
  );

  const refreshSessions = useCallback(
    async (activeUserId?: string): Promise<void> => {
      // Capture the active session id once so the async closure below uses a
      // narrowed, non-null local instead of re-reading the ref (which the
      // compiler cannot prove stays non-null across awaits).
      const activeSessionId = activeSessionIdRef.current;
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
            // Server authority (`SessionClient` bootstrap/sync) reconciles
            // which account is actually active — just clear local state
            // rather than guessing at a replacement session.
            await clearSessionState();
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
      clearSessionState,
      logger,
      onError,
      oxyServices,
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
