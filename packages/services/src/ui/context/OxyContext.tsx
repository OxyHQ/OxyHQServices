import React, { createContext, useContext, useEffect, useCallback, type ReactNode, useMemo, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { OxyServices } from '../../core';
import type { User, ApiError } from '../../models/interfaces';
import type { SessionLoginResponse, ClientSession, MinimalUserData } from '../../models/session';
import { DeviceManager } from '../../utils/deviceManager';
import { useSessionSocket } from '../hooks/useSessionSocket';
import { toast } from '../../lib/sonner';
import { useAuthStore } from '../stores/authStore';

// Define the context shape

import { useFollow as baseUseFollow } from '../hooks/useFollow';

export interface OxyContextState {
  // Authentication state
  user: User | null; // Current active user (loaded from server)
  minimalUser: MinimalUserData | null; // Minimal user data for UI
  sessions: ClientSession[]; // All active sessions
  activeSessionId: string | null;
  isAuthenticated: boolean; // Single source of truth for authentication - use this instead of service methods
  isLoading: boolean;
  error: string | null;

  // Auth methods
  login: (username: string, password: string, deviceName?: string) => Promise<User>;
  logout: (targetSessionId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
  signUp: (username: string, email: string, password: string) => Promise<User>;

  // Multi-session methods
  switchSession: (sessionId: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;

  // Device management methods
  getDeviceSessions: () => Promise<any[]>;
  logoutAllDeviceSessions: () => Promise<void>;
  updateDeviceName: (deviceName: string) => Promise<void>;

  // Access to services
  oxyServices: OxyServices;
  bottomSheetRef?: React.RefObject<any>;

  // Methods to directly control the bottom sheet
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;

  /**
   * useFollow hook, exposed for convenience so you can do const { useFollow } = useOxy();
   */
  useFollow: any;
}

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
  bottomSheetRef?: React.RefObject<any>;
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
  const [minimalUser, setMinimalUser] = React.useState<MinimalUserData | null>(null);
  const [sessions, setSessions] = React.useState<ClientSession[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [storage, setStorage] = React.useState<StorageInterface | null>(null);
  // Add a new state to track token restoration
  const [tokenReady, setTokenReady] = React.useState(false);

  // Storage keys (memoized to prevent infinite loops)
  const keys = useMemo(() => getStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

  // Clear all storage - defined before initAuth to avoid dependency issues
  const clearAllStorage = useCallback(async (): Promise<void> => {
    if (!storage) return;
    try {
      await storage.removeItem(keys.activeSessionId);
    } catch (err) {
      console.error('Clear storage error:', err);
    }
  }, [storage, keys]);

  // Initialize storage
  useEffect(() => {
    const initStorage = async () => {
      try {
        const platformStorage = await getStorage();
        setStorage(platformStorage);
      } catch (error) {
        console.error('Failed to initialize storage:', error);
        useAuthStore.setState({ error: 'Failed to initialize storage' });
      }
    };

    initStorage();
  }, []);

  // Effect to initialize authentication state - only store session ID
  useEffect(() => {
    const initAuth = async () => {
      if (!storage) return;

      useAuthStore.setState({ isLoading: true });
      try {
        // Only load the active session ID from storage
        const storedActiveSessionId = await storage.getItem(keys.activeSessionId);

        console.log('Auth - activeSessionId:', storedActiveSessionId);
        console.log('Auth - storage available:', !!storage);
        console.log('Auth - oxyServices available:', !!oxyServices);

        if (storedActiveSessionId) {
          // Validate the stored session with the backend
          try {
            const validation = await oxyServices.validateSession(storedActiveSessionId, {
              useHeaderValidation: true
            });

            if (validation.valid) {
              console.log('Auth - session validated successfully');
              setActiveSessionId(storedActiveSessionId);

              // Get access token for API calls
              await oxyServices.getTokenBySession(storedActiveSessionId);

              // Load full user data from backend
              const fullUser = await oxyServices.getUserBySession(storedActiveSessionId);
              loginSuccess(fullUser);
              setMinimalUser({
                id: fullUser.id,
                username: fullUser.username,
                avatar: fullUser.avatar
              });

              // Load sessions from backend
              const serverSessions = await oxyServices.getSessionsBySessionId(storedActiveSessionId);
              const clientSessions: ClientSession[] = serverSessions.map(serverSession => ({
                sessionId: serverSession.sessionId,
                deviceId: serverSession.deviceId,
                expiresAt: serverSession.expiresAt || new Date().toISOString(),
                lastActive: serverSession.lastActive || new Date().toISOString(),
                userId: serverSession.userId || fullUser.id
              }));
              setSessions(clientSessions);

              if (onAuthStateChange) {
                onAuthStateChange(fullUser);
              }
            } else {
              console.log('Auth - session invalid, clearing storage');
              await clearAllStorage();
            }
          } catch (error) {
            console.error('Auth - session validation error:', error);
            await clearAllStorage();
          }
        } else {
          console.log('Auth - no stored session found, user needs to login');
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        await clearAllStorage();
      } finally {
        useAuthStore.setState({ isLoading: false });
      }
    };

    if (storage) {
      initAuth();
    }
  }, [storage, oxyServices, keys, onAuthStateChange, loginSuccess, setMinimalUser, clearAllStorage]);



  // Remove invalid session - refresh sessions from backend
  const removeInvalidSession = useCallback(async (sessionId: string): Promise<void> => {
    // Remove from local state
    const filteredSessions = sessions.filter(s => s.sessionId !== sessionId);
    setSessions(filteredSessions);

    // If there are other sessions, switch to the first one
    if (filteredSessions.length > 0) {
      await switchToSession(filteredSessions[0].sessionId);
    } else {
      // No valid sessions left
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await storage?.removeItem(keys.activeSessionId);

      if (onAuthStateChange) {
        onAuthStateChange(null);
      }
    }
  }, [sessions, storage, keys, onAuthStateChange, logoutStore]);

  // Save active session ID to storage (only session ID, no user data)
  const saveActiveSessionId = useCallback(async (sessionId: string): Promise<void> => {
    if (!storage) return;
    await storage.setItem(keys.activeSessionId, sessionId);
  }, [storage, keys.activeSessionId]);

  // Switch to a different session
  const switchToSession = useCallback(async (sessionId: string): Promise<void> => {
    try {
      useAuthStore.setState({ isLoading: true });

      // Get access token for this session
      await oxyServices.getTokenBySession(sessionId);

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

      if (onAuthStateChange) {
        onAuthStateChange(fullUser);
      }
    } catch (error) {
      console.error('Switch session error:', error);
      useAuthStore.setState({ error: 'Failed to switch session' });
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  }, [oxyServices, onAuthStateChange, loginSuccess, saveActiveSessionId]);

  // Login method - only store session ID, retrieve data from backend
  const login = useCallback(async (username: string, password: string, deviceName?: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');
    useAuthStore.setState({ isLoading: true, error: null });

    try {
      // Get device fingerprint for enhanced device identification
      const deviceFingerprint = DeviceManager.getDeviceFingerprint();

      // Get or generate persistent device info
      const deviceInfo = await DeviceManager.getDeviceInfo();

      console.log('Auth - Using device fingerprint:', deviceFingerprint);
      console.log('Auth - Using device ID:', deviceInfo.deviceId);

      const response: SessionLoginResponse = await oxyServices.signIn(
        username,
        password,
        deviceName || deviceInfo.deviceName || DeviceManager.getDefaultDeviceName(),
        deviceFingerprint
      );

      // Set as active session (only store session ID)
      setActiveSessionId(response.sessionId);
      await saveActiveSessionId(response.sessionId);

      // Get access token for API calls
      await oxyServices.getTokenBySession(response.sessionId);

      // Load full user data from backend
      const fullUser = await oxyServices.getUserBySession(response.sessionId);
      loginSuccess(fullUser);
      setMinimalUser(response.user);

      // Load sessions from backend
      const serverSessions = await oxyServices.getSessionsBySessionId(response.sessionId);
      const clientSessions: ClientSession[] = serverSessions.map(serverSession => ({
        sessionId: serverSession.sessionId,
        deviceId: serverSession.deviceId,
        expiresAt: serverSession.expiresAt || new Date().toISOString(),
        lastActive: serverSession.lastActive || new Date().toISOString(),
        userId: serverSession.userId || fullUser.id
      }));
      setSessions(clientSessions);

      if (onAuthStateChange) {
        onAuthStateChange(fullUser);
      }

      return fullUser;
    } catch (error: any) {
      loginFailure(error.message || 'Login failed');
      throw error;
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  }, [storage, oxyServices, saveActiveSessionId, loginSuccess, setMinimalUser, onAuthStateChange, loginFailure]);

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
      console.error('Logout error:', error);
      useAuthStore.setState({ error: 'Logout failed' });
    }
  }, [activeSessionId, oxyServices, sessions, switchToSession, logoutStore, setMinimalUser, storage, keys.activeSessionId, onAuthStateChange]);

  // Logout all sessions
  const logoutAll = useCallback(async (): Promise<void> => {
    console.log('logoutAll called with activeSessionId:', activeSessionId);

    if (!activeSessionId) {
      console.error('No active session ID found, cannot logout all');
      useAuthStore.setState({ error: 'No active session found' });
      throw new Error('No active session found');
    }

    if (!oxyServices) {
      console.error('OxyServices not initialized');
      useAuthStore.setState({ error: 'Service not available' });
      throw new Error('Service not available');
    }

    try {
      console.log('Calling oxyServices.logoutAllSessions with sessionId:', activeSessionId);
      await oxyServices.logoutAllSessions(activeSessionId);
      console.log('logoutAllSessions completed successfully');

      // Clear all local data
      setSessions([]);
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await clearAllStorage();
      console.log('Local storage cleared');

      if (onAuthStateChange) {
        onAuthStateChange(null);
        console.log('Auth state change callback called');
      }
    } catch (error) {
      console.error('Logout all error:', error);
      useAuthStore.setState({ error: `Logout all failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
      throw error;
    }
  }, [activeSessionId, oxyServices, logoutStore, setMinimalUser, clearAllStorage, onAuthStateChange]);

  // Effect to restore token on app load or session switch
  useEffect(() => {
    const restoreToken = async () => {
      if (activeSessionId && oxyServices) {
        try {
          await oxyServices.getTokenBySession(activeSessionId);
          setTokenReady(true);
        } catch (err) {
          // If token restoration fails, force logout
          await logout();
          setTokenReady(false);
        }
      } else {
        setTokenReady(true); // No session, so token is not needed
      }
    };
    restoreToken();
    // Only run when activeSessionId or oxyServices changes
  }, [activeSessionId, oxyServices, logout]);

  // Sign up method
  const signUp = useCallback(async (username: string, email: string, password: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');

    useAuthStore.setState({ isLoading: true, error: null });

    try {
      // Create new account using the OxyServices signUp method
      const response = await oxyServices.signUp(username, email, password);

      console.log('SignUp successful:', response);

      // Now log the user in to create a session
      // This will handle the session creation and device registration
      const user = await login(username, password);

      return user;
    } catch (error: any) {
      loginFailure(error.message || 'Sign up failed');
      throw error;
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  }, [storage, oxyServices, login, loginFailure]);

  // Switch session method
  const switchSession = useCallback(async (sessionId: string): Promise<void> => {
    await switchToSession(sessionId);
  }, [switchToSession]);

  // Remove session method
  const removeSession = useCallback(async (sessionId: string): Promise<void> => {
    await logout(sessionId);
  }, [logout]);

  // Refresh sessions method
  const refreshSessions = useCallback(async (): Promise<void> => {
    console.log('refreshSessions called with activeSessionId:', activeSessionId);

    if (!activeSessionId) {
      console.log('refreshSessions: No activeSessionId, returning');
      return;
    }

    try {
      console.log('refreshSessions: Calling getSessionsBySessionId...');
      const serverSessions = await oxyServices.getSessionsBySessionId(activeSessionId);
      console.log('refreshSessions: Server sessions received:', serverSessions);

      // Update local sessions with server data
      const updatedSessions: ClientSession[] = serverSessions.map(serverSession => ({
        sessionId: serverSession.sessionId,
        deviceId: serverSession.deviceId,
        expiresAt: serverSession.expiresAt || new Date().toISOString(),
        lastActive: serverSession.lastActive || new Date().toISOString(),
        userId: serverSession.userId || user?.id
      }));

      console.log('refreshSessions: Updated sessions:', updatedSessions);
      setSessions(updatedSessions);
      console.log('refreshSessions: Sessions updated in state');
    } catch (error) {
      console.error('Refresh sessions error:', error);

      // If the current session is invalid, try to find another valid session
      if (sessions.length > 1) {
        console.log('Current session invalid, trying to switch to another session...');
        const otherSessions = sessions.filter(s => s.sessionId !== activeSessionId);

        for (const session of otherSessions) {
          try {
            // Try to validate this session
            await oxyServices.validateSession(session.sessionId, {
              useHeaderValidation: true
            });
            console.log('Found valid session, switching to:', session.sessionId);
            await switchToSession(session.sessionId);
            return; // Successfully switched to another session
          } catch (sessionError) {
            console.log('Session validation failed for:', session.sessionId, sessionError);
            continue; // Try next session
          }
        }
      }

      // If no valid sessions found, clear all sessions
      console.log('No valid sessions found, clearing all sessions');
      setSessions([]);
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await clearAllStorage();

      if (onAuthStateChange) {
        onAuthStateChange(null);
      }
    }
  }, [activeSessionId, oxyServices, user?.id, sessions, switchToSession, logoutStore, setMinimalUser, clearAllStorage, onAuthStateChange]);

  // Device management methods
  const getDeviceSessions = useCallback(async (): Promise<any[]> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      return await oxyServices.getDeviceSessions(activeSessionId);
    } catch (error) {
      console.error('Get device sessions error:', error);
      throw error;
    }
  }, [activeSessionId, oxyServices]);

  const logoutAllDeviceSessions = useCallback(async (): Promise<void> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      await oxyServices.logoutAllDeviceSessions(activeSessionId);

      // Clear all local sessions since we logged out from all devices
      setSessions([]);
      setActiveSessionId(null);
      logoutStore();
      setMinimalUser(null);
      await clearAllStorage();

      if (onAuthStateChange) {
        onAuthStateChange(null);
      }
    } catch (error) {
      console.error('Logout all device sessions error:', error);
      throw error;
    }
  }, [activeSessionId, oxyServices, logoutStore, setMinimalUser, clearAllStorage, onAuthStateChange]);

  const updateDeviceName = useCallback(async (deviceName: string): Promise<void> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      await oxyServices.updateDeviceName(activeSessionId, deviceName);

      // Update local device info
      await DeviceManager.updateDeviceName(deviceName);
    } catch (error) {
      console.error('Update device name error:', error);
      throw error;
    }
  }, [activeSessionId, oxyServices]);

  // Bottom sheet control methods
  const showBottomSheet = useCallback((screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => {
    console.log('showBottomSheet called with:', screenOrConfig);

    if (bottomSheetRef?.current) {
      console.log('bottomSheetRef is available');

      // First, show the bottom sheet
      if (bottomSheetRef.current.expand) {
        console.log('Expanding bottom sheet');
        bottomSheetRef.current.expand();
      } else if (bottomSheetRef.current.present) {
        console.log('Presenting bottom sheet');
        bottomSheetRef.current.present();
      } else {
        console.warn('No expand or present method available on bottomSheetRef');
        console.log('Available methods on bottomSheetRef.current:', Object.keys(bottomSheetRef.current));
      }

      // Then navigate to the specified screen if provided
      if (screenOrConfig) {
        // Add a small delay to ensure the bottom sheet is opened first
        setTimeout(() => {
          if (typeof screenOrConfig === 'string') {
            // Simple screen name
            console.log('Navigating to screen:', screenOrConfig);
            bottomSheetRef.current?._navigateToScreen?.(screenOrConfig);
          } else {
            // Screen with props
            console.log('Navigating to screen with props:', screenOrConfig.screen, screenOrConfig.props);
            bottomSheetRef.current?._navigateToScreen?.(screenOrConfig.screen, screenOrConfig.props);
          }
        }, 100);
      }
    } else {
      console.warn('bottomSheetRef is not available');
      console.warn('To fix this, ensure you pass a bottomSheetRef to OxyProvider:');
      console.warn('<OxyProvider baseURL="..." bottomSheetRef={yourBottomSheetRef}>');
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
  const contextValue: OxyContextState = useMemo(() => ({
    user,
    minimalUser,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    logoutAll,
    signUp,
    switchSession,
    removeSession,
    refreshSessions,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    oxyServices,
    bottomSheetRef,
    showBottomSheet,
    hideBottomSheet,
    useFollow: baseUseFollow,
  }), [
    user?.id, // Only depend on user ID, not the entire user object
    minimalUser?.id,
    sessions.length, // Only depend on sessions count, not the entire array
    activeSessionId,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    logoutAll,
    signUp,
    switchSession,
    removeSession,
    refreshSessions,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    oxyServices,
    bottomSheetRef,
    showBottomSheet,
    hideBottomSheet,
  ]);

  // Wrap children rendering to block until token is ready
  if (!tokenReady) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Loading authentication...</Text>
    </View>;
  }

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
