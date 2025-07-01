/**
 * OxyContext using Zustand stores
 * This replaces the complex Redux + Context combination with a clean, performant solution
 */

import React, { createContext, useContext, useEffect, ReactNode, useRef, useMemo, useCallback } from 'react';
import { OxyServices } from '../../core';
import { User } from '../../models/interfaces';
import { SecureClientSession, MinimalUserData } from '../../models/secureSession';
import { initializeOxyStore, useAuth, useFollow, useUserSettings, useOxyStore } from '../../stores';
import oxyServices from '../../services/oxySingleton';


// Define the context shape - maintaining backward compatibility
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

  // Helper methods
  ensureToken: () => Promise<void>; // Ensure token is set before API calls
  refreshUserData: () => Promise<void>; // Refresh user data from server
  updateProfile: (updates: Record<string, any>) => Promise<User>; // Update user profile

  // Access to services
  oxyServices: OxyServices; // Add back for backward compatibility
  bottomSheetRef?: React.RefObject<any>;

  // Methods to directly control the bottom sheet
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;

  // Follow functionality
  followingUsers: Record<string, boolean>;
  loadingUsers: Record<string, boolean>;
  followErrors: Record<string, string | null>;

  // Follow actions
  toggleFollow: (userId: string) => Promise<{ success: boolean; isFollowing: boolean }>;
  followUser: (userId: string) => Promise<void>;
  unfollowUser: (userId: string) => Promise<void>;
  fetchFollowStatus: (userId: string) => Promise<void>;
  fetchMultipleStatuses: (userIds: string[]) => Promise<void>;
  setFollowingStatus: (userId: string, status: boolean) => void;
  clearFollowError: (userId: string) => void;
  clearAllFollowErrors: () => void;

  // User Settings
  settings: any;
  settingsLoading: boolean;
  settingsSaving: boolean;
  settingsError: string | null;
  settingsLastSync: number | null;
  settingsOffline: boolean;

  // User Settings actions
  loadSettings: () => Promise<void>;
  saveSettings: (updates: any) => Promise<void>;
  syncSettings: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setSettings: (settings: any) => void;
  setSettingsLoading: (loading: boolean) => void;
  setSettingsSaving: (saving: boolean) => void;
  setSettingsError: (error: string | null) => void;
  setSettingsOffline: (offline: boolean) => void;
  resetSettings: () => void;

}

