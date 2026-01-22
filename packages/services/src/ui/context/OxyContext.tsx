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
import { OxyServices } from '../../core';
import type { User, ApiError } from '../../models/interfaces';
import { KeyManager } from '../../crypto/keyManager';
import type { ClientSession } from '../../models/session';
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
import { translate } from '../../i18n';
import { updateAvatarVisibility, updateProfileWithAvatar } from '../utils/avatarUtils';
import { useAccountStore } from '../stores/accountStore';
import { logger as loggerUtil } from '../../utils/loggerUtils';

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
  oxyServices: OxyServices;
  useFollow?: UseFollowHook;
  showBottomSheet?: (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => void;
  openAvatarPicker: () => void;
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
  const initializedRef = useRef(false);
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

  const restoreSessionsFromStorage = useCallback(async (): Promise<void> => {
    if (!storage) {
      return;
    }

    setTokenReady(false);

    try {
      const storedSessionIdsJson = await storage.getItem(storageKeys.sessionIds);
      const storedSessionIds: string[] = storedSessionIdsJson ? JSON.parse(storedSessionIdsJson) : [];
      const storedActiveSessionId = await storage.getItem(storageKeys.activeSessionId);

      const validSessions: ClientSession[] = [];

      if (storedSessionIds.length > 0) {
        for (const sessionId of storedSessionIds) {
          try {
            const validation = await oxyServices.validateSession(sessionId, { useHeaderValidation: true });
            if (validation?.valid && validation.user) {
              const now = new Date();
              validSessions.push({
                sessionId,
                deviceId: '',
                expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                lastActive: now.toISOString(),
                userId: validation.user.id?.toString() ?? '',
                isCurrent: sessionId === storedActiveSessionId,
              });
            }
          } catch (validationError) {
            // Silently handle expected errors (invalid sessions, timeouts, network issues) during restoration
            // Only log unexpected errors
            if (!isInvalidSessionError(validationError) && !isTimeoutOrNetworkError(validationError)) {
              logger('Session validation failed during init', validationError);
            } else if (__DEV__ && isTimeoutOrNetworkError(validationError)) {
              // Only log timeouts in dev mode for debugging
              loggerUtil.debug('Session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreSessionsFromStorage' }, validationError as unknown);
            }
          }
        }

        if (validSessions.length > 0) {
          updateSessions(validSessions, { merge: false });
        }
      }

      if (storedActiveSessionId) {
        try {
          await switchSession(storedActiveSessionId);
        } catch (switchError) {
          // Silently handle expected errors (invalid sessions, timeouts, network issues)
          if (isInvalidSessionError(switchError)) {
            await storage.removeItem(storageKeys.activeSessionId);
            updateSessions(
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
      await clearSessionState();
    } finally {
      setTokenReady(true);
    }
  }, [
    clearSessionState,
    logger,
    oxyServices,
    storage,
    storageKeys.activeSessionId,
    storageKeys.sessionIds,
    switchSession,
    updateSessions,
  ]);

  useEffect(() => {
    if (!storage || initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    void restoreSessionsFromStorage();
  }, [restoreSessionsFromStorage, storage]);

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

  // Create openAvatarPicker function
  const openAvatarPicker = useCallback(() => {
    showBottomSheetForContext({
      screen: 'FileManagement' as RouteName,
      props: {
        selectMode: true,
        multiSelect: false,
        disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
        afterSelect: 'none', // Don't navigate away - stay on current screen
        onSelect: async (file: any) => {
          if (!file.contentType.startsWith('image/')) {
            toast.error(translate(currentLanguage, 'editProfile.toasts.selectImage') || 'Please select an image file');
            return;
          }
          try {
            // Update file visibility to public for avatar
            await updateAvatarVisibility(file.id, oxyServices, 'OxyContext');

            // Update user profile (handles query invalidation and accountStore update)
            await updateProfileWithAvatar(
              { avatar: file.id },
              oxyServices,
              activeSessionId,
              queryClient
            );

            toast.success(translate(currentLanguage, 'editProfile.toasts.avatarUpdated') || 'Avatar updated');
          } catch (e: any) {
            toast.error(e.message || translate(currentLanguage, 'editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
          }
        },
      },
    });
  }, [oxyServices, currentLanguage, showBottomSheetForContext, activeSessionId, queryClient]);

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
    oxyServices,
    useFollow: useFollowHook,
    showBottomSheet: showBottomSheetForContext,
    openAvatarPicker,
  }), [
    activeSessionId,
    signIn,
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
  ]);

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

export const OxyContextProvider = OxyProvider;

export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxy must be used within an OxyContextProvider');
  }
  return context;
};

export default OxyContext;

