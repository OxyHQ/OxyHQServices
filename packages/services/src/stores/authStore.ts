/**
 * Authentication Store - Session-based Authentication with Database Backing
 * 
 * This store now provides session-based authentication with proper multiple session support.
 * 
 * Key Features:
 * - Multiple session management per user
 * - Database-backed session storage
 * - Proper token lifecycle management
 * - Session validation and cleanup
 * - Seamless integration with OxyServices core
 * 
 * Persistence Strategy:
 * - PERSIST: Session tokens, active session ID, app-level settings
 * - DON'T PERSIST: User profile data (fetched fresh from backend)
 * - SYNC: User data always fresh from backend using session tokens
 */

import { StateCreator } from 'zustand';
import { User } from '../models/interfaces';
import type { MinimalUserData } from '../models/secureSession';
import type { ApiUtils } from '../utils/api';

// Session type for the new session-based authentication
export interface SessionData {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  deviceId?: string;
  deviceName?: string;
  expiresAt: string;
  lastActivity: string;
  isActive: boolean;
}

export interface AuthState {
  // Session Management
  sessions: Array<SessionData>;
  activeSessionId: string | null;
  
  // User Data (not persisted - always fresh from backend)
  user: User | null;
  minimalUser: MinimalUserData | null;
  
  // Authentication State
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // App-level Settings (persisted)
  theme: 'light' | 'dark' | 'auto';
  fontSize: 'small' | 'medium' | 'large';
  language: string;
  
  // Tokens (only things that should persist)
  accessToken: string | null;
  refreshToken: string | null;

  // State management actions
  setUser: (user: User | null, accessToken?: string | null, refreshToken?: string | null) => void;
  setMinimalUser: (minimalUser: MinimalUserData | null) => void;
  setSessions: (sessions: Array<SessionData>) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  
  // Data management
  reset: () => void;
  clearUserData: () => void;
  syncFromBackend: (apiUtils?: ApiUtils) => Promise<void>;

  // Authentication actions
  login: (username: string, password: string, deviceName?: string, apiUtils?: ApiUtils) => Promise<User>;
  logout: (targetSessionId?: string, apiUtils?: ApiUtils) => Promise<void>;
  logoutAll: (apiUtils?: ApiUtils) => Promise<void>;
  signUp: (username: string, email: string, password: string, apiUtils?: ApiUtils) => Promise<User>;
  
  // Data refresh actions
  refreshUserData: (apiUtils?: ApiUtils) => Promise<void>;
  refreshSessions: (apiUtils?: ApiUtils) => Promise<void>;
  
  // Session management
  switchSession: (sessionId: string, apiUtils?: ApiUtils) => Promise<void>;
  removeSession: (sessionId: string, apiUtils?: ApiUtils) => Promise<void>;
  
  // Profile management
  updateProfile: (updates: Record<string, any>, apiUtils?: ApiUtils) => Promise<User>;
  
  // Device management
  getDeviceSessions: (apiUtils?: ApiUtils) => Promise<any[]>;
  logoutAllDeviceSessions: (apiUtils?: ApiUtils) => Promise<void>;
  updateDeviceName: (deviceName: string, apiUtils?: ApiUtils) => Promise<void>;
  ensureToken: (apiUtils?: ApiUtils) => Promise<void>;
}