// Internal context type - only what the Provider actually provides
interface OxyContextInternal {
  bottomSheetRef?: React.RefObject<any>;
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

// Create the context
const OxyContext = createContext<OxyContextInternal | null>(null);

// Props for the OxyContextProvider - maintaining backward compatibility
export interface OxyContextProviderProps {
  children: ReactNode;
  storageKeyPrefix?: string; // Kept for backward compatibility but not used
  onAuthStateChange?: (user: User | null) => void; // Kept for backward compatibility
  bottomSheetRef?: React.RefObject<any>;
  showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
  hideBottomSheet?: () => void;
}

/**
 * OxyContextProvider using Zustand stores
 * Initializes the Zustand store and provides OxyServices access
 */
export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
  children,
  storageKeyPrefix, // Kept for backward compatibility
  onAuthStateChange, // Kept for backward compatibility
  bottomSheetRef,
  showBottomSheet,
  hideBottomSheet,
}) => {
  // Use the singleton oxyServices
  const isInitialized = useRef(false);
  const onAuthStateChangeRef = useRef(onAuthStateChange);
  const sessionValidationRef = useRef(false);

  // Update the ref when the callback changes
  useEffect(() => {
    onAuthStateChangeRef.current = onAuthStateChange;
  }, [onAuthStateChange]);

  // Initialize the store only after hydration is complete
  useEffect(() => {
    if (isInitialized.current) return;

    if (useOxyStore.persist.hasHydrated()) {
      initializeOxyStore(oxyServices);
      isInitialized.current = true;
    } else {
      const unsub = useOxyStore.persist.onFinishHydration(() => {
        initializeOxyStore(oxyServices);
        isInitialized.current = true;
      });
      return () => {
        unsub?.();
      };
    }
  }, []);

  // Subscribe to auth state changes using Zustand's subscribeWithSelector
  useEffect(() => {
    // Only set up subscription if we have a callback
    if (!onAuthStateChangeRef.current) return;

    let unsubscribe: (() => void) | null = null;

    // Add a small delay to ensure store is initialized
    const timer = setTimeout(() => {
      unsubscribe = useOxyStore.subscribe(
        (state) => state.user,
        (user) => {
          if (onAuthStateChangeRef.current) {
            onAuthStateChangeRef.current(user);
          }
        }
      );
    }, 100);

    return () => {
      clearTimeout(timer);
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []); // Empty dependency array - only run once



  return (
    <OxyContext.Provider value={{
      bottomSheetRef,
      showBottomSheet,
      hideBottomSheet
    }}>
      {children}
    </OxyContext.Provider>
  );
};

/**
 * Hook to access the OxyContext
 */
export const useOxyContext = (): OxyContextState => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxyContext must be used within an OxyContextProvider');
  }

  const auth = useAuth();
  const follow = useFollow();
  const userSettings = useUserSettings();

  // Create stable function references
  const login = useCallback(auth.login, [auth.login]);
  const logout = useCallback(auth.logout, [auth.logout]);
  const logoutAll = useCallback(auth.logoutAll, [auth.logoutAll]);
  const signUp = useCallback(auth.signUp, [auth.signUp]);
  const switchSession = useCallback(auth.switchSession, [auth.switchSession]);
  const removeSession = useCallback(auth.removeSession, [auth.removeSession]);
  const refreshSessions = useCallback(auth.refreshSessions, [auth.refreshSessions]);
  const refreshUserData = useCallback(auth.refreshUserData, [auth.refreshUserData]);
  const updateProfile = useCallback(auth.updateProfile, [auth.updateProfile]);
  const getDeviceSessions = useCallback(auth.getDeviceSessions, [auth.getDeviceSessions]);
  const logoutAllDeviceSessions = useCallback(auth.logoutAllDeviceSessions, [auth.logoutAllDeviceSessions]);
  const updateDeviceName = useCallback(auth.updateDeviceName, [auth.updateDeviceName]);
  const ensureToken = useCallback(auth.ensureToken, [auth.ensureToken]);

  const toggleFollow = useCallback(follow.toggleFollow, [follow.toggleFollow]);
  const followUser = useCallback(follow.followUser, [follow.followUser]);
  const unfollowUser = useCallback(follow.unfollowUser, [follow.unfollowUser]);
  const fetchFollowStatus = useCallback(follow.fetchFollowStatus, [follow.fetchFollowStatus]);
  const fetchMultipleStatuses = useCallback(follow.fetchMultipleStatuses, [follow.fetchMultipleStatuses]);
  const setFollowingStatus = useCallback(follow.setFollowingStatus, [follow.setFollowingStatus]);
  const clearFollowError = useCallback(follow.clearFollowError, [follow.clearFollowError]);
  const clearAllFollowErrors = useCallback(follow.clearAllFollowErrors, [follow.clearAllFollowErrors]);



  return useMemo(() => ({
    // Context values
    ...context,

    // Authentication state and actions
    user: auth.user,
    minimalUser: auth.minimalUser,
    sessions: auth.sessions,
    activeSessionId: auth.activeSessionId,
    isAuthenticated: auth.isAuthenticated,
    isLoading: auth.isLoading,
    error: auth.error,

    // Auth actions
    login,
    logout,
    logoutAll,
    signUp,

    // Session management
    switchSession,
    removeSession,
    refreshSessions,

    // Profile management
    refreshUserData,
    updateProfile,

    // Device management
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,

    // Token management
    ensureToken,

    // Follow functionality
    followingUsers: follow.followingUsers,
    loadingUsers: follow.loadingUsers,
    followErrors: follow.errors,
    toggleFollow,
    followUser,
    unfollowUser,
    fetchFollowStatus,
    fetchMultipleStatuses,
    setFollowingStatus,
    clearFollowError,
    clearAllFollowErrors,

    // User Settings
    settings: userSettings.settings,
    settingsLoading: userSettings.isLoading,
    settingsSaving: userSettings.isSaving,
    settingsError: userSettings.error,
    settingsLastSync: userSettings.lastSync,
    settingsOffline: userSettings.isOffline,
    loadSettings: userSettings.loadSettings,
    saveSettings: userSettings.saveSettings,
    syncSettings: userSettings.syncSettings,
    refreshSettings: userSettings.refreshSettings,
    setSettings: userSettings.setSettings,
    setSettingsLoading: userSettings.setLoading,
    setSettingsSaving: userSettings.setSaving,
    setSettingsError: userSettings.setError,
    setSettingsOffline: userSettings.setOffline,
    resetSettings: userSettings.reset,

    // OxyServices instance
    oxyServices
  }), [
    context,
    auth.user,
    auth.minimalUser,
    auth.sessions,
    auth.activeSessionId,
    auth.isAuthenticated,
    auth.isLoading,
    auth.error,
    login,
    logout,
    logoutAll,
    signUp,
    switchSession,
    removeSession,
    refreshSessions,
    refreshUserData,
    updateProfile,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    ensureToken,
    follow.followingUsers,
    follow.loadingUsers,
    follow.errors,
    toggleFollow,
    followUser,
    unfollowUser,
    fetchFollowStatus,
    fetchMultipleStatuses,
    setFollowingStatus,
    clearFollowError,
    clearAllFollowErrors
  ]);
};

