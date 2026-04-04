import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { OxyServices } from '@oxyhq/core';
import type { User, ApiError, SessionLoginResponse } from '@oxyhq/core';
import type { ManagedAccount, CreateManagedAccountInput } from '@oxyhq/core';
import { KeyManager } from '@oxyhq/core';
import type { ClientSession } from '@oxyhq/core';
import { toast } from '../../lib/sonner';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useSessionSocket } from '../hooks/useSessionSocket';
import type { UseFollowHook } from '../hooks/useFollow.types';
import { useLanguageManagement } from '../hooks/useLanguageManagement';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useAuthOperations } from './hooks/useAuthOperations';
import { useDeviceManagement } from '../hooks/useDeviceManagement';
import { getStorageKeys, createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';
import { isInvalidSessionError, isTimeoutOrNetworkError } from '../utils/errorHandlers';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { useQueryClient } from '@tanstack/react-query';
import { clearQueryCache } from '../hooks/queryClient';
import { useAvatarPicker } from '../hooks/useAvatarPicker';
import { useAccountStore } from '../stores/accountStore';
import { logger as loggerUtil } from '@oxyhq/core';
import { useWebSSO, isWebBrowser } from '../hooks/useWebSSO';

export interface OxyContextState {
  user: User | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isTokenReady: boolean;
  isStorageReady: boolean;
  error: string | null;
  currentLanguage: string;
  currentLanguageMetadata: ReturnType<typeof useLanguageManagement>['metadata'];
  currentLanguageName: string;
  currentNativeLanguageName: string;

  // Identity (cryptographic key pair)
  hasIdentity: () => Promise<boolean>;
  getPublicKey: () => Promise<string | null>;

  // Authentication
  signIn: (publicKey: string, deviceName?: string) => Promise<User>;

  /**
   * Handle session from popup authentication
   * Updates auth state, persists session to storage
   */
  handlePopupSession: (session: SessionLoginResponse) => Promise<void>;

  // Session management
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  setLanguage: (languageId: string) => Promise<void>;
  getDeviceSessions: () => Promise<
    Array<{
      sessionId: string;
      deviceId: string;
      deviceName?: string;
      lastActive?: string;
      expiresAt?: string;
    }>
  >;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;
  clearSessionState: () => Promise<void>;
  clearAllAccountData: () => Promise<void>;
  storageKeyPrefix: string;
  oxyServices: OxyServices;
  useFollow?: UseFollowHook;
  showBottomSheet?: (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => void;
  openAvatarPicker: () => void;

  // Managed accounts (sub-accounts / managed identities)
  actingAs: string | null;
  managedAccounts: ManagedAccount[];
  setActingAs: (userId: string | null) => void;
  refreshManagedAccounts: () => Promise<void>;
  createManagedAccount: (data: CreateManagedAccountInput) => Promise<ManagedAccount>;
}

const OxyContext = createContext<OxyContextState | null>(null);

export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices?: OxyServices;
  baseURL?: string;
  authWebUrl?: string;
  authRedirectUri?: string;
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void;
}

let cachedUseFollowHook: UseFollowHook | null = null;

const loadUseFollowHook = (): UseFollowHook => {
  if (cachedUseFollowHook) {
    return cachedUseFollowHook;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useFollow } = require('../hooks/useFollow');
    cachedUseFollowHook = useFollow as UseFollowHook;
    return cachedUseFollowHook;
  } catch (error) {
    if (__DEV__) {
      loggerUtil.warn(
        'useFollow hook is not available. Please import useFollow from @oxyhq/services directly.',
        { component: 'OxyContext', method: 'loadUseFollowHook' },
        error
      );
    }

    const fallback: UseFollowHook = () => {
      throw new Error('useFollow hook is only available in the UI bundle. Import it from @oxyhq/services.');
    };

    cachedUseFollowHook = fallback;
    return cachedUseFollowHook;
  }
};

