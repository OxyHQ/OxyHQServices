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
import { Platform } from 'react-native';
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
import { isInvalidSessionError, isTimeoutOrNetworkError } from '../utils/errorHandlers';
import type { RouteName } from '../navigation/routes';
import { showBottomSheet as globalShowBottomSheet } from '../navigation/bottomSheetManager';
import { useQueryClient } from '@tanstack/react-query';
import { clearQueryCache } from '../hooks/queryClient';
import { KeyManager, type BackupData } from '../../crypto';
import { translate } from '../../i18n';
import { updateAvatarVisibility, updateProfileWithAvatar } from '../utils/avatarUtils';
import { useAccountStore } from '../stores/accountStore';
import { logger as loggerUtil } from '../../utils/loggerUtils';
import { useTransferStore, useTransferCodesForPersistence } from '../stores/transferStore';
import { useCheckPendingTransfers } from '../hooks/useTransferQueries';

export interface OxyContextState {
  user: User | null;
  sessions: ClientSession[];
  activeSessionId: string | null;
  currentDeviceId: string | null;
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
  createIdentity: () => Promise<{ synced: boolean }>;
  importIdentity: (backupData: BackupData, password: string) => Promise<{ synced: boolean }>;
  signIn: (deviceName?: string) => Promise<User>;
  hasIdentity: () => Promise<boolean>;
  getPublicKey: () => Promise<string | null>;
  isIdentitySynced: () => Promise<boolean>;
  syncIdentity: () => Promise<User>;
  deleteIdentityAndClearAccount: (skipBackup?: boolean, force?: boolean, userConfirmed?: boolean) => Promise<void>;
  storeTransferCode: (transferId: string, code: string, sourceDeviceId: string | null, publicKey: string) => Promise<void>;
  getTransferCode: (transferId: string) => { code: string; sourceDeviceId: string | null; publicKey: string; timestamp: number; state: 'pending' | 'completed' | 'failed' } | null;
  clearTransferCode: (transferId: string) => Promise<void>;
  getAllPendingTransfers: () => Array<{ transferId: string; data: { code: string; sourceDeviceId: string | null; publicKey: string; timestamp: number; state: 'pending' | 'completed' | 'failed' } }>;
  getActiveTransferId: () => string | null;
  updateTransferState: (transferId: string, state: 'pending' | 'completed' | 'failed') => Promise<void>;

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
    isAuthenticated: isAuthenticatedFromStore,
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
      if (err !== undefined) {
        console.warn(`[OxyContext] ${message}`, err);
      } else {
        console.warn(`[OxyContext] ${message}`);
      }
    }
  }, []);

  const storageKeys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  const { storage, isReady: isStorageReady } = useStorage({ onError, logger });

  // Identity integrity check and auto-restore on startup
  // Skip on web platform - identity storage is only available on native platforms
  useEffect(() => {
    if (!storage || !isStorageReady) return;
    if (Platform.OS === 'web') return; // Identity operations are native-only

    const checkAndRestoreIdentity = async () => {
      try {
        // CRITICAL: Invalidate cache on app startup to ensure fresh state check
        // This prevents stale cache from previous session from showing incorrect state
        KeyManager.invalidateCache();
        
        // Check if identity exists and verify integrity
        const hasIdentity = await KeyManager.hasIdentity();
        if (hasIdentity) {
          const isValid = await KeyManager.verifyIdentityIntegrity();
          if (!isValid) {
            // Try to restore from backup (cache will be invalidated inside restoreIdentityFromBackup)
            const restored = await KeyManager.restoreIdentityFromBackup();
            if (__DEV__) {
              logger(restored
                ? 'Identity restored from backup successfully'
                : 'Identity integrity check failed - user may need to restore from backup file'
              );
            }
          } else {
            // Identity is valid - ensure backup is up to date
            await KeyManager.backupIdentity();
          }
        } else {
          // No identity - try to restore from backup (cache will be invalidated inside restoreIdentityFromBackup)
          const restored = await KeyManager.restoreIdentityFromBackup();
          if (restored && __DEV__) {
            logger('Identity restored from backup on startup');
          }
        }
      } catch (error) {
        if (__DEV__) {
          logger('Error during identity integrity check', error);
        }
        // Don't block app startup - user can recover with backup file
      }
    };

    checkAndRestoreIdentity();
  }, [storage, isStorageReady, logger]);

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
    setActiveSessionId: setActiveSessionIdFromHook,
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
    importIdentity: importIdentityBase,
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
    setActiveSessionId: setActiveSessionIdFromHook,
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
  const syncIdentity = useCallback(() => syncIdentityBase(), [syncIdentityBase]);

  // Wrapper for importIdentity to handle legacy calls gracefully
  const importIdentity = useCallback(
    async (backupData: BackupData | string, password?: string): Promise<{ synced: boolean }> => {
      // Handle legacy calls with single string argument (old recovery phrase signature)
      if (typeof backupData === 'string') {
        throw new Error('Recovery phrase import is no longer supported. Please use backup file import or QR code transfer instead.');
      }

      // Validate that password is provided
      if (!password || typeof password !== 'string') {
        throw new Error('Password is required for backup file import.');
      }

      return importIdentityBase(backupData, password);
    },
    [importIdentityBase]
  );

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
        logger('Failed to clear persisted query cache', error);
      }
    }

    // Clear session state (sessions, activeSessionId, storage)
    await clearSessionState();

    // Clear identity sync state from storage
    if (storage) {
      try {
        await storage.removeItem('oxy_identity_synced');
      } catch (error) {
        logger('Failed to clear identity sync state', error);
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

  // Extract Zustand store functions early (before they're used in callbacks)
  const getAllPendingTransfersStore = useTransferStore((state) => state.getAllPendingTransfers);
  const getActiveTransferIdStore = useTransferStore((state) => state.getActiveTransferId);
  const storeTransferCodeStore = useTransferStore((state) => state.storeTransferCode);
  const getTransferCodeStore = useTransferStore((state) => state.getTransferCode);
  const updateTransferStateStore = useTransferStore((state) => state.updateTransferState);
  const clearTransferCodeStore = useTransferStore((state) => state.clearTransferCode);

  // Transfer code management functions (must be defined before deleteIdentityAndClearAccount)
  const getAllPendingTransfers = useCallback(() => {
    return getAllPendingTransfersStore();
  }, [getAllPendingTransfersStore]);

  const getActiveTransferId = useCallback(() => {
    return getActiveTransferIdStore();
  }, [getActiveTransferIdStore]);

  // Delete identity and clear all account data
  // In accounts app, deleting identity means losing the account completely
  const deleteIdentityAndClearAccount = useCallback(async (
    skipBackup: boolean = false,
    force: boolean = false,
    userConfirmed: boolean = false
  ): Promise<void> => {
    // CRITICAL: Check for active transfers before deletion (unless force is true)
    // This prevents accidental identity loss during transfer
    if (!force) {
      const pendingTransfers = getAllPendingTransfers();
      if (pendingTransfers.length > 0) {
        const activeTransferId = getActiveTransferId();
        const hasActiveTransfer = activeTransferId && pendingTransfers.some((t: { transferId: string; data: any }) => t.transferId === activeTransferId);
        
        if (hasActiveTransfer) {
          throw new Error(
            'Cannot delete identity: An active identity transfer is in progress. ' +
            'Please wait for the transfer to complete or cancel it first. ' +
            'If you proceed, you may lose access to your identity permanently.'
          );
        }
      }
    }

    // First, clear all account data
    await clearAllAccountData();

    // Then delete the identity keys
    await KeyManager.deleteIdentity(skipBackup, force, userConfirmed);
  }, [clearAllAccountData, getAllPendingTransfers, getActiveTransferId]);

  // Network reconnect sync - TanStack Query automatically retries mutations on reconnect
  // We only need to sync identity if it's not synced
  useEffect(() => {
    if (!storage) return;

    let wasOffline = false;
    let checkTimeout: NodeJS.Timeout | null = null;
    let lastReconnectionLog = 0;
    const RECONNECTION_LOG_DEBOUNCE_MS = 5000; // 5 seconds

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
          const now = Date.now();
          const timeSinceLastLog = now - lastReconnectionLog;
          
          if (timeSinceLastLog >= RECONNECTION_LOG_DEBOUNCE_MS) {
            logger('Network reconnected, checking identity sync...');
            lastReconnectionLog = now;
            
            // Sync identity first (if not synced)
            try {
              const hasIdentityValue = await hasIdentity();
              if (hasIdentityValue) {
                // Check sync status directly - sync if not explicitly 'true'
                // undefined = not synced yet, 'false' = explicitly not synced, 'true' = synced
                const syncStatus = await storage.getItem('oxy_identity_synced');
                if (syncStatus !== 'true') {
                  await syncIdentity();
                }
              }
            } catch (syncError: any) {
              // Skip sync silently if username is required (expected when offline onboarding)
              if (syncError?.code === 'USERNAME_REQUIRED' || syncError?.message === 'USERNAME_REQUIRED') {
                if (__DEV__) {
                  loggerUtil.debug('Sync skipped - username required', { component: 'OxyContext', method: 'checkNetworkAndSync' }, syncError as unknown);
                }
                // Don't log or show error - username will be set later
              } else if (!isTimeoutOrNetworkError(syncError)) {
                // Only log unexpected errors - timeouts/network issues are expected when offline
                logger('Error syncing identity on reconnect', syncError);
              } else if (__DEV__) {
                loggerUtil.debug('Identity sync timeout (expected when offline)', { component: 'OxyContext', method: 'checkNetworkAndSync' }, syncError as unknown);
              }
            }

            // Check for pending transfers that may have completed while offline
            // This is handled by useCheckPendingTransfers hook which runs automatically
            // when authenticated and online
          }
          
          // TanStack Query will automatically retry pending mutations
          // Reset flag immediately after processing (whether logged or not)
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
  }, [oxyServices, storage, syncIdentity, logger, hasIdentity]);

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
      // CRITICAL: Get current identity's public key first
      // Only restore sessions that belong to this identity
      const currentPublicKey = await KeyManager.getPublicKey().catch(() => null);
      
      const storedSessionIdsJson = await storage.getItem(storageKeys.sessionIds);
      const storedSessionIds: string[] = storedSessionIdsJson ? JSON.parse(storedSessionIdsJson) : [];
      const storedActiveSessionId = await storage.getItem(storageKeys.activeSessionId);

      // If no identity exists, clear all sessions and return
      if (!currentPublicKey) {
        if (storedSessionIds.length > 0 || storedActiveSessionId) {
          await clearSessionState();
        }
        setTokenReady(true);
        return;
      }

      const validSessions: ClientSession[] = [];

      if (storedSessionIds.length > 0) {
        for (const sessionId of storedSessionIds) {
          try {
            const validation = await oxyServices.validateSession(sessionId, { useHeaderValidation: true });
            if (validation?.valid && validation.user) {
              // CRITICAL: Verify session belongs to current identity
              // IMPORTANT: In OxyAccounts, user.id is set to the publicKey (as confirmed by line 754 comment below)
              // This is different from the JWT's userId field which contains MongoDB ObjectId
              // We compare user.id (publicKey) to currentPublicKey to ensure session ownership
              if (validation.user.id !== currentPublicKey) {
                // Session belongs to different identity - skip it
                if (__DEV__) {
                  logger('Skipping session from different identity during restoration');
                }
                continue;
              }
              
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
            // However, if we have valid sessions, we should still set activeSessionId
            // so that isAuthenticated can be computed correctly
            if (validSessions.length > 0) {
              const matchingSession = validSessions.find(s => s.sessionId === storedActiveSessionId);
              if (matchingSession) {
                // Set active session even if validation timed out (offline scenario)
                setActiveSessionIdFromHook(storedActiveSessionId);
                // Try to get user from session if possible (might fail offline, but that's OK)
                try {
                  const validation = await oxyServices.validateSession(storedActiveSessionId, { useHeaderValidation: false });
                  if (validation?.valid && validation.user) {
                    loginSuccess(validation.user);
                  }
                } catch {
                  // Ignore - we're offline, will sync when online
                }
              }
            }
            if (__DEV__) {
              loggerUtil.debug('Active session validation timeout (expected when offline)', { component: 'OxyContext', method: 'restoreSessionsFromStorage' }, switchError as unknown);
            }
          } else {
            // Only log unexpected errors
            logger('Active session validation error', switchError);
          }
        }
      } else if (validSessions.length > 0) {
        // No stored active session, but we have valid sessions - activate the first one
        const firstSession = validSessions[0];
        try {
          await switchSession(firstSession.sessionId);
        } catch (switchError) {
          // If switch fails, at least set the activeSessionId so UI can show sessions
          if (isTimeoutOrNetworkError(switchError)) {
            setActiveSessionIdFromHook(firstSession.sessionId);
            // Try to get user from session
            try {
              const validation = await oxyServices.validateSession(firstSession.sessionId, { useHeaderValidation: false });
              if (validation?.valid && validation.user) {
                loginSuccess(validation.user);
              }
            } catch {
              // Ignore - offline scenario
            }
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
    setActiveSessionIdFromHook,
    loginSuccess,
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

  // Compute isAuthenticated from actual session state, not just auth store
  // This ensures UI shows correct state even if loginSuccess wasn't called during restoration
  const isAuthenticatedFromSessions = useMemo(() => {
    return !!(activeSessionId && sessions.length > 0 && user);
  }, [activeSessionId, sessions.length, user]);

  // Use session-based authentication state if auth store says not authenticated but we have sessions
  // This handles the case where sessions were restored but loginSuccess wasn't called
  const computedIsAuthenticated = useMemo(() => {
    return isAuthenticatedFromStore || isAuthenticatedFromSessions;
  }, [isAuthenticatedFromStore, isAuthenticatedFromSessions]);

  // Get userId from JWT token (MongoDB ObjectId) for socket room matching
  // user.id is set to publicKey for compatibility, but socket rooms use MongoDB ObjectId
  // The JWT token's userId field contains the MongoDB ObjectId
  const userId = oxyServices.getCurrentUserId() || user?.id;

  // Use Zustand store for transfer state management
  const TRANSFER_CODES_STORAGE_KEY = `${storageKeyPrefix}_transfer_codes`;
  const ACTIVE_TRANSFER_STORAGE_KEY = `${storageKeyPrefix}_active_transfer_id`;
  const isRestored = useTransferStore((state) => state.isRestored);
  const restoreFromStorage = useTransferStore((state) => state.restoreFromStorage);
  const markRestored = useTransferStore((state) => state.markRestored);
  const cleanupExpired = useTransferStore((state) => state.cleanupExpired);

  // Load transfer codes from storage on startup (only once)
  useEffect(() => {
    if (!storage || !isStorageReady || isRestored) return;

    const loadTransferCodes = async () => {
      try {
        // Load transfer codes
        const storedCodes = await storage.getItem(TRANSFER_CODES_STORAGE_KEY);
        const storedActiveTransferId = await storage.getItem(ACTIVE_TRANSFER_STORAGE_KEY);
        
        const parsedCodes = storedCodes ? JSON.parse(storedCodes) : {};
        const activeTransferId = storedActiveTransferId || null;
        
        // Restore to Zustand store (store handles validation and expiration)
        restoreFromStorage(parsedCodes, activeTransferId);
        markRestored();
        
        if (__DEV__ && Object.keys(parsedCodes).length > 0) {
          logger('Restored transfer codes from storage', { 
            count: Object.keys(parsedCodes).length,
            hasActiveTransfer: !!activeTransferId,
          });
        }
      } catch (error) {
        if (__DEV__) {
          logger('Failed to load transfer codes from storage', error);
        }
        // Mark as restored even on error to prevent retries
        markRestored();
      }
    };

    loadTransferCodes();
  }, [storage, isStorageReady, isRestored, restoreFromStorage, markRestored, logger, storageKeyPrefix]);

  // Persist transfer codes to storage whenever store changes
  const { transferCodes, activeTransferId } = useTransferCodesForPersistence();
  useEffect(() => {
    if (!storage || !isStorageReady || !isRestored) return;

    const persistTransferCodes = async () => {
      try {
        await storage.setItem(TRANSFER_CODES_STORAGE_KEY, JSON.stringify(transferCodes));
        
        if (activeTransferId) {
          await storage.setItem(ACTIVE_TRANSFER_STORAGE_KEY, activeTransferId);
        } else {
          await storage.removeItem(ACTIVE_TRANSFER_STORAGE_KEY);
        }
      } catch (error) {
        if (__DEV__) {
          logger('Failed to persist transfer codes', error);
        }
      }
    };

    persistTransferCodes();
  }, [transferCodes, activeTransferId, storage, isStorageReady, isRestored, logger]);

  // Cleanup expired transfer codes (every minute)
  useEffect(() => {
    const cleanup = setInterval(() => {
      cleanupExpired();
    }, 60000); // Check every minute

    return () => clearInterval(cleanup);
  }, [cleanupExpired]);

  // Transfer code management functions using Zustand store
  const storeTransferCode = useCallback(async (transferId: string, code: string, sourceDeviceId: string | null, publicKey: string) => {
    storeTransferCodeStore(transferId, code, sourceDeviceId, publicKey);
    
    if (__DEV__) {
      logger('Stored transfer code', { transferId, sourceDeviceId, publicKey: publicKey.substring(0, 16) + '...' });
    }
  }, [logger, storeTransferCodeStore]);

  const getTransferCode = useCallback((transferId: string) => {
    return getTransferCodeStore(transferId);
  }, [getTransferCodeStore]);

  const updateTransferState = useCallback(async (transferId: string, state: 'pending' | 'completed' | 'failed') => {
    updateTransferStateStore(transferId, state);
    
    if (__DEV__) {
      logger('Updated transfer state', { transferId, state });
    }
  }, [logger, updateTransferStateStore]);

  const clearTransferCode = useCallback(async (transferId: string) => {
    clearTransferCodeStore(transferId);
    
    if (__DEV__) {
      logger('Cleared transfer code', { transferId });
    }
  }, [logger, clearTransferCodeStore]);

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

  // Check pending transfers when authenticated and online using TanStack Query
  // Check for pending transfers that may have completed while offline
  // Results are processed via socket events (onIdentityTransferComplete), so we don't need to process query results here
  useCheckPendingTransfers(oxyServices, computedIsAuthenticated);

  const handleIdentityTransferComplete = useCallback(
    async (data: { transferId: string; sourceDeviceId: string; publicKey: string; transferCode?: string; completedAt: string }) => {
      try {
        logger('Received identity transfer complete notification', {
          transferId: data.transferId,
          sourceDeviceId: data.sourceDeviceId,
          currentDeviceId,
          hasActiveSession: activeSessionId !== null,
          publicKey: data.publicKey.substring(0, 16) + '...',
        });

        const storedTransfer = getTransferCode(data.transferId);

        if (!storedTransfer) {
          logger('Transfer code not found for transferId', { 
            transferId: data.transferId,
          });
          toast.error('Transfer verification failed: Code not found. Identity will not be deleted.');
          return;
        }

        // Verify publicKey matches first (most important check)
        const publicKeyMatches = data.publicKey === storedTransfer.publicKey;
        if (!publicKeyMatches) {
          logger('Public key mismatch for transfer', {
            transferId: data.transferId,
            receivedPublicKey: data.publicKey.substring(0, 16) + '...',
            storedPublicKey: storedTransfer.publicKey.substring(0, 16) + '...',
          });
          toast.error('Transfer verification failed: Public key mismatch. Identity will not be deleted.');
          return;
        }

        // Verify deviceId matches - very lenient since publicKey is the critical check
        // If publicKey matches, we allow deletion even if deviceId doesn't match exactly
        // This handles cases where deviceId might not be available or slightly different
        const deviceIdMatches = 
          // Exact match
          (data.sourceDeviceId && data.sourceDeviceId === currentDeviceId) ||
          // Stored sourceDeviceId matches current deviceId
          (storedTransfer.sourceDeviceId && storedTransfer.sourceDeviceId === currentDeviceId);

        // If publicKey matches, we're very lenient with deviceId - only warn but don't block
        if (!deviceIdMatches && publicKeyMatches) {
          logger('Device ID mismatch for transfer, but publicKey matches - proceeding with deletion', {
            transferId: data.transferId,
            receivedDeviceId: data.sourceDeviceId,
            storedDeviceId: storedTransfer.sourceDeviceId,
            currentDeviceId,
            hasActiveSession: activeSessionId !== null,
          });
          // Proceed with deletion - publicKey match is the critical verification
        } else if (!deviceIdMatches && !publicKeyMatches) {
          // Both don't match - this is suspicious, block deletion
          logger('Device ID and publicKey mismatch for transfer', {
            transferId: data.transferId,
            receivedDeviceId: data.sourceDeviceId,
            currentDeviceId,
          });
          toast.error('Transfer verification failed: Device and key mismatch. Identity will not be deleted.');
          return;
        }

        // Verify transfer code matches (if provided)
        // Transfer code is optional - if not provided, we still proceed if publicKey matches
        if (data.transferCode) {
          const codeMatches = data.transferCode.toUpperCase() === storedTransfer.code.toUpperCase();
          if (!codeMatches) {
            logger('Transfer code mismatch, but publicKey matches - proceeding with deletion', {
              transferId: data.transferId,
              receivedCode: data.transferCode,
              storedCode: storedTransfer.code.substring(0, 2) + '****',
            });
            // Don't block - publicKey match is sufficient, code mismatch might be due to user error
            // Log warning but proceed
          }
        }

        // Check if transfer is too old (safety timeout - 10 minutes)
        const transferAge = Date.now() - storedTransfer.timestamp;
        const tenMinutes = 10 * 60 * 1000;
        if (transferAge > tenMinutes) {
          logger('Transfer confirmation received too late', {
            transferId: data.transferId,
            age: transferAge,
            ageMinutes: Math.round(transferAge / 60000),
          });
          toast.error('Transfer verification failed: Confirmation received too late. Identity will not be deleted.');
          clearTransferCode(data.transferId);
          return;
        }

        // NOTE: Target device verification already happened server-side when notifyTransferComplete was called
        // The server verified that the target device is authenticated and has the matching public key
        // Additional client-side verification is not necessary and would require source device authentication
        // which may not be available. The existing checks (public key match, transfer code, device ID) are sufficient.

        logger('All transfer verifications passed, deleting identity from source device', {
          transferId: data.transferId,
          sourceDeviceId: data.sourceDeviceId,
          publicKey: data.publicKey.substring(0, 16) + '...',
        });

        try {
          // Verify identity still exists before deletion (safety check)
          const identityStillExists = await KeyManager.hasIdentity();
          if (!identityStillExists) {
            logger('Identity already deleted - skipping deletion', {
              transferId: data.transferId,
            });
            await updateTransferState(data.transferId, 'completed');
            await clearTransferCode(data.transferId);
            return;
          }

          await deleteIdentityAndClearAccount(false, false, true);
          
          // Verify identity was actually deleted
          const identityDeleted = !(await KeyManager.hasIdentity());
          if (!identityDeleted) {
            logger('Identity deletion failed - identity still exists', {
              transferId: data.transferId,
            });
            await updateTransferState(data.transferId, 'failed');
            throw new Error('Identity deletion failed - identity still exists');
          }

          await updateTransferState(data.transferId, 'completed');
          await clearTransferCode(data.transferId);

          logger('Identity successfully deleted and transfer code cleared', {
            transferId: data.transferId,
          });

          toast.success('Identity successfully transferred and removed from this device');
        } catch (deleteError: any) {
          logger('Error during identity deletion', deleteError);
          await updateTransferState(data.transferId, 'failed');
          throw deleteError;
        }
      } catch (error: any) {
        logger('Failed to delete identity after transfer', error);
        toast.error(error?.message || 'Failed to remove identity from this device. Please try again manually from Security Settings.');
      }
    },
    [deleteIdentityAndClearAccount, logger, getTransferCode, clearTransferCode, updateTransferState, currentDeviceId, activeSessionId, oxyServices],
  );

  useSessionSocket({
    userId,
    activeSessionId,
    currentDeviceId,
    refreshSessions: refreshSessionsWithUser,
    logout,
    clearSessionState,
    baseURL: oxyServices.getBaseURL(),
    getAccessToken: () => oxyServices.getAccessToken(),
    getTransferCode: getTransferCode,
    onRemoteSignOut: handleRemoteSignOut,
    onSessionRemoved: handleSessionRemoved,
    onIdentityTransferComplete: handleIdentityTransferComplete,
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
            // Update file visibility to public for avatar
            await updateAvatarVisibility(file.id, oxyServices, 'OxyContext');

            // Update user profile (handles query invalidation and accountStore update)
            await updateProfileWithAvatar(
              { avatar: file.id },
              oxyServices,
              activeSessionId,
              queryClient,
              syncIdentity
            );

            toast.success(translate(currentLanguage, 'editProfile.toasts.avatarUpdated') || 'Avatar updated');
          } catch (e: any) {
            toast.error(e.message || translate(currentLanguage, 'editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
          }
        },
      },
    });
  }, [oxyServices, currentLanguage, showBottomSheetForContext, activeSessionId, queryClient, syncIdentity]);

  const contextValue: OxyContextState = useMemo(() => ({
    user,
    sessions,
    activeSessionId,
    currentDeviceId,
    isAuthenticated: computedIsAuthenticated,
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
    storeTransferCode,
    getTransferCode,
    clearTransferCode,
    getAllPendingTransfers,
    getActiveTransferId,
    updateTransferState,
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
    currentDeviceId,
    createIdentity,
    importIdentity,
    signIn,
    hasIdentity,
    getPublicKey,
    isIdentitySynced,
    syncIdentity,
    deleteIdentityAndClearAccount,
    storeTransferCode,
    getTransferCode,
    clearTransferCode,
    getAllPendingTransfers,
    getActiveTransferId,
    updateTransferState,
    isIdentitySyncedStore,
    isSyncing,
    currentLanguage,
    currentLanguageMetadata,
    currentLanguageName,
    currentNativeLanguageName,
    error,
    getDeviceSessions,
    computedIsAuthenticated,
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