/**
 * Main hook that combines all Oxy functionality
 * This is the primary hook that components should use
 */
export const useOxy = () => {
  const context = useContext(OxyContext);
  if (!context) {
    throw new Error('useOxy must be used within an OxyContextProvider');
  }

  // Directly access store state to avoid function reference issues
  const user = useOxyStore((state) => state.user);
  const minimalUser = useOxyStore((state) => state.minimalUser);
  const sessions = useOxyStore((state) => state.sessions);
  const activeSessionId = useOxyStore((state) => state.activeSessionId);
  const isAuthenticated = useOxyStore((state) => state.isAuthenticated);
  const isLoading = useOxyStore((state) => state.isLoading);
  const error = useOxyStore((state) => state.error);
  const followingUsers = useOxyStore((state) => state.followingUsers);
  const loadingUsers = useOxyStore((state) => state.loadingUsers);
  const errors = useOxyStore((state) => state.errors);
  const settings = useOxyStore((state) => state.settings);
  const settingsLoading = useOxyStore((state) => state.isLoading);
  const settingsSaving = useOxyStore((state) => state.isSaving);
  const settingsError = useOxyStore((state) => state.error);
  const settingsLastSync = useOxyStore((state) => state.lastSync);
  const settingsOffline = useOxyStore((state) => state.isOffline);

  // Create stable function references that don't change
  const login = useCallback((username: string, password: string, deviceName?: string) => {
    const state = useOxyStore.getState();
    return state.login(username, password, deviceName, state.getApiUtils());
  }, []);

  const logout = useCallback((targetSessionId?: string) => {
    const state = useOxyStore.getState();
    return state.logout(targetSessionId, state.getApiUtils());
  }, []);

  const logoutAll = useCallback(() => {
    const state = useOxyStore.getState();
    return state.logoutAll(state.getApiUtils());
  }, []);

  const signUp = useCallback((username: string, email: string, password: string) => {
    const state = useOxyStore.getState();
    return state.signUp(username, email, password, state.getApiUtils());
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    const state = useOxyStore.getState();
    return state.switchSession(sessionId, state.getApiUtils());
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    const state = useOxyStore.getState();
    return state.removeSession(sessionId, state.getApiUtils());
  }, []);

  const refreshSessions = useCallback(() => {
    const state = useOxyStore.getState();
    return state.refreshSessions(state.getApiUtils());
  }, []);

  const refreshUserData = useCallback(() => {
    const state = useOxyStore.getState();
    return state.refreshUserData(state.getApiUtils());
  }, []);

  const updateProfile = useCallback((updates: Record<string, any>) => {
    const state = useOxyStore.getState();
    return state.updateProfile(updates, state.getApiUtils());
  }, []);

  const getDeviceSessions = useCallback(() => {
    const state = useOxyStore.getState();
    return state.getDeviceSessions(state.getApiUtils());
  }, []);

  const logoutAllDeviceSessions = useCallback(() => {
    const state = useOxyStore.getState();
    return state.logoutAllDeviceSessions(state.getApiUtils());
  }, []);

  const updateDeviceName = useCallback((deviceName: string) => {
    const state = useOxyStore.getState();
    return state.updateDeviceName(deviceName, state.getApiUtils());
  }, []);

  const ensureToken = useCallback(() => {
    const state = useOxyStore.getState();
    return state.ensureToken(state.getApiUtils());
  }, []);

  const toggleFollow = useCallback((userId: string) => {
    const state = useOxyStore.getState();
    return state.toggleFollow(userId, state.getApiUtils());
  }, []);

  const followUser = useCallback((userId: string) => {
    const state = useOxyStore.getState();
    return state.followUser(userId, state.getApiUtils());
  }, []);

  const unfollowUser = useCallback((userId: string) => {
    const state = useOxyStore.getState();
    return state.unfollowUser(userId, state.getApiUtils());
  }, []);

  const fetchFollowStatus = useCallback((userId: string) => {
    const state = useOxyStore.getState();
    return state.fetchFollowStatus(userId, state.getApiUtils());
  }, []);

  const fetchMultipleStatuses = useCallback((userIds: string[]) => {
    const state = useOxyStore.getState();
    return state.fetchMultipleStatuses(userIds, state.getApiUtils());
  }, []);

  const setFollowingStatus = useCallback((userId: string, status: boolean) => {
    const state = useOxyStore.getState();
    return state.setFollowingStatus(userId, status);
  }, []);

  const clearFollowError = useCallback((userId: string) => {
    const state = useOxyStore.getState();
    return state.clearFollowError(userId);
  }, []);

  const clearAllFollowErrors = useCallback(() => {
    const state = useOxyStore.getState();
    return state.clearAllFollowErrors();
  }, []);

  const loadSettings = useCallback(() => {
    const state = useOxyStore.getState();
    return state.loadSettings(state.getApiUtils());
  }, []);

  const saveSettings = useCallback((updates: any) => {
    const state = useOxyStore.getState();
    return state.saveSettings(updates, state.getApiUtils());
  }, []);

  const syncSettings = useCallback(() => {
    const state = useOxyStore.getState();
    return state.syncSettings(state.getApiUtils());
  }, []);

  const refreshSettings = useCallback(() => {
    const state = useOxyStore.getState();
    return state.refreshSettings(state.getApiUtils());
  }, []);

  const setSettings = useCallback((settings: any) => {
    const state = useOxyStore.getState();
    return state.setSettings(settings);
  }, []);

  const setSettingsLoading = useCallback((loading: boolean) => {
    const state = useOxyStore.getState();
    return state.setLoading(loading);
  }, []);

  const setSettingsSaving = useCallback((saving: boolean) => {
    const state = useOxyStore.getState();
    return state.setSaving(saving);
  }, []);

  const setSettingsError = useCallback((error: string | null) => {
    const state = useOxyStore.getState();
    return state.setError(error);
  }, []);

  const setSettingsOffline = useCallback((offline: boolean) => {
    const state = useOxyStore.getState();
    return state.setOffline(offline);
  }, []);

  const resetSettings = useCallback(() => {
    const state = useOxyStore.getState();
    return state.reset();
  }, []);



  return useMemo(() => ({
    // Context values
    ...context,

    // Authentication state
    user,
    minimalUser,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    error,

    // Auth actions
    login,
    logout,
    logoutAll,
    signUp,
    switchSession,
    removeSession,
    refreshSessions,
    refreshUserData,
    updateProfile,

    // Device management
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    ensureToken,

    // Follow functionality
    followingUsers,
    loadingUsers,
    followErrors: errors,

    // Follow actions
    toggleFollow,
    followUser,
    unfollowUser,
    fetchFollowStatus,
    fetchMultipleStatuses,
    setFollowingStatus,
    clearFollowError,
    clearAllFollowErrors,

    // User Settings
    settings,
    settingsLoading,
    settingsSaving,
    settingsError,
    settingsLastSync,
    settingsOffline,
    loadSettings,
    saveSettings,
    syncSettings,
    refreshSettings,
    setSettings,
    setSettingsLoading,
    setSettingsSaving,
    setSettingsError,
    setSettingsOffline,
    resetSettings,

    // Access to services
    oxyServices,


  }), [
    context,
    user,
    minimalUser,
    sessions,
    activeSessionId,
    isAuthenticated,
    isLoading,
    error,
    followingUsers,
    loadingUsers,
    errors,
    settings,
    settingsLoading,
    settingsSaving,
    settingsError,
    settingsLastSync,
    settingsOffline,
    login,
    logout,
    logoutAll,
    signUp,
    switchSession,
    removeSession,
    refreshSessions,
    refreshUserData,
    updateProfile,
    getDeviceSessions,
    logoutAllDeviceSessions,
    updateDeviceName,
    ensureToken,
    toggleFollow,
    followUser,
    unfollowUser,
    fetchFollowStatus,
    fetchMultipleStatuses,
    setFollowingStatus,
    clearFollowError,
    clearAllFollowErrors,
    loadSettings,
    saveSettings,
    syncSettings,
    refreshSettings,
    setSettings,
    setSettingsLoading,
    setSettingsSaving,
    setSettingsError,
    setSettingsOffline,
    resetSettings,
    oxyServices,
  ]);
};

// Export for legacy support - keeping the original interface
export const OxyProvider = OxyContextProvider;