export const OxyProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices: providedOxyServices,
  baseURL,
  authWebUrl,
  authRedirectUri,
  storageKeyPrefix = 'oxy_session',
  onAuthStateChange,
  onError,
}) => {
  const oxyServicesRef = useRef<OxyServices | null>(null);

  if (!oxyServicesRef.current) {
    if (providedOxyServices) {
      oxyServicesRef.current = providedOxyServices;
    } else if (baseURL) {
      oxyServicesRef.current = new OxyServices({
        baseURL,
        authWebUrl,
        authRedirectUri,
      });
    } else {
      throw new Error('Either oxyServices or baseURL must be provided to OxyContextProvider');
    }
  }

  const oxyServices = oxyServicesRef.current;

  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    loginSuccess,
    loginFailure,
    logoutStore,
  } = useAuthStore(
    useShallow((state: AuthState) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      error: state.error,
      loginSuccess: state.loginSuccess,
      loginFailure: state.loginFailure,
      logoutStore: state.logout,
    })),
  );

  const [tokenReady, setTokenReady] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const setAuthState = useAuthStore.setState;

  const logger = useCallback((message: string, err?: unknown) => {
    if (__DEV__) {
      console.warn(`[OxyContext] ${message}`, err);
    }
  }, []);

  const storageKeys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  // Simple storage initialization - no complex hook needed
  const storageRef = useRef<StorageInterface | null>(null);
  const [storage, setStorage] = useState<StorageInterface | null>(null);

  useEffect(() => {
    let mounted = true;
    createPlatformStorage()
      .then((storageInstance) => {
        if (mounted) {
          storageRef.current = storageInstance;
          setStorage(storageInstance);
        }
      })
      .catch((err) => {
        if (mounted) {
          logger('Failed to initialize storage', err);
          onError?.({
            message: 'Failed to initialize storage',
            code: 'STORAGE_INIT_ERROR',
            status: 500,
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [logger, onError]);


  // Offline queuing is now handled by TanStack Query mutations
  // No need for custom offline queue

  const {
    currentLanguage,
    metadata: currentLanguageMetadata,
    languageName: currentLanguageName,
    nativeLanguageName: currentNativeLanguageName,
    setLanguage,
    applyLanguagePreference,
  } = useLanguageManagement({
    storage,
    languageKey: storageKeys.language,
    onError,
    logger,
  });

  const queryClient = useQueryClient();

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    updateSessions,
    switchSession,
    refreshSessions,
    clearSessionState,
    saveActiveSessionId,
    trackRemovedSession,
  } = useSessionManagement({
    oxyServices,
    storage,
    storageKeyPrefix,
    loginSuccess,
    logoutStore,
    applyLanguagePreference,
    onAuthStateChange,
    onError,
    setAuthError: (message) => setAuthState({ error: message }),
    logger,
    setTokenReady,
    queryClient,
  });

  const {
    signIn,
    logout,
    logoutAll,
  } = useAuthOperations({
    oxyServices,
    storage,
    sessions,
    activeSessionId,
    setActiveSessionId,
    updateSessions,
    saveActiveSessionId,
    clearSessionState,
    switchSession,
    applyLanguagePreference,
    onAuthStateChange,
    onError,
    loginSuccess,
    loginFailure,
    logoutStore,
    setAuthState,
    logger,
  });

  // Clear all account data (sessions, cache, etc.)
  const clearAllAccountData = useCallback(async (): Promise<void> => {
    // Clear TanStack Query cache (in-memory)
    queryClient.clear();

    // Clear persisted query cache
    if (storage) {
      try {
        await clearQueryCache(storage);
      } catch (error) {
        logger('Failed to clear persisted query cache', error);
      }
    }

    // Clear session state (sessions, activeSessionId, storage)
    await clearSessionState();

    // Reset account store
    useAccountStore.getState().reset();

    // Clear HTTP service cache
    oxyServices.clearCache();
  }, [queryClient, storage, clearSessionState, logger, oxyServices]);

  const { getDeviceSessions, logoutAllDeviceSessions, updateDeviceName } = useDeviceManagement({
    oxyServices,
    activeSessionId,
    onError,
    clearSessionState,
    logger,
  });

  const useFollowHook = loadUseFollowHook();

  // Refs for mutable callbacks to avoid stale closures in restoreSessionsFromStorage (#187)
  const switchSessionRef = useRef(switchSession);
  switchSessionRef.current = switchSession;
  const updateSessionsRef = useRef(updateSessions);
  updateSessionsRef.current = updateSessions;
  const clearSessionStateRef = useRef(clearSessionState);
  clearSessionStateRef.current = clearSessionState;

  const restoreSessionsFromStorage = useCallback(async (): Promise<void> => {
    if (!storage) {
      return;
    }

    setTokenReady(false);

    try {
      const storedSessionIdsJson = await storage.getItem(storageKeys.sessionIds);
      const storedSessionIds: string[] = storedSessionIdsJson ? JSON.parse(storedSessionIdsJson) : [];
      const storedActiveSessionId = await storage.getItem(storageKeys.activeSessionId);

      let validSessions: ClientSession[] = [];

      if (storedSessionIds.length > 0) {
        // Validate all sessions in parallel (with 8s timeout per session) to avoid
        // sequential blocking that freezes the app on startup
        const VALIDATION_TIMEOUT = 8000;
        const results = await Promise.allSettled(
          storedSessionIds.map(async (sessionId) => {
            const timeoutPromise = new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), VALIDATION_TIMEOUT),
            );
            const validationPromise = oxyServices
              .validateSession(sessionId, { useHeaderValidation: true })
              .catch((validationError: unknown) => {
                if (!isInvalidSessionError(validationError) && !isTimeoutOrNetworkError(validationError)) {
                  logger('Session validation failed during init', validationError);
                } else if (__DEV__ && isTimeoutOrNetworkError(validationError)) {
                  loggerUtil.debug('Session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreSessionsFromStorage' }, validationError as unknown);
                }
                return null;
              });

            return Promise.race([validationPromise, timeoutPromise]).then((validation) => {
              if (validation?.valid && validation.user) {
                const now = new Date();
                return {
                  sessionId,
                  deviceId: '',
                  expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  lastActive: now.toISOString(),
                  userId: validation.user.id?.toString() ?? '',
                  isCurrent: sessionId === storedActiveSessionId,
                } as ClientSession;
              }
              return null;
            });
          }),
        );

        validSessions = results
          .filter((r): r is PromiseFulfilledResult<ClientSession | null> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((s): s is ClientSession => s !== null);

        // Always persist validated sessions to storage (even empty list)
        // to clear stale/expired session IDs that would cause 401 loops on restart
        updateSessionsRef.current(validSessions, { merge: false });
      }

      if (storedActiveSessionId) {
        try {
          await switchSessionRef.current(storedActiveSessionId);
        } catch (switchError) {
          // Silently handle expected errors (invalid sessions, timeouts, network issues)
          if (isInvalidSessionError(switchError)) {
            await storage.removeItem(storageKeys.activeSessionId);
            updateSessionsRef.current(
              validSessions.filter((session) => session.sessionId !== storedActiveSessionId),
              { merge: false },
            );
            // Don't log expected session errors during restoration
          } else if (isTimeoutOrNetworkError(switchError)) {
            // Timeout/network error - non-critical, don't block
            if (__DEV__) {
              loggerUtil.debug('Active session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreSessionsFromStorage' }, switchError as unknown);
            }
          } else {
            // Only log unexpected errors
            logger('Active session validation error', switchError);
          }
        }
      }
    } catch (error) {
      if (__DEV__) {
        loggerUtil.error('Auth init error', error instanceof Error ? error : new Error(String(error)), { component: 'OxyContext', method: 'restoreSessionsFromStorage' });
      }
      await clearSessionStateRef.current();
    } finally {
      setTokenReady(true);
    }
  }, [
    logger,
    oxyServices,
    storage,
    storageKeys.activeSessionId,
    storageKeys.sessionIds,
  ]);

  useEffect(() => {
    if (!storage || initialized) {
      return;
    }

    setInitialized(true);
    restoreSessionsFromStorage().catch((error) => {
      if (__DEV__) {
        logger('Failed to restore sessions from storage', error);
      }
    });
  }, [restoreSessionsFromStorage, storage, initialized, logger]);

  // Web SSO: Automatically check for cross-domain session on web platforms
  // Also used for popup auth - updates all state and persists session
  const handleWebSSOSession = useCallback(async (session: SessionLoginResponse) => {
    if (!session?.user || !session?.sessionId) {
      if (__DEV__) {
        loggerUtil.warn('handleWebSSOSession: Invalid session', { component: 'OxyContext' });
      }
      return;
    }

    // Set the access token on the HTTP client before updating UI state
    if (session.accessToken) {
      oxyServices.httpService.setTokens(session.accessToken);
    } else {
      await oxyServices.getTokenBySession(session.sessionId);
    }

    const clientSession = {
      sessionId: session.sessionId,
      deviceId: session.deviceId || '',
      expiresAt: session.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastActive: new Date().toISOString(),
      userId: session.user.id?.toString() ?? '',
      isCurrent: true,
    };

    updateSessions([clientSession], { merge: true });
    setActiveSessionId(session.sessionId);

    // Fetch the full user profile now that we have a valid access token.
    // The session only carries MinimalUserData; the store and callbacks expect a full User.
    let fullUser: User;
    try {
      fullUser = await oxyServices.getCurrentUser();
    } catch {
      // If the profile fetch fails, fall back to the minimal data from the session
      // so the user is still logged in (the store accepts User, but the shapes overlap at runtime).
      fullUser = session.user as unknown as User;
    }
    loginSuccess(fullUser);
    onAuthStateChange?.(fullUser);

    // Persist to storage
    if (storage) {
      await storage.setItem(storageKeys.activeSessionId, session.sessionId);
      const existingIds = await storage.getItem(storageKeys.sessionIds);
      let sessionIds: string[] = [];
      try { sessionIds = existingIds ? JSON.parse(existingIds) : []; } catch { /* corrupted storage */ }
      if (!sessionIds.includes(session.sessionId)) {
        sessionIds.push(session.sessionId);
        await storage.setItem(storageKeys.sessionIds, JSON.stringify(sessionIds));
      }
    }
  }, [oxyServices, updateSessions, setActiveSessionId, loginSuccess, onAuthStateChange, storage, storageKeys]);

  // Enable web SSO only after local storage check completes and no user found
  const shouldTryWebSSO = isWebBrowser() && tokenReady && !user && initialized;

  useWebSSO({
    oxyServices,
    onSessionFound: handleWebSSOSession,
    onError: (error) => {
      if (__DEV__) {
        loggerUtil.debug('Web SSO check failed (non-critical)', { component: 'OxyContext' }, error);
      }
    },
    enabled: shouldTryWebSSO,
  });

  // IdP session validation via lightweight iframe check
  // When user returns to tab, verify auth.oxy.so still has their session
  // If session is gone (cleared/logged out), clear local session too
  const lastIdPCheckRef = useRef<number>(0);
  const pendingIdPCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isWebBrowser() || !user || !initialized) return;

    const checkIdPSession = () => {
      // Debounce: check at most once per 30 seconds
      const now = Date.now();
      if (now - lastIdPCheckRef.current < 30000) return;
      lastIdPCheckRef.current = now;

      // Clean up any in-flight check before starting a new one
      pendingIdPCleanupRef.current?.();

      // Load hidden iframe to check IdP session via postMessage
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'display:none;width:0;height:0;border:0';
      const idpOrigin = authWebUrl || 'https://auth.oxy.so';
      iframe.src = `${idpOrigin}/auth/session-check?client_id=${encodeURIComponent(window.location.origin)}`;

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        window.removeEventListener('message', handleMessage);
        iframe.remove();
      };

      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== idpOrigin) return;
        if (event.data?.type !== 'oxy-session-check') return;
        cleanup();

        if (!event.data.hasSession) {
          toast.info('Your session has ended. Please sign in again.');
          await clearSessionState();
        }
      };

      window.addEventListener('message', handleMessage);
      document.body.appendChild(iframe);
      setTimeout(cleanup, 5000); // Timeout after 5s
      pendingIdPCleanupRef.current = cleanup;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkIdPSession();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pendingIdPCleanupRef.current?.();
      pendingIdPCleanupRef.current = null;
    };
  }, [user, initialized, clearSessionState, authWebUrl]);

  const activeSession = activeSessionId
    ? sessions.find((session) => session.sessionId === activeSessionId)
    : undefined;
  const currentDeviceId = activeSession?.deviceId ?? null;

  const userId = user?.id;

  const refreshSessionsWithUser = useCallback(
    () => refreshSessions(userId),
    [refreshSessions, userId],
  );

  const handleSessionRemoved = useCallback(
    (sessionId: string) => {
      trackRemovedSession(sessionId);
    },
    [trackRemovedSession],
  );

  const handleRemoteSignOut = useCallback(() => {
    toast.info('You have been signed out remotely.');
    logout().catch((remoteError) => logger('Failed to process remote sign out', remoteError));
  }, [logger, logout]);

  useSessionSocket({
    userId,
    activeSessionId,
    currentDeviceId,
    refreshSessions: refreshSessionsWithUser,
    logout,
    clearSessionState,
    baseURL: oxyServices.getBaseURL(),
    getAccessToken: () => oxyServices.getAccessToken(),
    onRemoteSignOut: handleRemoteSignOut,
    onSessionRemoved: handleSessionRemoved,
  });

  const switchSessionForContext = useCallback(
    async (sessionId: string): Promise<void> => {
      await switchSession(sessionId);
    },
    [switchSession],
  );

  // Identity management wrappers (delegate to KeyManager)
  const hasIdentity = useCallback(async (): Promise<boolean> => {
    return KeyManager.hasIdentity();
  }, []);

  const getPublicKey = useCallback(async (): Promise<string | null> => {
    return KeyManager.getPublicKey();
  }, []);

  // Create showBottomSheet function that uses the global function
  const showBottomSheetForContext = useCallback(
    (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => {
      globalShowBottomSheet(screenOrConfig);
    },
    [],
  );

  // Avatar picker extracted into dedicated hook
  const { openAvatarPicker } = useAvatarPicker({
    oxyServices,
    currentLanguage,
    activeSessionId,
    queryClient,
    showBottomSheet: showBottomSheetForContext,
  });

  // --- Managed accounts state ---
  const [actingAs, setActingAsState] = useState<string | null>(null);
  const [managedAccounts, setManagedAccounts] = useState<ManagedAccount[]>([]);

  // Restore actingAs from storage on startup
  useEffect(() => {
    if (!storage || !initialized) return;
    let mounted = true;
    (async () => {
      try {
        const stored = await storage.getItem(`${storageKeyPrefix}_acting_as`);
        if (mounted && stored) {
          setActingAsState(stored);
          oxyServices.setActingAs(stored);
        }
      } catch (err) {
        if (__DEV__) {
          loggerUtil.debug('Failed to restore actingAs from storage', { component: 'OxyContext' }, err as unknown);
        }
      }
    })();
    return () => { mounted = false; };
  }, [storage, initialized, storageKeyPrefix, oxyServices]);

  // Load managed accounts when authenticated
  const refreshManagedAccounts = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) return;
    try {
      const accounts = await oxyServices.getManagedAccounts();
      setManagedAccounts(accounts);
    } catch (err) {
      if (__DEV__) {
        loggerUtil.debug('Failed to load managed accounts', { component: 'OxyContext' }, err as unknown);
      }
    }
  }, [isAuthenticated, oxyServices]);

  useEffect(() => {
    if (isAuthenticated && initialized && tokenReady) {
      refreshManagedAccounts();
    }
  }, [isAuthenticated, initialized, tokenReady, refreshManagedAccounts]);

  const setActingAs = useCallback((userId: string | null) => {
    oxyServices.setActingAs(userId);
    setActingAsState(userId);
    // Persist to storage
    if (storage) {
      if (userId) {
        storage.setItem(`${storageKeyPrefix}_acting_as`, userId).catch(() => {});
      } else {
        storage.removeItem(`${storageKeyPrefix}_acting_as`).catch(() => {});
      }
    }
  }, [oxyServices, storage, storageKeyPrefix]);

  const createManagedAccountFn = useCallback(async (data: CreateManagedAccountInput): Promise<ManagedAccount> => {
    const account = await oxyServices.createManagedAccount(data);
    await refreshManagedAccounts();
    return account;
  }, [oxyServices, refreshManagedAccounts]);

  const contextValue: OxyContextState = useMemo(() => ({
    user,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    isTokenReady: tokenReady,
    isStorageReady: storage !== null,
    error,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    hasIdentity,
    getPublicKey,
    signIn,
    handlePopupSession: handleWebSSOSession,
    logout,
    logoutAll,
    switchSession: switchSessionForContext,
    removeSession: logout,
    refreshSessions: refreshSessionsWithUser,
    setLanguage,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    clearSessionState,
    clearAllAccountData,
    storageKeyPrefix,
    oxyServices,
    useFollow: useFollowHook,
    showBottomSheet: showBottomSheetForContext,
    openAvatarPicker,
    actingAs,
    managedAccounts,
    setActingAs,
    refreshManagedAccounts,
    createManagedAccount: createManagedAccountFn,
  }), [
    activeSessionId,
    signIn,
    handleWebSSOSession,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    error,
    getDeviceSessions,
    getPublicKey,
    hasIdentity,
    isAuthenticated,
    isLoading,
    logout,
    logoutAll,
    logoutAllDeviceSessions,
    oxyServices,
    storageKeyPrefix,
    refreshSessionsWithUser,
    sessions,
    setLanguage,
    storage,
    switchSessionForContext,
    tokenReady,
    updateDeviceName,
    clearAllAccountData,
    useFollowHook,
    user,
    showBottomSheetForContext,
    openAvatarPicker,
    actingAs,
    managedAccounts,
    setActingAs,
    refreshManagedAccounts,
    createManagedAccountFn,
  ]);

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

