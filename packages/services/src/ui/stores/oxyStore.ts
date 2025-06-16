import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { SecureClientSession, MinimalUserData } from '../../models/secureSession';
import { DeviceManager } from '../../utils/deviceManager';

// Define the store state interface (matches OxyContextState but without methods)
export interface OxyStoreState {
  // Authentication state
  user: User | null;
  minimalUser: MinimalUserData | null;
  sessions: SecureClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Services reference
  oxyServices: OxyServices | null;
  bottomSheetRef?: React.RefObject<any>;

  // Internal state
  storage: any;
  storageKeyPrefix: string;
  onAuthStateChange?: (user: User | null) => void;
}

// Define the store actions interface
export interface OxyStoreActions {
  // State setters
  setUser: (user: User | null) => void;
  setMinimalUser: (minimalUser: MinimalUserData | null) => void;
  setSessions: (sessions: SecureClientSession[]) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setIsAuthenticated: (isAuthenticated: boolean) => void;
  setIsLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setOxyServices: (oxyServices: OxyServices) => void;
  setBottomSheetRef: (ref: React.RefObject<any>) => void;
  setStorage: (storage: any) => void;
  setStorageKeyPrefix: (prefix: string) => void;
  setOnAuthStateChange: (callback: (user: User | null) => void) => void;

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

  // Bottom sheet control methods
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;

  // Internal methods
  initializeAuth: () => Promise<void>;
  saveSessionsToStorage: (sessionsList: SecureClientSession[]) => Promise<void>;
  saveActiveSessionId: (sessionId: string) => Promise<void>;
  clearAllStorage: () => Promise<void>;
  switchToSession: (sessionId: string) => Promise<void>;
  removeInvalidSession: (sessionId: string) => Promise<void>;
}

// Combined store type
export type OxyStore = OxyStoreState & OxyStoreActions;

// Platform storage interface
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
  sessions: `${prefix}_sessions`,
  activeSessionId: `${prefix}_active_session_id`,
});

// Custom storage implementation for Zustand persist
const createCustomStorage = (prefix: string) => ({
  getItem: async (name: string): Promise<string | null> => {
    try {
      const storage = await getStorage();
      return await storage.getItem(`${prefix}_${name}`);
    } catch (error) {
      console.error('Storage getItem error:', error);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const storage = await getStorage();
      await storage.setItem(`${prefix}_${name}`, value);
    } catch (error) {
      console.error('Storage setItem error:', error);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const storage = await getStorage();
      await storage.removeItem(`${prefix}_${name}`);
    } catch (error) {
      console.error('Storage removeItem error:', error);
    }
  },
});

