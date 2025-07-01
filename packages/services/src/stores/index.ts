/**
 * Main Store - Session-based Authentication with Database Backing
 * 
 * Updated to support session-based authentication with proper multiple session management.
 * 
 * Persistence Strategy:
 * - PERSIST: Session tokens, active session ID, app-level settings (theme, fontSize, language)
 * - DON'T PERSIST: User profile data, sessions list, user settings (always fetched fresh from backend)
 * - SYNC: All user data fetched fresh from backend using session tokens
 * 
 * Key Features:
 * - Multiple session management per user
 * - Database-backed session storage
 * - Proper token lifecycle management
 * - Session validation and cleanup
 * - Seamless integration with OxyServices core
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAuthSlice, type AuthState } from './authStore';
import { createFollowSlice, type FollowState } from './followStore';
import { createThemeSlice, type ThemeState } from './themeStore';
import { createUserSettingsSlice, type UserSettingsState } from './userSettingsStore';
import type { OxyServices } from '../core';
import { createApiUtils, type ApiUtils } from '../utils/api';

// === COMBINED STORE INTERFACE ===

export interface OxyStore extends AuthState, FollowState, ThemeState, UserSettingsState {
  // Store metadata
  _apiUtils: ApiUtils | null;
  _oxyServices: OxyServices | null;
  
  // Store initialization
  initialize: (oxyServices: OxyServices) => void;
  getApiUtils: () => ApiUtils;
}

// === PLATFORM DETECTION ===

function isReactNative(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// === STORAGE CONFIGURATION ===

const noOpStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
};

const storage = isReactNative()
  ? createJSONStorage(() => AsyncStorage)
  : isBrowser()
    ? createJSONStorage(() => window.localStorage)
    : createJSONStorage(() => noOpStorage);

// === MAIN STORE ===

export const useOxyStore = create<OxyStore>()(
  persist(
    subscribeWithSelector((set, get, api) => ({
      // Store metadata
      _apiUtils: null,
      _oxyServices: null,
      
      // Store initialization
      initialize: (oxyServices: OxyServices) => {
        const apiUtils = createApiUtils(oxyServices);
        set({ _apiUtils: apiUtils, _oxyServices: oxyServices });
      },
      
      getApiUtils: () => {
        const state = get();
        if (!state._apiUtils) {
          throw new Error('Store not initialized. Call initialize() with OxyServices first.');
        }
        return state._apiUtils;
      },
      
      // Store slices
      ...createAuthSlice(set, get, api),
      ...createFollowSlice(set, get, api),
      ...createThemeSlice(set, get, api),
      ...createUserSettingsSlice(set, get, api),
    })),
    {
      name: 'oxy-store',
      storage,
      
      // === PERSISTENCE STRATEGY ===
      partialize: (state) => ({
        // Session Management - PERSIST tokens and active session (only if valid)
        sessions: state.sessions || [],
        activeSessionId: state.activeSessionId,
        accessToken: (state.accessToken && typeof state.accessToken === 'string' && state.accessToken.trim() !== '') ? state.accessToken : null,
        refreshToken: (state.refreshToken && typeof state.refreshToken === 'string' && state.refreshToken.trim() !== '') ? state.refreshToken : null,
        
        // App-level Settings - PERSIST user preferences
        theme: state.theme || 'light',
        fontSize: state.fontSize || 'medium',
        language: state.language || 'en',
      }),
      
      onRehydrateStorage: () => (state, error) => {
        console.log('[MainStore] Rehydration started');
        
        if (error) {
          console.error('[MainStore] Rehydration error:', error);
          return;
        }
        
        if (!state) {
          console.warn('[MainStore] No state to rehydrate');
          return;
        }
        
        console.log('[MainStore] Store rehydrated successfully. Session state:', {
          hasActiveSession: !!state.activeSessionId,
          sessionCount: state.sessions?.length || 0,
          hasAccessToken: !!state.accessToken,
          hasRefreshToken: !!state.refreshToken,
          accessTokenPreview: state.accessToken ? state.accessToken.substring(0, 20) + '...' : null,
          refreshTokenPreview: state.refreshToken ? state.refreshToken.substring(0, 20) + '...' : null,
          theme: state.theme,
          language: state.language
        });
        
        // Enhanced session restoration with proper initialization order
        setTimeout(async () => {
          try {
            // Wait for OxyServices to be available (it gets set during initializeOxyStore)
            let attempts = 0;
            const maxAttempts = 10;
            
            while (!state._oxyServices && attempts < maxAttempts) {
              console.log('[MainStore] Waiting for OxyServices initialization... attempt', attempts + 1);
              await new Promise(resolve => setTimeout(resolve, 100));
              attempts++;
            }
            
            const oxyServices = state._oxyServices;
            
            if (!oxyServices) {
              console.warn('[MainStore] OxyServices still not available after waiting, skipping rehydration');
              return;
            }
            
            console.log('[MainStore] OxyServices available, proceeding with session restoration');
            
            // Load sessions into OxyServices
            if (state.sessions && state.sessions.length > 0) {
              console.log('[MainStore] Loading', state.sessions.length, 'sessions into OxyServices');
              oxyServices.loadSessions(state.sessions);
            }
            
            // Restore active session if available
            if (state.activeSessionId && state.accessToken && state.refreshToken && 
                typeof state.accessToken === 'string' && typeof state.refreshToken === 'string' &&
                state.accessToken.trim() !== '' && state.refreshToken.trim() !== '') {
              console.log('[MainStore] Restoring active session:', state.activeSessionId.substring(0, 8) + '...');
              
              // Try to set the session in OxyServices
              try {
                oxyServices.setSession(
                  state.activeSessionId,
                  state.accessToken,
                  state.refreshToken
                );
                
                console.log('[MainStore] Session set successfully, validating...');
                
                // Validate the session
                const isValid = await oxyServices.validate();
                if (isValid) {
                  console.log('[MainStore] Session validation successful, syncing from backend');
                  // Only sync if ApiUtils is available
                  if (state._apiUtils) {
                    await state.syncFromBackend?.(state._apiUtils);
                  } else {
                    console.log('[MainStore] ApiUtils not available yet, will sync later');
                  }
                } else {
                  console.warn('[MainStore] Session validation failed, clearing invalid session');
                  state.clearUserData?.();
                }
              } catch (error) {
                console.error('[MainStore] Failed to set session during rehydration:', error);
                state.clearUserData?.();
                return;
              }
            } else if (state.accessToken && state.refreshToken && 
                       typeof state.accessToken === 'string' && typeof state.refreshToken === 'string' &&
                       state.accessToken.trim() !== '' && state.refreshToken.trim() !== '') {
              // Fallback: restore tokens even without session ID
              console.log('[MainStore] Restoring tokens without session ID (legacy mode)');
              try {
                oxyServices.setTokens(state.accessToken, state.refreshToken);
                
                const isValid = await oxyServices.validate();
                if (isValid) {
                  if (state._apiUtils) {
                    await state.syncFromBackend?.(state._apiUtils);
                  } else {
                    console.log('[MainStore] ApiUtils not available yet for legacy token sync');
                  }
                } else {
                  console.warn('[MainStore] Token validation failed');
                  state.clearUserData?.();
                }
              } catch (error) {
                console.error('[MainStore] Failed to set tokens during rehydration:', error);
                state.clearUserData?.();
                return;
              }
            } else {
              console.log('[MainStore] No tokens to restore');
            }
            
          } catch (error) {
            console.error('[MainStore] Session restoration failed:', error);
            // Clear potentially corrupted state
            state.clearUserData?.();
          }
        }, 100); // Start checking sooner
      },
    }
  )
);

// === CONVENIENCE HOOKS ===

export const useAuth = () => useOxyStore((state) => ({
  // State
  user: state.user,
  minimalUser: state.minimalUser,
  sessions: state.sessions,
  activeSessionId: state.activeSessionId,
  isAuthenticated: state.isAuthenticated,
  isLoading: state.isLoading,
  error: state.error,
  
  // State management
  setUser: state.setUser,
  setMinimalUser: state.setMinimalUser,
  setSessions: state.setSessions,
  setActiveSessionId: state.setActiveSessionId,
  setLoading: state.setLoading,
  setError: state.setError,
  clearError: state.clearError,
  
  // Data management
  reset: state.reset,
  clearUserData: state.clearUserData,
  syncFromBackend: () => state.syncFromBackend(state.getApiUtils()),
  
  // Authentication
  login: (username: string, password: string, deviceName?: string) => 
    state.login(username, password, deviceName, state.getApiUtils()),
  logout: (targetSessionId?: string) => 
    state.logout(targetSessionId, state.getApiUtils()),
  logoutAll: () => 
    state.logoutAll(state.getApiUtils()),
  signUp: (username: string, email: string, password: string) => 
    state.signUp(username, email, password, state.getApiUtils()),
  
  // Data refresh
  refreshUserData: () => 
    state.refreshUserData(state.getApiUtils()),
  refreshSessions: () => 
    state.refreshSessions(state.getApiUtils()),
  
  // Session management
  switchSession: (sessionId: string) => 
    state.switchSession(sessionId, state.getApiUtils()),
  removeSession: (sessionId: string) => 
    state.removeSession(sessionId, state.getApiUtils()),
  
  // Profile management
  updateProfile: (updates: Record<string, any>) => 
    state.updateProfile(updates, state.getApiUtils()),
  
  // Device management
  getDeviceSessions: () => 
    state.getDeviceSessions(state.getApiUtils()),
  logoutAllDeviceSessions: () => 
    state.logoutAllDeviceSessions(state.getApiUtils()),
  updateDeviceName: (deviceName: string) => 
    state.updateDeviceName(deviceName, state.getApiUtils()),
  ensureToken: () => 
    state.ensureToken(state.getApiUtils()),
}));

export const useFollow = () => useOxyStore((state) => ({
  // State
  followingUsers: state.followingUsers,
  loadingUsers: state.loadingUsers,
  errors: state.errors,
  
  // Actions
  setFollowingStatus: state.setFollowingStatus,
  setLoadingStatus: state.setLoadingStatus,
  setFollowError: state.setFollowError,
  clearFollowError: state.clearFollowError,
  clearAllFollowErrors: state.clearAllFollowErrors,
  setMultipleStatuses: state.setMultipleStatuses,
  
  // Async actions
  toggleFollow: (userId: string) => 
    state.toggleFollow(userId, state.getApiUtils()),
  fetchFollowStatus: (userId: string) => 
    state.fetchFollowStatus(userId, state.getApiUtils()),
  followUser: (userId: string) => 
    state.followUser(userId, state.getApiUtils()),
  unfollowUser: (userId: string) => 
    state.unfollowUser(userId, state.getApiUtils()),
  fetchMultipleStatuses: (userIds: string[]) => 
    state.fetchMultipleStatuses(userIds, state.getApiUtils()),
}));

export const useTheme = () => useOxyStore((state) => ({
  // State
  theme: state.theme,
  fontSize: state.fontSize,
  language: state.language,
  
  // Actions
  setTheme: state.setTheme,
  setFontSize: state.setFontSize,
  setLanguage: state.setLanguage,
  reset: state.reset,
  getEffectiveTheme: state.getEffectiveTheme,
}));

export const useUserSettings = () => useOxyStore((state) => ({
  // State
  settings: state.settings,
  isLoading: state.isLoading,
  isSaving: state.isSaving,
  error: state.error,
  lastSync: state.lastSync,
  isOffline: state.isOffline,
  
  // Actions
  setSettings: state.setSettings,
  setLoading: state.setLoading,
  setSaving: state.setSaving,
  setError: state.setError,
  setOffline: state.setOffline,
  reset: state.reset,
  clearUserSettings: state.clearUserSettings,
  
  // Async actions
  loadSettings: () => 
    state.loadSettings(state.getApiUtils()),
  saveSettings: (updates: any) => 
    state.saveSettings(updates, state.getApiUtils()),
  syncSettings: () => 
    state.syncSettings(state.getApiUtils()),
  refreshSettings: () => 
    state.refreshSettings(state.getApiUtils()),
}));

// === OPTIMIZED HOOKS ===

export const useAuthUser = () => useOxyStore((state) => state.user);
export const useIsAuthenticated = () => useOxyStore((state) => state.isAuthenticated);
export const useAuthLoading = () => useOxyStore((state) => state.isLoading);
export const useAuthError = () => useOxyStore((state) => state.error);
export const useAuthSessions = () => useOxyStore((state) => state.sessions);
export const useAuthTokens = () => useOxyStore((state) => ({
  accessToken: state.accessToken,
  refreshToken: state.refreshToken,
}));

// === FOLLOW HOOKS ===

export const useUserFollowStatus = (userId: string) => useOxyStore((state) => ({
  isFollowing: state.followingUsers[userId] ?? false,
  isLoading: state.loadingUsers[userId] ?? false,
  error: state.errors[userId] ?? null,
}));

export const useMultipleFollowStatuses = (userIds: string[]) => useOxyStore((state) => {
  const statuses: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }> = {};
  
  userIds.forEach(userId => {
    statuses[userId] = {
      isFollowing: state.followingUsers[userId] ?? false,
      isLoading: state.loadingUsers[userId] ?? false,
      error: state.errors[userId] ?? null,
    };
  });
  
  return statuses;
});

// === STORE INITIALIZATION ===

export const initializeOxyStore = (oxyServices: OxyServices) => {
  console.log('[OxyStore] Initializing store with OxyServices');
  
  const state = useOxyStore.getState();
  console.log('[OxyStore] Current persisted state:', {
    hasAccessToken: !!state.accessToken,
    hasRefreshToken: !!state.refreshToken,
    accessTokenLength: state.accessToken?.length || 0,
    refreshTokenLength: state.refreshToken?.length || 0,
    accessTokenPreview: state.accessToken?.substring(0, 20) + '...',
    theme: state.theme,
    fontSize: state.fontSize,
    language: state.language,
  });
  
  // Initialize store
  useOxyStore.getState().initialize(oxyServices);
  
  // Restore tokens to OxyServices if available (both must be valid)
  if (state.accessToken && state.refreshToken && 
      typeof state.accessToken === 'string' && typeof state.refreshToken === 'string' &&
      state.accessToken.trim() !== '' && state.refreshToken.trim() !== '') {
    console.log('[OxyStore] Restoring tokens to OxyServices:', {
      restoringAccessToken: !!state.accessToken,
      restoringRefreshToken: !!state.refreshToken,
      accessTokenLength: state.accessToken.length,
      refreshTokenLength: state.refreshToken.length,
    });
    
    // Set tokens on OxyServices
    try {
      oxyServices.setTokens(state.accessToken, state.refreshToken);
    } catch (error) {
      console.error('[OxyStore] Failed to restore tokens to OxyServices:', error);
      useOxyStore.getState().clearUserData();
      return;
    }
    
          // Trigger sync from backend to validate tokens and get user data
      setTimeout(async () => {
        try {
          const currentState = useOxyStore.getState();
          
          // Ensure store is initialized with ApiUtils before syncing
          if (!currentState._apiUtils) {
            console.warn('[OxyStore] ApiUtils not available yet, skipping sync during initialization');
            return;
          }
          
          if (currentState.accessToken && currentState.refreshToken &&
              typeof currentState.accessToken === 'string' && typeof currentState.refreshToken === 'string' &&
              currentState.accessToken.trim() !== '' && currentState.refreshToken.trim() !== '') {
            console.log('[OxyStore] Syncing user data from backend using persisted tokens');
            await currentState.syncFromBackend(currentState._apiUtils);
            console.log('[OxyStore] Backend sync completed successfully');
          }
        } catch (error) {
          console.warn('[OxyStore] Backend sync failed, clearing invalid tokens:', error);
          useOxyStore.getState().clearUserData();
        }
      }, 200); // Longer timeout to ensure initialization
  } else {
    console.log('[OxyStore] No persisted tokens found - user needs to login');
  }
};

// === EXPORTS ===

export type { AuthState, FollowState, ThemeState, UserSettingsState };
export { authSelectors } from './authStore';