export const createAuthSlice: StateCreator<AuthState> = (set, get) => ({
  // Initial state
  user: null,
  minimalUser: null,
  sessions: [],
  activeSessionId: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  accessToken: null,
  refreshToken: null,
  theme: 'light',
  fontSize: 'medium',
  language: 'en',

  // === STATE MANAGEMENT ACTIONS ===
  
  setUser: (user, accessToken = null, refreshToken = null) => set((state) => {
    const isAuthenticated = !!user;
    const minimalUser = user ? {
      id: user.id,
      username: user.username,
      avatar: user.avatar
    } : null;
    
    console.log('[AuthStore] Setting user and tokens:', {
      hasUser: !!user,
      username: user?.username,
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      accessTokenLength: accessToken?.length || 0,
      refreshTokenLength: refreshToken?.length || 0,
    });
    
    return {
      user,
      minimalUser,
      isAuthenticated,
      error: null,
      // IMPORTANT: Always update tokens when provided, preserve existing when null
      accessToken: accessToken !== null ? accessToken : state.accessToken,
      refreshToken: refreshToken !== null ? refreshToken : state.refreshToken,
    };
  }),

  setMinimalUser: (minimalUser) => set({ minimalUser }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
  clearError: () => set({ error: null }),

  // === DATA MANAGEMENT ===
  
  reset: () => set({
    user: null,
    minimalUser: null,
    sessions: [],
    activeSessionId: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    accessToken: null,
    refreshToken: null,
    theme: 'light',
    fontSize: 'medium',
    language: 'en',
  }),

  clearUserData: () => {
    console.log('[AuthStore] Clearing all user data');
    
    // Reset all state
    get().reset();
    
    // Clear legacy storage data
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem('oxy-auth');
        window.localStorage.removeItem('user-settings-storage');
        console.log('[AuthStore] Cleared legacy storage data');
      } catch (error) {
        console.warn('[AuthStore] Failed to clear legacy storage:', error);
      }
    }
  },

  syncFromBackend: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required for backend sync');
    
    try {
      set({ isLoading: true, error: null });
      console.log('[AuthStore] Syncing all data from backend');
      
      const oxyServices = apiUtils.getOxyServices();
      const currentState = get();
      
      // Check if we have tokens in store state
      console.log('[AuthStore] Current token state:', {
        storeAccessToken: !!currentState.accessToken,
        storeRefreshToken: !!currentState.refreshToken,
        serviceAccessToken: !!oxyServices.getAccessToken(),
        serviceRefreshToken: !!oxyServices.getRefreshToken(),
      });
      
      // Ensure OxyServices has tokens if store has them
      if (currentState.accessToken && currentState.refreshToken &&
          typeof currentState.accessToken === 'string' && typeof currentState.refreshToken === 'string' &&
          currentState.accessToken.trim() !== '' && currentState.refreshToken.trim() !== '') {
        if (!oxyServices.getAccessToken()) {
          console.log('[AuthStore] Restoring tokens to OxyServices from store');
          try {
            oxyServices.setTokens(currentState.accessToken, currentState.refreshToken);
          } catch (error) {
            console.error('[AuthStore] Failed to restore tokens to OxyServices during sync:', error);
            throw new Error('Invalid tokens in store state');
          }
        }
      }
      
      // Validate tokens and get current user
      const user = await apiUtils.getCurrentUser();
      if (!user) {
        throw new Error('No user found - invalid tokens');
      }
      
      // Get current tokens from OxyServices (in case they were refreshed)
      const accessToken = oxyServices.getAccessToken();
      const refreshToken = oxyServices.getRefreshToken();
      
      console.log('[AuthStore] Backend sync - token status:', {
        userFound: !!user,
        serviceHasAccessToken: !!accessToken,
        serviceHasRefreshToken: !!refreshToken,
        tokensChanged: accessToken !== currentState.accessToken || refreshToken !== currentState.refreshToken,
      });
      
      // Update store with user and current tokens
      get().setUser(user, accessToken, refreshToken);
      
      // If tokens changed, update store state directly
      if (accessToken !== currentState.accessToken || refreshToken !== currentState.refreshToken) {
        console.log('[AuthStore] Tokens were refreshed during sync, updating store');
        set({ 
          accessToken: accessToken || currentState.accessToken,
          refreshToken: refreshToken || currentState.refreshToken
        });
      }
      
      // Fetch sessions from backend
      try {
        const rawSessions = await apiUtils.getSessions();
        // Transform API sessions to our session format
        const sessions: SessionData[] = rawSessions.map(session => ({
          sessionId: session.sessionId,
          accessToken: '', // Not provided by API - will be filled by OxyServices
          refreshToken: '', // Not provided by API - will be filled by OxyServices
          userId: session.userId || '',
          deviceId: session.deviceId,
          deviceName: session.deviceName || '',
          expiresAt: session.expiresAt || new Date().toISOString(),
          lastActivity: session.lastActivity,
          isActive: true // Default to active for API sessions
        }));
        set({ sessions });
        console.log('[AuthStore] Synced sessions:', sessions.length);
      } catch (sessionError) {
        console.warn('[AuthStore] Failed to sync sessions:', sessionError);
      }
      
      set({ isLoading: false });
      console.log('[AuthStore] Backend sync completed successfully');
      
    } catch (error: any) {
      const errorMessage = error?.message || 'Backend sync failed';
      set({ error: errorMessage, isLoading: false });
      console.error('[AuthStore] Backend sync failed:', error);
      throw error;
    }
  },

  // === AUTHENTICATION ACTIONS ===
  
  login: async (username, password, deviceName, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    set({ isLoading: true, error: null });
    
    try {
      console.log('[AuthStore] Logging in user:', username);
      
      const oxyServices = apiUtils.getOxyServices();
      const loginResponse = await oxyServices.secureLogin(username, password, deviceName);
      
      console.log('[AuthStore] Login successful:', {
        sessionId: loginResponse.sessionId?.substring(0, 8) + '...',
        username: loginResponse.user?.username,
        hasAccessToken: !!loginResponse.accessToken,
        hasRefreshToken: !!loginResponse.refreshToken,
        accessTokenLength: loginResponse.accessToken?.length || 0,
        refreshTokenLength: loginResponse.refreshToken?.length || 0,
      });
      
      // IMPORTANT: Set tokens in store first for persistence
      set({ 
        activeSessionId: loginResponse.sessionId,
        accessToken: loginResponse.accessToken,
        refreshToken: loginResponse.refreshToken
      });
      
      // Set user with tokens (this will preserve the tokens we just set)
      get().setUser(loginResponse.user, loginResponse.accessToken, loginResponse.refreshToken);
      
      // Ensure OxyServices has the tokens too (it should from secureLogin, but let's be sure)
      if (loginResponse.accessToken && loginResponse.refreshToken &&
          typeof loginResponse.accessToken === 'string' && typeof loginResponse.refreshToken === 'string' &&
          loginResponse.accessToken.trim() !== '' && loginResponse.refreshToken.trim() !== '') {
        try {
          oxyServices.setTokens(loginResponse.accessToken, loginResponse.refreshToken);
          console.log('[AuthStore] Tokens synchronized with OxyServices');
        } catch (error) {
          console.error('[AuthStore] Failed to synchronize tokens with OxyServices:', error);
          // Don't throw here, the login was successful, just log the issue
        }
      } else {
        console.warn('[AuthStore] Login response missing valid tokens:', {
          hasAccessToken: !!loginResponse.accessToken,
          hasRefreshToken: !!loginResponse.refreshToken,
          accessTokenType: typeof loginResponse.accessToken,
          refreshTokenType: typeof loginResponse.refreshToken,
        });
      }
      
      // Immediately add current session to sessions array for persistence
      const currentSession: SessionData = {
        sessionId: loginResponse.sessionId,
        accessToken: loginResponse.accessToken,
        refreshToken: loginResponse.refreshToken,
        userId: loginResponse.user.id,
        deviceId: loginResponse.deviceId,
        deviceName: deviceName || 'Unknown Device',
        expiresAt: loginResponse.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        lastActivity: new Date().toISOString(),
        isActive: true
      };
      
      // Update sessions array
      set({ sessions: [currentSession] });
      console.log('[AuthStore] Added current session to sessions array');
      
      // Also try to refresh sessions from backend (but don't fail if this fails)
      try {
        await get().refreshSessions(apiUtils);
      } catch (sessionError) {
        console.warn('[AuthStore] Failed to refresh sessions from backend after login:', sessionError);
        // Continue - we already have the current session
      }
      
      set({ isLoading: false });
      console.log('[AuthStore] Login completed successfully');
      return loginResponse.user;
      
    } catch (error: any) {
      const errorMessage = error?.message || 'Login failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  logout: async (targetSessionId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    set({ isLoading: true, error: null });
    
    try {
      await apiUtils.logout(targetSessionId);
      
      if (!targetSessionId) {
        // Full logout - clear everything
        get().clearUserData();
      } else {
        // Partial logout - refresh sessions
        await get().refreshSessions(apiUtils);
      }
      
      set({ isLoading: false });
      
    } catch (error: any) {
      const errorMessage = error?.message || 'Logout failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  logoutAll: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    set({ isLoading: true, error: null });
    
    try {
      await apiUtils.logoutAll();
      get().clearUserData();
    } catch (error: any) {
      // Clear local state even if request fails
      get().clearUserData();
      console.warn('[AuthStore] Logout all failed, but cleared local state:', error);
    }
  },

  signUp: async (username, email, password, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    set({ isLoading: true, error: null });
    
    try {
      const user = await apiUtils.signUp(username, email, password);
      const oxyServices = apiUtils.getOxyServices();
      get().setUser(user, oxyServices?.getAccessToken?.() ?? null, oxyServices?.getRefreshToken?.() ?? null);
      set({ isLoading: false });
      return user;
    } catch (error: any) {
      const errorMessage = error?.message || 'Registration failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  // === DATA REFRESH ACTIONS ===
  
  refreshUserData: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      const user = await apiUtils.getCurrentUser();
      const currentState = get();
      get().setUser(user, currentState.accessToken, currentState.refreshToken);
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to refresh user data';
      set({ error: errorMessage });
      throw error;
    }
  },

  refreshSessions: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      const rawSessions = await apiUtils.getSessions();
      // Transform API sessions to our session format
      const sessions: SessionData[] = rawSessions.map(session => ({
        sessionId: session.sessionId,
        accessToken: '', // Not provided by API - will be filled by OxyServices
        refreshToken: '', // Not provided by API - will be filled by OxyServices
        userId: session.userId || '',
        deviceId: session.deviceId,
        deviceName: session.deviceName || '',
        expiresAt: session.expiresAt || new Date().toISOString(),
        lastActivity: session.lastActivity,
        isActive: true // Default to active for API sessions
      }));
      set({ sessions });
    } catch (error: any) {
      console.warn('[AuthStore] Failed to refresh sessions:', error);
    }
  },

  // === SESSION MANAGEMENT ===
  
  switchSession: async (sessionId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    set({ isLoading: true, error: null });
    
    try {
      await apiUtils.switchSession(sessionId);
      set({ activeSessionId: sessionId });
      
      await get().refreshUserData(apiUtils);
      await get().refreshSessions(apiUtils);
      
      set({ isLoading: false });
    } catch (error: any) {
      const errorMessage = error?.message || 'Session switch failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  removeSession: async (sessionId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      await apiUtils.removeSession(sessionId);
      await get().refreshSessions(apiUtils);
    } catch (error: any) {
      const errorMessage = error?.message || 'Remove session failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  // === PROFILE MANAGEMENT ===
  
  updateProfile: async (updates, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    set({ isLoading: true, error: null });
    
    try {
      const updatedUser = await apiUtils.updateProfile(updates);
      get().setUser(updatedUser);
      set({ isLoading: false });
      return updatedUser;
    } catch (error: any) {
      const errorMessage = error?.message || 'Profile update failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  // === DEVICE MANAGEMENT ===
  
  getDeviceSessions: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      return await apiUtils.getDeviceSessions();
    } catch (error: any) {
      console.warn('[AuthStore] Failed to get device sessions:', error);
      return [];
    }
  },

  logoutAllDeviceSessions: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      await apiUtils.logoutAllDeviceSessions();
    } catch (error: any) {
      const errorMessage = error?.message || 'Logout all device sessions failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  updateDeviceName: async (deviceName, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      await apiUtils.updateDeviceName(deviceName);
    } catch (error: any) {
      const errorMessage = error?.message || 'Update device name failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  ensureToken: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required');
    
    try {
      await apiUtils.ensureToken();
    } catch (error: any) {
      const errorMessage = error?.message || 'Token validation failed';
      set({ error: errorMessage });
      throw error;
    }
  },
});

// Selectors for optimized re-renders
export const authSelectors = {
  selectUser: (state: AuthState) => state.user,
  selectMinimalUser: (state: AuthState) => state.minimalUser,
  selectSessions: (state: AuthState) => state.sessions,
  selectActiveSessionId: (state: AuthState) => state.activeSessionId,
  selectIsAuthenticated: (state: AuthState) => state.isAuthenticated,
  selectIsLoading: (state: AuthState) => state.isLoading,
  selectError: (state: AuthState) => state.error,
  selectTokens: (state: AuthState) => ({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
  }),
};