// Create the Zustand store
export const useOxyStore = create<OxyStore>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      minimalUser: null,
      sessions: [],
      activeSessionId: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      oxyServices: null,
      bottomSheetRef: undefined,
      storage: null,
      storageKeyPrefix: 'oxy_secure',
      onAuthStateChange: undefined,

      // State setters
      setUser: (user) => {
        set({ user, isAuthenticated: !!user });
        const { onAuthStateChange } = get();
        if (onAuthStateChange) {
          onAuthStateChange(user);
        }
      },
      setMinimalUser: (minimalUser) => set({ minimalUser }),
      setSessions: (sessions) => set({ sessions }),
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setOxyServices: (oxyServices) => set({ oxyServices }),
      setBottomSheetRef: (bottomSheetRef) => set({ bottomSheetRef }),
      setStorage: (storage) => set({ storage }),
      setStorageKeyPrefix: (storageKeyPrefix) => set({ storageKeyPrefix }),
      setOnAuthStateChange: (onAuthStateChange) => set({ onAuthStateChange }),

      // Initialize authentication state
      initializeAuth: async () => {
        const { storage, oxyServices, storageKeyPrefix } = get();
        if (!storage || !oxyServices) return;

        set({ isLoading: true });
        try {
          const keys = getSecureStorageKeys(storageKeyPrefix);

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
              if (!session.userId || !session.username) {
                // Session is missing user info, try to fetch it
                try {
                  const sessionUser = await oxyServices.getUserBySession(session.sessionId);
                  migratedSessions.push({
                    ...session,
                    userId: sessionUser.id,
                    username: sessionUser.username
                  });
                  shouldUpdateStorage = true;
                  console.log(`Migrated session ${session.sessionId} for user ${sessionUser.username}`);
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
              await get().saveSessionsToStorage(migratedSessions);
            }
            
            set({ sessions: migratedSessions });

            if (storedActiveSessionId && migratedSessions.length > 0) {
              const activeSession = migratedSessions.find(s => s.sessionId === storedActiveSessionId);
              
              if (activeSession) {
                console.log('SecureAuth - activeSession found:', activeSession);
                
                // Validate session
                try {
                  const validation = await oxyServices.validateSession(activeSession.sessionId);
                  
                  if (validation.valid) {
                    console.log('SecureAuth - session validated successfully');
                    set({ activeSessionId: activeSession.sessionId });
                    
                    // Get access token for API calls
                    await oxyServices.getTokenBySession(activeSession.sessionId);
                    
                    // Load full user data
                    const fullUser = await oxyServices.getUserBySession(activeSession.sessionId);
                    get().setUser(fullUser);
                    set({ 
                      minimalUser: {
                        id: fullUser.id,
                        username: fullUser.username,
                        avatar: fullUser.avatar
                      }
                    });
                  } else {
                    console.log('SecureAuth - session invalid, removing');
                    await get().removeInvalidSession(activeSession.sessionId);
                  }
                } catch (error) {
                  console.error('SecureAuth - session validation error:', error);
                  await get().removeInvalidSession(activeSession.sessionId);
                }
              }
            }
          }
        } catch (err) {
          console.error('Secure auth initialization error:', err);
          await get().clearAllStorage();
        } finally {
          set({ isLoading: false });
        }
      },

      // Save sessions to storage
      saveSessionsToStorage: async (sessionsList: SecureClientSession[]) => {
        const { storage, storageKeyPrefix } = get();
        if (!storage) return;
        const keys = getSecureStorageKeys(storageKeyPrefix);
        await storage.setItem(keys.sessions, JSON.stringify(sessionsList));
      },

      // Save active session ID to storage
      saveActiveSessionId: async (sessionId: string) => {
        const { storage, storageKeyPrefix } = get();
        if (!storage) return;
        const keys = getSecureStorageKeys(storageKeyPrefix);
        await storage.setItem(keys.activeSessionId, sessionId);
      },

      // Clear all storage
      clearAllStorage: async () => {
        const { storage, storageKeyPrefix } = get();
        if (!storage) return;
        try {
          const keys = getSecureStorageKeys(storageKeyPrefix);
          await storage.removeItem(keys.sessions);
          await storage.removeItem(keys.activeSessionId);
        } catch (err) {
          console.error('Clear secure storage error:', err);
        }
      },

      // Switch to a different session
      switchToSession: async (sessionId: string) => {
        const { oxyServices } = get();
        if (!oxyServices) throw new Error('OxyServices not initialized');

        try {
          set({ isLoading: true });
          
          // Get access token for this session
          await oxyServices.getTokenBySession(sessionId);
          
          // Load full user data
          const fullUser = await oxyServices.getUserBySession(sessionId);
          
          set({ 
            activeSessionId: sessionId,
            minimalUser: {
              id: fullUser.id,
              username: fullUser.username,
              avatar: fullUser.avatar
            }
          });
          get().setUser(fullUser);
          
          await get().saveActiveSessionId(sessionId);
        } catch (error) {
          console.error('Switch session error:', error);
          set({ error: 'Failed to switch session' });
        } finally {
          set({ isLoading: false });
        }
      },

      // Remove invalid session
      removeInvalidSession: async (sessionId: string) => {
        const { sessions, activeSessionId, storageKeyPrefix, storage } = get();
        const filteredSessions = sessions.filter(s => s.sessionId !== sessionId);
        set({ sessions: filteredSessions });
        await get().saveSessionsToStorage(filteredSessions);
        
        // If there are other sessions, switch to the first one
        if (filteredSessions.length > 0) {
          await get().switchToSession(filteredSessions[0].sessionId);
        } else {
          // No valid sessions left
          set({ 
            activeSessionId: null,
            minimalUser: null
          });
          get().setUser(null);
          if (storage) {
            const keys = getSecureStorageKeys(storageKeyPrefix);
            await storage.removeItem(keys.activeSessionId);
          }
        }
      },

      // Auth methods
      login: async (username: string, password: string, deviceName?: string) => {
        const { oxyServices, storage, sessions, activeSessionId } = get();
        if (!oxyServices) throw new Error('OxyServices not initialized');
        if (!storage) throw new Error('Storage not initialized');

        set({ isLoading: true, error: null });

        try {
          // Get device fingerprint for enhanced device identification
          const deviceFingerprint = DeviceManager.getDeviceFingerprint();
          
          // Get or generate persistent device info
          const deviceInfo = await DeviceManager.getDeviceInfo();
          
          console.log('SecureAuth - Using device fingerprint:', deviceFingerprint);
          console.log('SecureAuth - Using device ID:', deviceInfo.deviceId);

          const response = await oxyServices.secureLogin(
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
            userId: response.user.id,
            username: response.user.username
          };

          // Check if this user already has a session (prevent duplicate accounts)
          const existingUserSessionIndex = sessions.findIndex(s => 
            s.userId === response.user.id || s.username === response.user.username
          );

          let updatedSessions: SecureClientSession[];
          
          if (existingUserSessionIndex !== -1) {
            // User already has a session - replace it with the new one (reused session scenario)
            const existingSession = sessions[existingUserSessionIndex];
            updatedSessions = [...sessions];
            updatedSessions[existingUserSessionIndex] = clientSession;
            
            console.log(`Reusing/updating existing session for user ${response.user.username}. Previous session: ${existingSession.sessionId}, New session: ${response.sessionId}`);
            
            // If the replaced session was the active one, update active session
            if (activeSessionId === existingSession.sessionId) {
              set({ activeSessionId: response.sessionId });
              await get().saveActiveSessionId(response.sessionId);
            }
          } else {
            // Add new session for new user
            updatedSessions = [...sessions, clientSession];
            console.log(`Added new session for user ${response.user.username} on device ${response.deviceId}`);
          }

          set({ sessions: updatedSessions });
          await get().saveSessionsToStorage(updatedSessions);

          // Set as active session
          set({ activeSessionId: response.sessionId });
          await get().saveActiveSessionId(response.sessionId);

          // Get access token for API calls
          await oxyServices.getTokenBySession(response.sessionId);

          // Load full user data
          const fullUser = await oxyServices.getUserBySession(response.sessionId);
          get().setUser(fullUser);
          set({ minimalUser: response.user });

          return fullUser;
        } catch (error: any) {
          set({ error: error.message || 'Login failed' });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async (targetSessionId?: string) => {
        const { oxyServices, activeSessionId, sessions, storage, storageKeyPrefix } = get();
        if (!activeSessionId || !oxyServices) return;

        try {
          const sessionToLogout = targetSessionId || activeSessionId;
          await oxyServices.logoutSecureSession(activeSessionId, sessionToLogout);

          // Remove session from local storage
          const filteredSessions = sessions.filter(s => s.sessionId !== sessionToLogout);
          set({ sessions: filteredSessions });
          await get().saveSessionsToStorage(filteredSessions);

          // If logging out active session
          if (sessionToLogout === activeSessionId) {
            if (filteredSessions.length > 0) {
              // Switch to another session
              await get().switchToSession(filteredSessions[0].sessionId);
            } else {
              // No sessions left
              set({ 
                activeSessionId: null,
                minimalUser: null
              });
              get().setUser(null);
              if (storage) {
                const keys = getSecureStorageKeys(storageKeyPrefix);
                await storage.removeItem(keys.activeSessionId);
              }
            }
          }
        } catch (error) {
          console.error('Logout error:', error);
          set({ error: 'Logout failed' });
        }
      },

      logoutAll: async () => {
        const { oxyServices, activeSessionId } = get();
        console.log('logoutAll called with activeSessionId:', activeSessionId);
        
        if (!activeSessionId) {
          console.error('No active session ID found, cannot logout all');
          set({ error: 'No active session found' });
          throw new Error('No active session found');
        }

        if (!oxyServices) {
          console.error('OxyServices not initialized');
          set({ error: 'Service not available' });
          throw new Error('Service not available');
        }

        try {
          console.log('Calling oxyServices.logoutAllSecureSessions with sessionId:', activeSessionId);
          await oxyServices.logoutAllSecureSessions(activeSessionId);
          console.log('logoutAllSecureSessions completed successfully');
          
          // Clear all local data
          set({ 
            sessions: [],
            activeSessionId: null,
            minimalUser: null
          });
          get().setUser(null);
          await get().clearAllStorage();
          console.log('Local storage cleared');
        } catch (error) {
          console.error('Logout all error:', error);
          set({ error: `Logout all failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
          throw error;
        }
      },

      signUp: async (username: string, email: string, password: string) => {
        // Implement sign up logic similar to secureLogin
        throw new Error('Sign up not implemented yet');
      },

      switchSession: async (sessionId: string) => {
        await get().switchToSession(sessionId);
      },

      removeSession: async (sessionId: string) => {
        await get().logout(sessionId);
      },

      refreshSessions: async () => {
        const { oxyServices, activeSessionId } = get();
        if (!activeSessionId || !oxyServices) return;

        try {
          const serverSessions = await oxyServices.getSessionsBySessionId(activeSessionId);
          
          // Update local sessions with server data
          const updatedSessions: SecureClientSession[] = serverSessions.map(serverSession => ({
            sessionId: serverSession.sessionId,
            deviceId: serverSession.deviceId,
            expiresAt: new Date().toISOString(), // You might want to get this from server
            lastActive: new Date().toISOString(),
            userId: serverSession.userId,
            username: serverSession.username
          }));
          
          set({ sessions: updatedSessions });
          await get().saveSessionsToStorage(updatedSessions);
        } catch (error) {
          console.error('Refresh sessions error:', error);
        }
      },

      // Device management methods
      getDeviceSessions: async () => {
        const { oxyServices, activeSessionId } = get();
        if (!activeSessionId || !oxyServices) throw new Error('No active session');

        try {
          return await oxyServices.getDeviceSessions(activeSessionId);
        } catch (error) {
          console.error('Get device sessions error:', error);
          throw error;
        }
      },

      logoutAllDeviceSessions: async () => {
        const { oxyServices, activeSessionId } = get();
        if (!activeSessionId || !oxyServices) throw new Error('No active session');

        try {
          await oxyServices.logoutAllDeviceSessions(activeSessionId);
          
          // Clear all local sessions since we logged out from all devices
          set({ 
            sessions: [],
            activeSessionId: null,
            minimalUser: null
          });
          get().setUser(null);
          await get().clearAllStorage();
        } catch (error) {
          console.error('Logout all device sessions error:', error);
          throw error;
        }
      },

      updateDeviceName: async (deviceName: string) => {
        const { oxyServices, activeSessionId } = get();
        if (!activeSessionId || !oxyServices) throw new Error('No active session');

        try {
          await oxyServices.updateDeviceName(activeSessionId, deviceName);
          
          // Update local device info
          await DeviceManager.updateDeviceName(deviceName);
        } catch (error) {
          console.error('Update device name error:', error);
          throw error;
        }
      },

      // Bottom sheet control methods
      showBottomSheet: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => {
        const { bottomSheetRef } = get();
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
      },

      hideBottomSheet: () => {
        const { bottomSheetRef } = get();
        if (bottomSheetRef?.current) {
          bottomSheetRef.current.dismiss?.();
        }
      },
    }),
    {
      name: 'oxy-store',
      storage: createJSONStorage(() => createCustomStorage('oxy_store')),
      partialize: (state) => ({
        // Only persist essential state, not functions or refs
        user: state.user,
        minimalUser: state.minimalUser,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        storageKeyPrefix: state.storageKeyPrefix,
      }),
    }
  )
);