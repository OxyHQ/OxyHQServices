import React, { createContext, useContext, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { SecureLoginResponse, SecureClientSession, MinimalUserData } from '../../models/secureSession';
import { DeviceManager } from '../../utils/deviceManager';
import { useSessionSocket } from '../hooks/useSessionSocket';
import { toast } from '../../lib/sonner';
import { useAuthStore } from '../stores/authStore';

// Define the context shape
export interface OxyContextState {
  // Authentication state
  user: User | null; // Current active user (loaded from server)
  minimalUser: MinimalUserData | null; // Minimal user data for UI
  sessions: SecureClientSession[]; // All active sessions
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
}

// Create the context with default values
const OxyContext = createContext<OxyContextState | null>(null);

// Props for the OxyContextProvider
export interface OxyContextProviderProps {
  children: ReactNode;
  oxyServices: OxyServices;
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
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
        AsyncStorage = asyncStorageModule.default;
      } catch (error) {
        console.error('Failed to import AsyncStorage:', error);
        throw new Error('AsyncStorage is required in React Native environment');
      }
    }
    return AsyncStorage;
  }

  return new WebStorage();
};

// Storage keys for secure sessions
const getSecureStorageKeys = (prefix = 'oxy_secure') => ({
  sessions: `${prefix}_sessions`, // Array of SecureClientSession objects
  activeSessionId: `${prefix}_active_session_id`, // ID of currently active session
});

