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
import type { ClientSession } from '../../models/session';
import { toast } from '../../lib/sonner';
import { useAuthStore, type AuthState } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useSessionSocket } from '../hooks/useSessionSocket';
import type { UseFollowHook } from '../hooks/useFollow.types';
import { useStorage } from '../hooks/useStorage';
import { useLanguageManagement } from '../hooks/useLanguageManagement';
import { useSessionManagement } from '../hooks/useSessionManagement';
import { useAuthOperations } from './hooks/useAuthOperations';
import { useDeviceManagement } from '../hooks/useDeviceManagement';
import { getStorageKeys } from '../utils/storageHelpers';
import { isInvalidSessionError } from '../utils/errorHandlers';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { useQueryClient } from '@tanstack/react-query';
import { clearQueryCache } from '../hooks/queryClient';
import { useAccountStore } from '../stores/accountStore';
import { KeyManager } from '../../crypto/keyManager';
import { translate } from '../../i18n';
import { queryKeys } from '../hooks/queries/queryKeys';
import { useUpdateProfile } from '../hooks/mutations/useAccountMutations';

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

  // Identity management (public key authentication - offline-first)
  createIdentity: () => Promise<{ recoveryPhrase: string[]; synced: boolean }>;
  importIdentity: (phrase: string) => Promise<{ synced: boolean }>;
  signIn: (deviceName?: string) => Promise<User>;
  hasIdentity: () => Promise<boolean>;
  getPublicKey: () => Promise<string | null>;
  isIdentitySynced: () => Promise<boolean>;
  syncIdentity: () => Promise<User>;
  deleteIdentityAndClearAccount: (skipBackup?: boolean, force?: boolean, userConfirmed?: boolean) => Promise<void>;

  // Identity sync state (reactive, from Zustand store)
  identitySyncState: {
    isSynced: boolean;
    isSyncing: boolean;
  };

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
      console.warn(
        'useFollow hook is not available. Please import useFollow from @oxyhq/services directly.',
        error,
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
  storageKeyPrefix = 'oxy_session',
  onAuthStateChange,
  onError,
}) => {
  const oxyServicesRef = useRef<OxyServices | null>(null);

  if (!oxyServicesRef.current) {
    if (providedOxyServices) {
      oxyServicesRef.current = providedOxyServices;
    } else if (baseURL) {
      oxyServicesRef.current = new OxyServices({ baseURL });
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
    // Identity sync state and actions
    isIdentitySyncedStore,
    isSyncing,
    setIdentitySynced,
    setSyncing,
  } = useAuthStore(
    useShallow((state: AuthState) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      error: state.error,
      loginSuccess: state.loginSuccess,
      loginFailure: state.loginFailure,
      logoutStore: state.logout,
      // Identity sync state and actions
      isIdentitySyncedStore: state.isIdentitySynced,
      isSyncing: state.isSyncing,
      setIdentitySynced: state.setIdentitySynced,
      setSyncing: state.setSyncing,
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

  const { storage, isReady: isStorageReady } = useStorage({ onError, logger });

  // Identity integrity check and auto-restore on startup
  useEffect(() => {
    if (!storage || !isStorageReady) return;

    const checkAndRestoreIdentity = async () => {
      try {
        const { KeyManager } = await import('../../crypto/index.js');
        // Check if identity exists and verify integrity
        const hasIdentity = await KeyManager.hasIdentity();
        if (hasIdentity) {
          const isValid = await KeyManager.verifyIdentityIntegrity();
          if (!isValid) {
            // Try to restore from backup
            const restored = await KeyManager.restoreIdentityFromBackup();
            if (restored) {
              if (__DEV__) {
                logger('Identity restored from backup successfully');
              }
            } else {
              if (__DEV__) {
                logger('Identity integrity check failed - user may need to restore from recovery phrase');
              }
            }
          } else {
            // Identity is valid - ensure backup is up to date
            await KeyManager.backupIdentity();
          }
        } else {
          // No identity - try to restore from backup
          const restored = await KeyManager.restoreIdentityFromBackup();
          if (restored && __DEV__) {
            logger('Identity restored from backup on startup');
          }
        }
      } catch (error) {
        if (__DEV__) {
          logger('Error during identity integrity check', error);
        }
        // Don't block app startup - user can recover with recovery phrase
      }
    };

    checkAndRestoreIdentity();
  }, [storage, isStorageReady, logger]);

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
    createIdentity,
    importIdentity,
    signIn,
    logout,
    logoutAll,
    hasIdentity,
    getPublicKey,
    isIdentitySynced,
    syncIdentity: syncIdentityBase,
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
    setIdentitySynced,
    setSyncing,
    logger,
  });

  // syncIdentity - TanStack Query handles offline mutations automatically
  const syncIdentity = useCallback(async () => {
    return await syncIdentityBase();
  }, [syncIdentityBase]);

  // Clear all account data when identity is lost (for accounts app)
  // In accounts app, identity = account, so losing identity means losing everything
  const clearAllAccountData = useCallback(async (): Promise<void> => {
    // Clear TanStack Query cache (in-memory)
    queryClient.clear();
    
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
    
    // Clear session state (sessions, activeSessionId, storage)
    await clearSessionState();
    
    // Clear identity sync state from storage
    if (storage) {
      try {
        await storage.removeItem('oxy_identity_synced');
      } catch (error) {
        if (logger) {
          logger('Failed to clear identity sync state', error);
        }
      }
    }
    
    // Reset auth store identity sync state
    useAuthStore.getState().setIdentitySynced(false);
    useAuthStore.getState().setSyncing(false);
    
    // Reset account store
    useAccountStore.getState().reset();
    
    // Clear HTTP service cache
    oxyServices.clearCache();
  }, [queryClient, storage, clearSessionState, logger, oxyServices]);

  // Delete identity and clear all account data
  // In accounts app, deleting identity means losing the account completely
  const deleteIdentityAndClearAccount = useCallback(async (
    skipBackup: boolean = false,
    force: boolean = false,
    userConfirmed: boolean = false
  ): Promise<void> => {
    // First, clear all account data
    await clearAllAccountData();
    
    // Then delete the identity keys
    await KeyManager.deleteIdentity(skipBackup, force, userConfirmed);
  }, [clearAllAccountData]);

  // Network reconnect sync - TanStack Query automatically retries mutations on reconnect
  // We only need to sync identity if it's not synced
  useEffect(() => {
    if (!storage) return;

    let wasOffline = false;
    let checkTimeout: NodeJS.Timeout | null = null;
    
    // Circuit breaker and exponential backoff state
    const stateRef = {
      consecutiveFailures: 0,
      currentInterval: 10000, // Start with 10 seconds
      baseInterval: 10000, // Base interval in milliseconds
      maxInterval: 60000, // Maximum interval (60 seconds)
      maxFailures: 5, // Circuit breaker threshold
    };

    const scheduleNextCheck = () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
      checkTimeout = setTimeout(() => {
        checkNetworkAndSync();
      }, stateRef.currentInterval);
    };

    const checkNetworkAndSync = async () => {
      try {
        // Try a lightweight health check to see if we're online
        await oxyServices.healthCheck().catch(() => {
          wasOffline = true;
          throw new Error('Health check failed');
        });

        // Health check succeeded - reset circuit breaker and backoff
        if (stateRef.consecutiveFailures > 0) {
          stateRef.consecutiveFailures = 0;
          stateRef.currentInterval = stateRef.baseInterval;
        }

        // If we were offline and now we're online, sync identity if needed
        if (wasOffline) {
          if (__DEV__ && logger) {
            logger('Network reconnected, checking identity sync...');
          }

          // Sync identity first (if not synced)
          try {
            const isSynced = await storage.getItem('oxy_identity_synced');
            if (isSynced === 'false') {
              await syncIdentity();
            }
          } catch (syncError) {
            if (__DEV__ && logger) {
              logger('Error syncing identity on reconnect', syncError);
            }
          }

          // TanStack Query will automatically retry pending mutations
          wasOffline = false;
        }
      } catch (error) {
        // Network check failed - we're offline
        wasOffline = true;
        
        // Increment failure count and apply exponential backoff
        stateRef.consecutiveFailures++;
        
        // Calculate new interval with exponential backoff, capped at maxInterval
        const backoffMultiplier = Math.min(
          Math.pow(2, stateRef.consecutiveFailures - 1),
          stateRef.maxInterval / stateRef.baseInterval
        );
        stateRef.currentInterval = Math.min(
          stateRef.baseInterval * backoffMultiplier,
          stateRef.maxInterval
        );
        
        // If we hit the circuit breaker threshold, use max interval
        if (stateRef.consecutiveFailures >= stateRef.maxFailures) {
          stateRef.currentInterval = stateRef.maxInterval;
        }
      } finally {
        // Always schedule next check (will use updated interval)
        scheduleNextCheck();
      }
    };

    // Check immediately
    checkNetworkAndSync();

    return () => {
      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }
    };
  }, [oxyServices, storage, syncIdentity, logger]);

  const { getDeviceSessions, logoutAllDeviceSessions, updateDeviceName } = useDeviceManagement({
    oxyServices,
    activeSessionId,
    onError,
    clearSessionState,
    logger,
  });

  const useFollowHook = loadUseFollowHook();

  // Create update profile mutation for avatar picker
  const updateProfileMutation = useUpdateProfile();

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
            logger('Session validation failed during init', validationError);
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
          if (isInvalidSessionError(switchError)) {
            await storage.removeItem(storageKeys.activeSessionId);
            updateSessions(
              validSessions.filter((session) => session.sessionId !== storedActiveSessionId),
              { merge: false },
            );
          } else {
            logger('Active session validation error', switchError);
          }
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Auth init error', error);
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
            // Update file visibility to public for avatar (skip if temporary asset ID)
            if (file.id && !file.id.startsWith('temp-')) {
              try {
                await oxyServices.assetUpdateVisibility(file.id, 'public');
                console.log('[OxyContext] Avatar visibility updated to public');
              } catch (visError: any) {
                // Only log non-404 errors (404 means asset doesn't exist yet, which is OK)
                if (visError?.response?.status !== 404) {
                  console.warn('[OxyContext] Failed to update avatar visibility, continuing anyway:', visError);
                }
              }
            }

            // Update user profile using mutation hook (provides optimistic updates, error handling, retry)
            await updateProfileMutation.mutateAsync({ avatar: file.id });
            
            toast.success(translate(currentLanguage, 'editProfile.toasts.avatarUpdated') || 'Avatar updated');
          } catch (e: any) {
            toast.error(e.message || translate(currentLanguage, 'editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
          }
        },
      },
    });
  }, [oxyServices, currentLanguage, showBottomSheetForContext, updateProfileMutation]);

  const contextValue: OxyContextState = useMemo(() => ({
    user,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    isTokenReady: tokenReady,
    isStorageReady,
    error,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    createIdentity,
    importIdentity,
    signIn,
    hasIdentity,
    getPublicKey,
    isIdentitySynced,
    syncIdentity,
    deleteIdentityAndClearAccount,
    identitySyncState: {
      isSynced: isIdentitySyncedStore ?? true,
      isSyncing: isSyncing ?? false,
    },
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
    createIdentity,
    importIdentity,
    signIn,
    hasIdentity,
    getPublicKey,
    isIdentitySynced,
    syncIdentity,
    deleteIdentityAndClearAccount,
    isIdentitySyncedStore,
    isSyncing,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    error,
    getDeviceSessions,
    isAuthenticated,
    isLoading,
    logout,
    logoutAll,
    logoutAllDeviceSessions,
    oxyServices,
    refreshSessionsWithUser,
    sessions,
    setLanguage,
    switchSessionForContext,
    tokenReady,
    isStorageReady,
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


