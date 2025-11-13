import type React from 'react';
import { createContext, useContext, useEffect, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { UseFollowHook } from '../hooks/useFollow.types';
import { OxyServices } from '../../core';
import type { User, ApiError } from '../../models/interfaces';
import type { SessionLoginResponse, ClientSession, MinimalUserData } from '../../models/session';
import { DeviceManager } from '../../utils/deviceManager';
import { useSessionSocket } from '../hooks/useSessionSocket';
import { toast } from '../../lib/sonner';
import { useAuthStore } from '../stores/authStore';
import type { BottomSheetController } from '../navigation/types';
import type { RouteName } from '../navigation/routes';

// Define the context shape
// NOTE: We intentionally avoid importing useFollow here to prevent a require cycle.
// If consumers relied on `const { useFollow } = useOxy()`, we provide a lazy proxy below.

export interface OxyContextState {
  // Authentication state
  user: User | null; // Current active user (loaded from server)
  minimalUser: MinimalUserData | null; // Minimal user data for UI
  sessions: ClientSession[]; // All active sessions
  activeSessionId: string | null;
  isAuthenticated: boolean; // Single source of truth for authentication - use this instead of service methods
  isLoading: boolean;
  isTokenReady: boolean; // Whether the token has been loaded/restored and is ready for use
  error: string | null;

  // Language state
  currentLanguage: string;

  // Auth methods
  login: (username: string, password: string, deviceName?: string) => Promise<User>;
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<User>;
  completeMfaLogin?: (mfaToken: string, code: string) => Promise<User>;

  // Multi-session methods
  switchSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;

  // Language methods
  setLanguage: (languageId: string) => Promise<void>;

  // Device management methods
  getDeviceSessions: () => Promise<any[]>;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;

  // Access to services
  oxyServices: OxyServices;
  bottomSheetRef?: React.RefObject<BottomSheetController | null>;

  // Methods to directly control the bottom sheet
  showBottomSheet?: (screenOrConfig?: RouteName | string | { screen: RouteName | string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;

  /**
   * (Deprecated) useFollow hook access via context. Prefer: import { useFollow } from '@oxyhq/services';
   * Kept for backward compatibility; implemented as a lazy dynamic require to avoid circular dependency.
   */
  useFollow: UseFollowHook; // Back-compat; prefer direct import
}

// Empty follow hook fallback
const createEmptyFollowHook = (): UseFollowHook => {
  const emptyResult = {
    isFollowing: false,
    isLoading: false,
    error: null,
    toggleFollow: async () => { },
    setFollowStatus: () => { },
    fetchStatus: async () => { },
    clearError: () => { },
    followerCount: null,
    followingCount: null,
    isLoadingCounts: false,
    fetchUserCounts: async () => { },
    setFollowerCount: () => { },
    setFollowingCount: () => { },
  };
  return () => emptyResult;
};

// Create the context with default values
const OxyContext = createContext<OxyContextState | null>(null);

// Props for the OxyContextProvider
export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices?: OxyServices; // Now optional - will be created automatically if not provided
  baseURL?: string; // New: API base URL for automatic service creation
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
  onError?: (error: ApiError) => void; // New: Error callback
  bottomSheetRef?: React.RefObject<BottomSheetController | null>;
}

// Platform storage implementation
interface StorageInterface {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  clear: () => Promise<void>;
}

// Web localStorage implementation
class WebStorage implements StorageInterface {
  async getItem(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    localStorage.clear();
  }
}

// React Native AsyncStorage implementation
let AsyncStorage: StorageInterface;

// Determine the platform and set up storage
const isReactNative = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
};

// Get appropriate storage for the platform
const getStorage = async (): Promise<StorageInterface> => {
  if (isReactNative()) {
    if (!AsyncStorage) {
      try {
        const asyncStorageModule = await import('@react-native-async-storage/async-storage');
        AsyncStorage = (asyncStorageModule.default as unknown) as StorageInterface;
      } catch (error) {
        console.error('Failed to import AsyncStorage:', error);
        throw new Error('AsyncStorage is required in React Native environment');
      }
    }
    return AsyncStorage;
  }

  return new WebStorage();
};

// Storage keys for sessions
const getStorageKeys = (prefix = 'oxy_session') => ({
  activeSessionId: `${prefix}_active_session_id`, // Only store the active session ID
  language: `${prefix}_language`, // Store the selected language
});

export const OxyProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices: providedOxyServices,
  baseURL,
  storageKeyPrefix = 'oxy_session',
  onAuthStateChange,
  onError,
  bottomSheetRef,
}) => {
  // Create oxyServices automatically if not provided
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

  // Zustand state
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);
  const loginSuccess = useAuthStore((state) => state.loginSuccess);
  const loginFailure = useAuthStore((state) => state.loginFailure);
  const logoutStore = useAuthStore((state) => state.logout);

  // Local state for non-auth fields
  const [minimalUser, setMinimalUser] = useState<MinimalUserData | null>(null);
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInterface | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState<string>('en-US');

  // Storage keys (memoized to prevent infinite loops) - declared early for use in helpers
  const keys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  // Normalize language codes to BCP-47 (e.g., en-US)
  const normalizeLanguageCode = useCallback((lang?: string | null): string | null => {
    if (!lang) return null;
    if (lang.includes('-')) return lang;
    const map: Record<string, string> = {
      en: 'en-US', es: 'es-ES', ca: 'ca-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT',
      ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA'
    };
    return map[lang] || lang;
  }, []);

  // Helper to apply language preference from user/server
  const applyLanguagePreference = useCallback(async (user: User): Promise<void> => {
    const userLanguage = (user as Record<string, unknown>)?.language as string | undefined;
    if (!userLanguage || !storage) return;

    try {
      const serverLang = normalizeLanguageCode(userLanguage) || userLanguage;
      await storage.setItem(keys.language, serverLang);
      setCurrentLanguage(serverLang);
    } catch (e) {
      if (__DEV__) {
        console.warn('Failed to apply server language preference', e);
      }
    }
  }, [storage, keys.language, normalizeLanguageCode]);

  // Helper to map server sessions to client sessions
  const mapServerSessionsToClient = useCallback((serverSessions: Array<{
    sessionId: string;
    deviceId: string;
    expiresAt?: string;
    lastActive?: string;
    userId?: string;
  }>, fallbackUserId?: string): ClientSession[] => {
    return serverSessions.map(s => ({
      sessionId: s.sessionId,
      deviceId: s.deviceId,
      expiresAt: s.expiresAt || new Date().toISOString(),
      lastActive: s.lastActive || new Date().toISOString(),
      userId: s.userId || fallbackUserId
    }));
  }, []);

  // Token ready state - start optimistically so children render immediately
  const [tokenReady, setTokenReady] = useState(true);

  // Clear all storage
  const clearAllStorage = useCallback(async (): Promise<void> => {
    if (!storage) return;
    try {
      await storage.removeItem(keys.activeSessionId);
    } catch (err) {
      if (__DEV__) {
        console.error('Clear storage error:', err);
      }
      onError?.({ message: 'Failed to clear storage', code: 'STORAGE_ERROR', status: 500 });
    }
  }, [storage, keys, onError]);

  // Initialize storage
  useEffect(() => {
    const initStorage = async () => {
      try {
        const platformStorage = await getStorage();
        setStorage(platformStorage);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to initialize storage';
        useAuthStore.setState({ error: errorMessage });
        onError?.({ message: errorMessage, code: 'STORAGE_INIT_ERROR', status: 500 });
      }
    };
    initStorage();
  }, [onError]);

  // Initialize authentication state
  // Note: We don't set isLoading during initialization to avoid showing spinners
  // Children render immediately and can check isTokenReady/isAuthenticated themselves
  useEffect(() => {
    const initAuth = async () => {
      if (!storage) return;
      // Don't set isLoading during initialization - let it happen in background
      try {
        // Load saved language preference
        const savedLanguageRaw = await storage.getItem(keys.language);
        const savedLanguage = normalizeLanguageCode(savedLanguageRaw) || savedLanguageRaw;
        if (savedLanguage) {
          setCurrentLanguage(savedLanguage);
        }

        // Try to restore active session from storage
        const storedActiveSessionId = await storage.getItem(keys.activeSessionId);
        if (storedActiveSessionId) {
          try {
            const validation = await oxyServices.validateSession(storedActiveSessionId, { useHeaderValidation: true });
            if (validation.valid) {
              setActiveSessionId(storedActiveSessionId);
              await oxyServices.getTokenBySession(storedActiveSessionId);
              const fullUser = await oxyServices.getUserBySession(storedActiveSessionId);
              loginSuccess(fullUser);
              setMinimalUser({ id: fullUser.id, username: fullUser.username, avatar: fullUser.avatar });

              await applyLanguagePreference(fullUser);

              const serverSessions = await oxyServices.getSessionsBySessionId(storedActiveSessionId);
              setSessions(mapServerSessionsToClient(serverSessions, fullUser.id));
              onAuthStateChange?.(fullUser);
            } else {
              await clearAllStorage();
            }
          } catch (e) {
            if (__DEV__) {
              console.error('Session validation error', e);
            }
            await clearAllStorage();
          }
        }
        setTokenReady(true);
      } catch (e) {
        if (__DEV__) {
          console.error('Auth init error', e);
        }
        await clearAllStorage();
        setTokenReady(true);
      }
    };
    initAuth();
  }, [storage, oxyServices, keys, onAuthStateChange, loginSuccess, clearAllStorage, applyLanguagePreference, mapServerSessionsToClient]);

  // Save active session ID to storage (only session ID, no user data)
  const saveActiveSessionId = useCallback(async (sessionId: string): Promise<void> => {
    if (!storage) return;
    await storage.setItem(keys.activeSessionId, sessionId);
  }, [storage, keys.activeSessionId]);

  // Switch to a different session
  const switchToSession = useCallback(async (sessionId: string): Promise<void> => {
    try {
      // Don't set isLoading - session switches should happen silently in background
      // Get access token for this session
      await oxyServices.getTokenBySession(sessionId);
      setTokenReady(true);

      // Load full user data
      const fullUser = await oxyServices.getUserBySession(sessionId);

      setActiveSessionId(sessionId);
      loginSuccess(fullUser);
      setMinimalUser({
        id: fullUser.id,
        username: fullUser.username,
        avatar: fullUser.avatar
      });

      await saveActiveSessionId(sessionId);
      await applyLanguagePreference(fullUser);
      onAuthStateChange?.(fullUser);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to switch session';
      if (__DEV__) {
        console.error('Switch session error:', error);
      }
      useAuthStore.setState({ error: errorMessage });
      onError?.({ message: errorMessage, code: 'SESSION_SWITCH_ERROR', status: 500 });
      setTokenReady(false);
    }
  }, [oxyServices, onAuthStateChange, loginSuccess, saveActiveSessionId, applyLanguagePreference, onError]);

  // Login method - only store session ID, retrieve data from backend
  const login = useCallback(async (username: string, password: string, deviceName?: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');
    useAuthStore.setState({ isLoading: true, error: null });

    try {
      const deviceFingerprint = DeviceManager.getDeviceFingerprint();
      const deviceInfo = await DeviceManager.getDeviceInfo();

      const response = await oxyServices.signIn(
        username,
        password,
        deviceName || deviceInfo.deviceName || DeviceManager.getDefaultDeviceName(),
        deviceFingerprint
      );

      // Handle MFA requirement
      if (response && 'mfaRequired' in response && response.mfaRequired) {
        const mfaError = new Error('Multi-factor authentication required') as Error & {
          code: string;
          mfaToken?: string;
          expiresAt?: string;
        };
        mfaError.code = 'MFA_REQUIRED';
        mfaError.mfaToken = (response as { mfaToken?: string }).mfaToken;
        mfaError.expiresAt = (response as { expiresAt?: string }).expiresAt;
        throw mfaError;
      }

      const sessionResponse = response as SessionLoginResponse;
      setActiveSessionId(sessionResponse.sessionId);
      await saveActiveSessionId(sessionResponse.sessionId);

      await oxyServices.getTokenBySession(sessionResponse.sessionId);
      const fullUser = await oxyServices.getUserBySession(sessionResponse.sessionId);

      loginSuccess(fullUser);
      setMinimalUser(sessionResponse.user);

      const serverSessions = await oxyServices.getSessionsBySessionId(sessionResponse.sessionId);
      setSessions(mapServerSessionsToClient(serverSessions, fullUser.id));

      onAuthStateChange?.(fullUser);
      return fullUser;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      loginFailure(errorMessage);
      onError?.({ message: errorMessage, code: 'LOGIN_ERROR', status: 401 });
      throw error;
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  }, [storage, oxyServices, saveActiveSessionId, loginSuccess, onAuthStateChange, loginFailure, mapServerSessionsToClient, onError]);

  // Logout method
  const logout = useCallback(async (targetSessionId?: string): Promise<void> => {
    if (!activeSessionId) return;

    try {
      const sessionToLogout = targetSessionId || activeSessionId;
      await oxyServices.logoutSession(activeSessionId, sessionToLogout);

      // Remove session from local state
      const filteredSessions = sessions.filter(s => s.sessionId !== sessionToLogout);
      setSessions(filteredSessions);

      // If logging out active session
      if (sessionToLogout === activeSessionId) {
        if (filteredSessions.length > 0) {
          // Switch to another session
          await switchToSession(filteredSessions[0].sessionId);
        } else {
          // No sessions left
          setActiveSessionId(null);
          logoutStore();
          setMinimalUser(null);
          await storage?.removeItem(keys.activeSessionId);

          if (onAuthStateChange) {
            onAuthStateChange(null);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Logout failed';
      if (__DEV__) {
        console.error('Logout error:', error);
      }
      useAuthStore.setState({ error: errorMessage });
      onError?.({ message: errorMessage, code: 'LOGOUT_ERROR', status: 500 });
    }
  }, [activeSessionId, oxyServices, sessions, switchToSession, logoutStore, storage, keys.activeSessionId, onAuthStateChange, onError]);

  // Logout all sessions
  const logoutAll = useCallback(async (): Promise<void> => {
    if (!activeSessionId) {
      const error = new Error('No active session found');
      useAuthStore.setState({ error: error.message });
      onError?.({ message: error.message, code: 'NO_SESSION_ERROR', status: 404 });
      throw error;
    }

    try {
      await oxyServices.logoutAllSessions(activeSessionId);

      setSessions([]);
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await clearAllStorage();
      onAuthStateChange?.(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Logout all failed';
      useAuthStore.setState({ error: errorMessage });
      onError?.({ message: errorMessage, code: 'LOGOUT_ALL_ERROR', status: 500 });
      throw error;
    }
  }, [activeSessionId, oxyServices, logoutStore, clearAllStorage, onAuthStateChange, onError]);

  // Token restoration is handled in initAuth and switchToSession
  // No separate effect needed - children render immediately with isTokenReady available

  // Sign up method
  const signUp = useCallback(async (username: string, email: string, password: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');

    useAuthStore.setState({ isLoading: true, error: null });

    try {
      await oxyServices.signUp(username, email, password);
      const user = await login(username, password);
      return user;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sign up failed';
      loginFailure(errorMessage);
      onError?.({ message: errorMessage, code: 'SIGNUP_ERROR', status: 400 });
      throw error;
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  }, [storage, oxyServices, login, loginFailure, onError]);

  // Complete MFA login by verifying TOTP
  const completeMfaLogin = useCallback(async (mfaToken: string, code: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');
    useAuthStore.setState({ isLoading: true, error: null });
    try {
      const response = await oxyServices.verifyTotpLogin(mfaToken, code);

      // Set as active session
      setActiveSessionId(response.sessionId);
      await saveActiveSessionId(response.sessionId);

      // Fetch access token and user data
      await oxyServices.getTokenBySession(response.sessionId);
      const fullUser = await oxyServices.getUserBySession(response.sessionId);

      loginSuccess(fullUser);
      setMinimalUser({ id: fullUser.id, username: fullUser.username, avatar: fullUser.avatar });
      await applyLanguagePreference(fullUser);

      const serverSessions = await oxyServices.getSessionsBySessionId(response.sessionId);
      setSessions(mapServerSessionsToClient(serverSessions, fullUser.id));

      onAuthStateChange?.(fullUser);
      return fullUser;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'MFA verification failed';
      loginFailure(errorMessage);
      onError?.({ message: errorMessage, code: 'MFA_ERROR', status: 401 });
      throw error;
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  }, [storage, oxyServices, loginSuccess, loginFailure, saveActiveSessionId, onAuthStateChange, applyLanguagePreference, mapServerSessionsToClient, onError]);

  // Switch session method (wrapper for consistency)
  const switchSession = useCallback(async (sessionId: string): Promise<void> => {
    await switchToSession(sessionId);
  }, [switchToSession]);

  // Remove session method (wrapper for consistency)
  const removeSession = useCallback(async (sessionId: string): Promise<void> => {
    await logout(sessionId);
  }, [logout]);

  // Refresh sessions method
  const refreshSessions = useCallback(async (): Promise<void> => {
    if (!activeSessionId) return;

    try {
      const serverSessions = await oxyServices.getSessionsBySessionId(activeSessionId);
      setSessions(mapServerSessionsToClient(serverSessions, user?.id));
    } catch (error) {
      if (__DEV__) {
        console.error('Refresh sessions error:', error);
      }

      // If the current session is invalid, try to find another valid session
      if (sessions.length > 1) {
        const otherSessions = sessions.filter(s => s.sessionId !== activeSessionId);

        for (const session of otherSessions) {
          try {
            const validation = await oxyServices.validateSession(session.sessionId, {
              useHeaderValidation: true
            });
            if (validation.valid) {
              await switchToSession(session.sessionId);
              return;
            }
          } catch {
            continue;
          }
        }
      }

      // No valid sessions found, clear all
      setSessions([]);
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await clearAllStorage();
      onAuthStateChange?.(null);
    }
  }, [activeSessionId, oxyServices, user?.id, sessions, switchToSession, logoutStore, clearAllStorage, onAuthStateChange, mapServerSessionsToClient]);

  // Device management methods
  const getDeviceSessions = useCallback(async (): Promise<Array<{
    sessionId: string;
    deviceId: string;
    deviceName?: string;
    lastActive?: string;
    expiresAt?: string;
  }>> => {
    if (!activeSessionId) throw new Error('No active session');
    try {
      return await oxyServices.getDeviceSessions(activeSessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get device sessions';
      onError?.({ message: errorMessage, code: 'GET_DEVICE_SESSIONS_ERROR', status: 500 });
      throw error;
    }
  }, [activeSessionId, oxyServices, onError]);

  const logoutAllDeviceSessions = useCallback(async (): Promise<void> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      await oxyServices.logoutAllDeviceSessions(activeSessionId);
      setSessions([]);
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await clearAllStorage();
      onAuthStateChange?.(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to logout all device sessions';
      onError?.({ message: errorMessage, code: 'LOGOUT_ALL_DEVICES_ERROR', status: 500 });
      throw error;
    }
  }, [activeSessionId, oxyServices, logoutStore, clearAllStorage, onAuthStateChange, onError]);

  const updateDeviceName = useCallback(async (deviceName: string): Promise<void> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      await oxyServices.updateDeviceName(activeSessionId, deviceName);
      await DeviceManager.updateDeviceName(deviceName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update device name';
      onError?.({ message: errorMessage, code: 'UPDATE_DEVICE_NAME_ERROR', status: 500 });
      throw error;
    }
  }, [activeSessionId, oxyServices, onError]);

  // Language management method
  const setLanguage = useCallback(async (languageId: string): Promise<void> => {
    if (!storage) throw new Error('Storage not initialized');

    try {
      await storage.setItem(keys.language, languageId);
      setCurrentLanguage(languageId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save language preference';
      onError?.({ message: errorMessage, code: 'LANGUAGE_SAVE_ERROR', status: 500 });
      throw error;
    }
  }, [storage, keys.language, onError]);

  // Bottom sheet control methods
  const showBottomSheet = useCallback((screenOrConfig?: RouteName | string | { screen: RouteName | string; props?: Record<string, any> }) => {
    if (__DEV__) console.log('showBottomSheet called with:', screenOrConfig);

    if (bottomSheetRef?.current) {
      if (__DEV__) console.log('bottomSheetRef is available');

      // First, show the bottom sheet
      if (bottomSheetRef.current.expand) {
        if (__DEV__) console.log('Expanding bottom sheet');
        bottomSheetRef.current.expand();
      } else if (bottomSheetRef.current.present) {
        if (__DEV__) console.log('Presenting bottom sheet');
        bottomSheetRef.current.present();
      } else if (__DEV__) {
        console.warn('No expand or present method available on bottomSheetRef');
      }

      // Then navigate to the specified screen if provided
      if (screenOrConfig) {
        // Add a small delay to ensure the bottom sheet is opened first
        setTimeout(() => {
          if (typeof screenOrConfig === 'string') {
            // Simple screen name
            if (__DEV__) console.log('Navigating to screen:', screenOrConfig);
            bottomSheetRef.current?.navigate?.(screenOrConfig);
          } else {
            // Screen with props
            if (__DEV__) console.log('Navigating to screen with props:', screenOrConfig.screen, screenOrConfig.props);
            bottomSheetRef.current?.navigate?.(screenOrConfig.screen, screenOrConfig.props);
          }
        }, 100);
      }
    } else if (__DEV__) {
      console.warn('bottomSheetRef is not available. Pass a bottomSheetRef to OxyProvider.');
    }
  }, [bottomSheetRef]);

  const hideBottomSheet = useCallback(() => {
    if (bottomSheetRef?.current) {
      bottomSheetRef.current.dismiss?.();
    }
  }, [bottomSheetRef]);

  // Integrate socket for real-time session updates
  useSessionSocket({
    userId: user?.id,
    activeSessionId,
    refreshSessions,
    logout,
    baseURL: oxyServices.getBaseURL(),
    onRemoteSignOut: useCallback(() => {
      toast.info('You have been signed out remotely.');
      logout();
    }, [logout]),
  });

  // Context value - optimized to prevent unnecessary re-renders
  // Lazy proxy to load the hook only when accessed, breaking the static import cycle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  const useFollowProxy: UseFollowHook = (userId?: string | string[]) => {
    try {
      // Dynamically require to avoid top-level cycle
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('../hooks/useFollow');
      if (mod && typeof mod.useFollow === 'function') {
        return mod.useFollow(userId);
      }
      if (__DEV__) {
        console.warn('useFollow module did not export a function as expected');
      }
      return createEmptyFollowHook()(userId);
    } catch (e) {
      if (__DEV__) {
        console.warn('Failed to dynamically load useFollow hook:', e);
      }
      return createEmptyFollowHook()(userId);
    }
  };

  const contextValue: OxyContextState = useMemo(() => ({
    user,
    minimalUser,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    isTokenReady: tokenReady,
    error,
    currentLanguage,
    login,
    logout,
    logoutAll,
    signUp,
    completeMfaLogin,
    switchSession,
    removeSession,
    refreshSessions,
    setLanguage,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    oxyServices,
    bottomSheetRef,
    showBottomSheet,
    hideBottomSheet,
    useFollow: useFollowProxy,
  }), [
    user?.id, // Only depend on user ID, not the entire user object
    minimalUser?.id,
    sessions.length, // Only depend on sessions count, not the entire array
    activeSessionId,
    isAuthenticated,
    isLoading,
    tokenReady,
    error,
    currentLanguage,
    login,
    logout,
    logoutAll,
    signUp,
    completeMfaLogin,
    switchSession,
    removeSession,
    refreshSessions,
    setLanguage,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    oxyServices,
    bottomSheetRef,
    showBottomSheet,
    hideBottomSheet,
  ]);

  // Always render children - let the consuming app decide how to handle token loading state
  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

// Alias for backward compatibility
export const OxyContextProvider = OxyProvider;

// Hook to use the context
export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxy must be used within an OxyContextProvider');
  }
  return context;
};

export default OxyContext;

