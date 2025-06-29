/**
 * Authentication store using Zustand
 * Centralized state management for all authentication-related data
 */

import { StateCreator } from 'zustand';
import type { User } from '../models/interfaces';
import type { SecureClientSession, MinimalUserData } from '../models/secureSession';
import type { ApiUtils } from '../utils/api';

export interface AuthState {
  // Authentication data
  user: User | null;
  minimalUser: MinimalUserData | null;
  sessions: SecureClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setMinimalUser: (minimalUser: MinimalUserData | null) => void;
  setSessions: (sessions: SecureClientSession[]) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;

  // Async actions
  login: (username: string, password: string, deviceName?: string, apiUtils?: ApiUtils) => Promise<User>;
  logout: (targetSessionId?: string, apiUtils?: ApiUtils) => Promise<void>;
  logoutAll: (apiUtils?: ApiUtils) => Promise<void>;
  signUp: (username: string, email: string, password: string, apiUtils?: ApiUtils) => Promise<User>;
  refreshUserData: (apiUtils?: ApiUtils) => Promise<void>;
  refreshSessions: (apiUtils?: ApiUtils) => Promise<void>;
  switchSession: (sessionId: string, apiUtils?: ApiUtils) => Promise<void>;
  removeSession: (sessionId: string, apiUtils?: ApiUtils) => Promise<void>;
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

  // Synchronous actions
  setUser: (user) => set((state) => {
    const isAuthenticated = !!user;
    const minimalUser = user ? {
      id: user.id,
      username: user.username,
      avatar: user.avatar ? {
        id: user.avatar.id,
        url: user.avatar.url
      } : undefined
    } : null;
    
    return {
      user,
      minimalUser,
      isAuthenticated,
      error: null // Clear error on successful user set
    };
  }),

  setMinimalUser: (minimalUser) => set({ minimalUser }),

  setSessions: (sessions) => set({ sessions }),

  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  clearError: () => set({ error: null }),

  reset: () => set({
    user: null,
    minimalUser: null,
    sessions: [],
    activeSessionId: null,
    isAuthenticated: false,
    isLoading: false,
    error: null
  }),

  // Async actions
  login: async (username, password, deviceName, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set({ isLoading: true, error: null });
    
    try {
      const user = await apiUtils.login(username, password, deviceName);
      
      // Update state with user data
      get().setUser(user);
      
      // Refresh sessions after login
      try {
        await get().refreshSessions(apiUtils);
      } catch (sessionError) {
        console.warn('Failed to refresh sessions after login:', sessionError);
      }
      
      set({ isLoading: false });
      return user;
    } catch (error: any) {
      const errorMessage = error?.message || 'Login failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  logout: async (targetSessionId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set({ isLoading: true, error: null });
    
    try {
      await apiUtils.logout(targetSessionId);
      
      if (!targetSessionId) {
        // Full logout - clear all state
        get().reset();
      } else {
        // Partial logout - just refresh sessions
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
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set({ isLoading: true, error: null });
    
    try {
      await apiUtils.logoutAll();
      get().reset();
    } catch (error: any) {
      // Even if logout fails, clear local state
      get().reset();
      console.warn('Logout all failed, but cleared local state:', error);
    }
  },

  signUp: async (username, email, password, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set({ isLoading: true, error: null });
    
    try {
      const user = await apiUtils.signUp(username, email, password);
      get().setUser(user);
      set({ isLoading: false });
      return user;
    } catch (error: any) {
      const errorMessage = error?.message || 'Registration failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  refreshUserData: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      const user = await apiUtils.getCurrentUser();
      get().setUser(user);
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to refresh user data';
      set({ error: errorMessage });
      throw error;
    }
  },

  refreshSessions: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      const sessions = await apiUtils.getSessions();
      set({ sessions });
    } catch (error: any) {
      console.warn('Failed to refresh sessions:', error);
      // Don't throw error for sessions refresh to prevent blocking other operations
    }
  },

  switchSession: async (sessionId, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    set({ isLoading: true, error: null });
    
    try {
      await apiUtils.switchSession(sessionId);
      set({ activeSessionId: sessionId });
      
      // Refresh user data for the new session
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
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      await apiUtils.removeSession(sessionId);
      await get().refreshSessions(apiUtils);
    } catch (error: any) {
      const errorMessage = error?.message || 'Remove session failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  updateProfile: async (updates, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
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

  // Device management
  getDeviceSessions: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      return await apiUtils.getDeviceSessions();
    } catch (error: any) {
      console.warn('Failed to get device sessions:', error);
      return [];
    }
  },

  logoutAllDeviceSessions: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      await apiUtils.logoutAllDeviceSessions();
    } catch (error: any) {
      const errorMessage = error?.message || 'Logout all device sessions failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  updateDeviceName: async (deviceName, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      await apiUtils.updateDeviceName(deviceName);
    } catch (error: any) {
      const errorMessage = error?.message || 'Update device name failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  ensureToken: async (apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils is required');
    
    try {
      await apiUtils.ensureToken();
    } catch (error: any) {
      const errorMessage = error?.message || 'Token validation failed';
      set({ error: errorMessage });
      throw error;
    }
  }
});

// Selectors for optimized component re-renders
export const authSelectors = {
  selectUser: (state: AuthState) => state.user,
  selectMinimalUser: (state: AuthState) => state.minimalUser,
  selectSessions: (state: AuthState) => state.sessions,
  selectActiveSessionId: (state: AuthState) => state.activeSessionId,
  selectIsAuthenticated: (state: AuthState) => state.isAuthenticated,
  selectIsLoading: (state: AuthState) => state.isLoading,
  selectError: (state: AuthState) => state.error,
  selectUserProfile: (state: AuthState) => state.user ? {
    id: state.user.id,
    username: state.user.username,
    name: state.user.name,
    bio: state.user.bio,
    avatar: state.user.avatar,
    email: state.user.email
  } : null,
  selectSessionCount: (state: AuthState) => state.sessions.length,
  selectHasActiveSessions: (state: AuthState) => state.sessions.length > 0
};