export const OxyContextProvider = OxyProvider;

const noop = () => Promise.resolve() as any;

const LOADING_STATE: OxyContextState = {
  user: null,
  sessions: [],
  activeSessionId: null,
  isAuthenticated: false,
  isLoading: true,
  isTokenReady: false,
  isStorageReady: false,
  error: null,
  currentLanguage: 'en',
  currentLanguageMetadata: {} as any,
  currentLanguageName: 'English',
  currentNativeLanguageName: 'English',
  hasIdentity: () => Promise.resolve(false),
  getPublicKey: () => Promise.resolve(null),
  signIn: noop,
  handlePopupSession: noop,
  logout: noop,
  logoutAll: noop,
  switchSession: noop,
  removeSession: noop,
  refreshSessions: noop,
  setLanguage: noop,
  getDeviceSessions: () => Promise.resolve([]),
  logoutAllDeviceSessions: noop,
  updateDeviceName: noop,
  clearSessionState: noop,
  clearAllAccountData: noop,
  storageKeyPrefix: 'oxy_session',
  oxyServices: null as any,
  openAvatarPicker: () => {},
  actingAs: null,
  managedAccounts: [],
  setActingAs: () => {},
  refreshManagedAccounts: noop,
  createManagedAccount: noop,
};

export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    return LOADING_STATE;
  }
  return context;
};

export default OxyContext;