export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
  children,
  oxyServices,
  storageKeyPrefix = 'oxy_secure',
  onAuthStateChange,
  bottomSheetRef,
}) => {
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
  const [sessions, setSessions] = React.useState<SecureClientSession[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [storage, setStorage] = React.useState<StorageInterface | null>(null);

  // Storage keys (memoized to prevent infinite loops)
  const keys = useMemo(() => getSecureStorageKeys(storageKeyPrefix), [storageKeyPrefix]);

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

  // Effect to initialize authentication state
  useEffect(() => {
    const initAuth = async () => {
      if (!storage) return;

      useAuthStore.setState({ isLoading: true });
      try {
        // Load stored sessions
        const sessionsData = await storage.getItem(keys.sessions);
        const storedActiveSessionId = await storage.getItem(keys.activeSessionId);

        console.log('SecureAuth - sessionsData:', sessionsData);
        console.log('SecureAuth - activeSessionId:', storedActiveSessionId);

        if (sessionsData) {
          const parsedSessions: SecureClientSession[] = JSON.parse(sessionsData);

          // Migrate old session format to include user info
          const migratedSessions: SecureClientSession[] = [];
          let shouldUpdateStorage = false;

          for (const session of parsedSessions) {
            if (!session.userId) {
              // Session is missing user info, try to fetch it
              try {
                const sessionUser = await oxyServices.getUserBySession(session.sessionId);
                migratedSessions.push({
                  ...session,
                  userId: sessionUser.id
                });
                shouldUpdateStorage = true;
                console.log(`Migrated session ${session.sessionId} for user ${sessionUser.id}`);
              } catch (error) {
                // Session might be invalid, skip it
                console.log(`Removing invalid session ${session.sessionId}:`, error);
                shouldUpdateStorage = true;
              }
            } else {
              // Session already has user info
              migratedSessions.push(session);
            }
          }

          // Update storage if we made changes
          if (shouldUpdateStorage) {
            await saveSessionsToStorage(migratedSessions);
          }

          setSessions(migratedSessions);

          if (storedActiveSessionId && migratedSessions.length > 0) {
            const activeSession = migratedSessions.find(s => s.sessionId === storedActiveSessionId);

            if (activeSession) {
              console.log('SecureAuth - activeSession found:', activeSession);

              // Validate session
              try {
                const validation = await oxyServices.validateSession(activeSession.sessionId);

                if (validation.valid) {
                  console.log('SecureAuth - session validated successfully');
                  setActiveSessionId(activeSession.sessionId);

                  // Get access token for API calls
                  await oxyServices.getTokenBySession(activeSession.sessionId);

                  // Load full user data
                  const fullUser = await oxyServices.getUserBySession(activeSession.sessionId);
                  loginSuccess(fullUser);
                  setMinimalUser({
                    id: fullUser.id,
                    username: fullUser.username,
                    avatar: fullUser.avatar
                  });

                  if (onAuthStateChange) {
                    onAuthStateChange(fullUser);
                  }
                } else {
                  console.log('SecureAuth - session invalid, removing');
                  await removeInvalidSession(activeSession.sessionId);
                }
              } catch (error) {
                console.error('SecureAuth - session validation error:', error);
                await removeInvalidSession(activeSession.sessionId);
              }
            }
          }
        }
      } catch (err) {
        console.error('Secure auth initialization error:', err);
        await clearAllStorage();
      } finally {
        useAuthStore.setState({ isLoading: false });
      }
    };

    if (storage) {
      initAuth();
    }
  }, [storage, oxyServices, keys, onAuthStateChange]);

  // Remove invalid session
  const removeInvalidSession = useCallback(async (sessionId: string): Promise<void> => {
    const filteredSessions = sessions.filter(s => s.sessionId !== sessionId);
    setSessions(filteredSessions);
    await saveSessionsToStorage(filteredSessions);

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

  // Save sessions to storage
  const saveSessionsToStorage = useCallback(async (sessionsList: SecureClientSession[]): Promise<void> => {
    if (!storage) return;
    await storage.setItem(keys.sessions, JSON.stringify(sessionsList));
  }, [storage, keys.sessions]);

  // Save active session ID to storage
  const saveActiveSessionId = useCallback(async (sessionId: string): Promise<void> => {
    if (!storage) return;
    await storage.setItem(keys.activeSessionId, sessionId);
  }, [storage, keys.activeSessionId]);

  // Clear all storage
  const clearAllStorage = useCallback(async (): Promise<void> => {
    if (!storage) return;
    try {
      await storage.removeItem(keys.sessions);
      await storage.removeItem(keys.activeSessionId);
    } catch (err) {
      console.error('Clear secure storage error:', err);
    }
  }, [storage, keys]);

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

  // Secure login method
  const login = async (username: string, password: string, deviceName?: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');
    useAuthStore.setState({ isLoading: true, error: null });

    try {
      // Get device fingerprint for enhanced device identification
      const deviceFingerprint = DeviceManager.getDeviceFingerprint();

      // Get or generate persistent device info
      const deviceInfo = await DeviceManager.getDeviceInfo();

      console.log('SecureAuth - Using device fingerprint:', deviceFingerprint);
      console.log('SecureAuth - Using device ID:', deviceInfo.deviceId);

      const response: SecureLoginResponse = await oxyServices.secureLogin(
        username,
        password,
        deviceName || deviceInfo.deviceName || DeviceManager.getDefaultDeviceName(),
        deviceFingerprint
      );

      // Create client session object with user info for duplicate detection
      const clientSession: SecureClientSession = {
        sessionId: response.sessionId,
        deviceId: response.deviceId,
        expiresAt: response.expiresAt,
        lastActive: new Date().toISOString(),
        userId: response.user.id
      };

      // Check if this user already has a session (prevent duplicate accounts)
      const existingUserSessionIndex = sessions.findIndex(s =>
        s.userId === response.user.id
      );

      let updatedSessions: SecureClientSession[];

      if (existingUserSessionIndex !== -1) {
        // User already has a session - replace it with the new one (reused session scenario)
        const existingSession = sessions[existingUserSessionIndex];
        updatedSessions = [...sessions];
        updatedSessions[existingUserSessionIndex] = clientSession;

        console.log(`Reusing/updating existing session for user ${response.user.id}. Previous session: ${existingSession.sessionId}, New session: ${response.sessionId}`);

        // If the replaced session was the active one, update active session
        if (activeSessionId === existingSession.sessionId) {
          setActiveSessionId(response.sessionId);
          await saveActiveSessionId(response.sessionId);
        }
      } else {
        // Add new session for new user
        updatedSessions = [...sessions, clientSession];
        console.log(`Added new session for user ${response.user.id} on device ${response.deviceId}`);
      }

      setSessions(updatedSessions);
      await saveSessionsToStorage(updatedSessions);

      // Set as active session
      setActiveSessionId(response.sessionId);
      await saveActiveSessionId(response.sessionId);

      // Get access token for API calls
      await oxyServices.getTokenBySession(response.sessionId);

      // Load full user data
      const fullUser = await oxyServices.getUserBySession(response.sessionId);
      loginSuccess(fullUser);
      setMinimalUser(response.user);

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
  };

  // Logout method
  const logout = async (targetSessionId?: string): Promise<void> => {
    if (!activeSessionId) return;

    try {
      const sessionToLogout = targetSessionId || activeSessionId;
      await oxyServices.logoutSecureSession(activeSessionId, sessionToLogout);

      // Remove session from local storage
      const filteredSessions = sessions.filter(s => s.sessionId !== sessionToLogout);
      setSessions(filteredSessions);
      await saveSessionsToStorage(filteredSessions);

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
  };

  // Logout all sessions
  const logoutAll = async (): Promise<void> => {
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
      console.log('Calling oxyServices.logoutAllSecureSessions with sessionId:', activeSessionId);
      await oxyServices.logoutAllSecureSessions(activeSessionId);
      console.log('logoutAllSecureSessions completed successfully');

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
  };

  // Sign up method
  const signUp = async (username: string, email: string, password: string): Promise<User> => {
    if (!storage) throw new Error('Storage not initialized');

    useAuthStore.setState({ isLoading: true, error: null });

    try {
      // Create new account using the OxyServices signUp method
      const response = await oxyServices.signUp(username, email, password);

      console.log('SignUp successful:', response);

      // Now log the user in securely to create a session
      // This will handle the session creation and device registration
      const user = await login(username, password);

      return user;
    } catch (error: any) {
      loginFailure(error.message || 'Sign up failed');
      throw error;
    } finally {
      useAuthStore.setState({ isLoading: false });
    }
  };

  // Switch session method
  const switchSession = async (sessionId: string): Promise<void> => {
    await switchToSession(sessionId);
  };

  // Remove session method
  const removeSession = async (sessionId: string): Promise<void> => {
    await logout(sessionId);
  };

  // Refresh sessions method
  const refreshSessions = async (): Promise<void> => {
    if (!activeSessionId) return;

    try {
      const serverSessions = await oxyServices.getSessionsBySessionId(activeSessionId);

      // Update local sessions with server data
      const updatedSessions: SecureClientSession[] = serverSessions.map(serverSession => ({
        sessionId: serverSession.sessionId,
        deviceId: serverSession.deviceId,
        expiresAt: new Date().toISOString(), // You might want to get this from server
        lastActive: new Date().toISOString()
      }));

      setSessions(updatedSessions);
      await saveSessionsToStorage(updatedSessions);
    } catch (error) {
      console.error('Refresh sessions error:', error);
    }
  };

  // Device management methods
  const getDeviceSessions = async (): Promise<any[]> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      return await oxyServices.getDeviceSessions(activeSessionId);
    } catch (error) {
      console.error('Get device sessions error:', error);
      throw error;
    }
  };

  const logoutAllDeviceSessions = async (): Promise<void> => {
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
  };

  const updateDeviceName = async (deviceName: string): Promise<void> => {
    if (!activeSessionId) throw new Error('No active session');

    try {
      await oxyServices.updateDeviceName(activeSessionId, deviceName);

      // Update local device info
      await DeviceManager.updateDeviceName(deviceName);
    } catch (error) {
      console.error('Update device name error:', error);
      throw error;
    }
  };

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
    }
  }, [bottomSheetRef]);

  const hideBottomSheet = useCallback(() => {
    if (bottomSheetRef?.current) {
      bottomSheetRef.current.dismiss?.();
    }
  }, [bottomSheetRef]);

  // Integrate socket for real-time session updates
  console.log('OxyContextProvider: userId', user?.id, 'baseURL', oxyServices.getBaseURL());
  useSessionSocket({
    userId: user?.id,
    activeSessionId,
    refreshSessions,
    logout: () => logout(),
    baseURL: oxyServices.getBaseURL(),
    onRemoteSignOut: () => {
      toast.info('You have been signed out remotely.');
      logout();
    },
  });

  // Context value
  const contextValue: OxyContextState = {
    user,
    minimalUser,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout,
    logoutAll: async () => { await logout(); },
    signUp: async (username, email, password) => {
      await signUp(username, email, password);
      return user as User; // Return the latest user from Zustand
    },
    switchSession: async (sessionId) => { await switchToSession(sessionId); },
    removeSession: async (sessionId) => { await removeSession(sessionId); },
    refreshSessions: async () => { await refreshSessions(); },
    getDeviceSessions: async () => { return await getDeviceSessions(); },
    logoutAllDeviceSessions: async () => { await logoutAllDeviceSessions(); },
    updateDeviceName: async (deviceName) => { await updateDeviceName(deviceName); },
    oxyServices,
    bottomSheetRef,
    showBottomSheet,
    hideBottomSheet,
  };

  return (
    <OxyContext.Provider value={contextValue}>
      {children}
    </OxyContext.Provider>
  );
};

// Hook to use the context
export const useOxy = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxy must be used within an OxyContextProvider');
  }
  return context;
};

export default OxyContext;
