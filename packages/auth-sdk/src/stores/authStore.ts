import { create } from 'zustand';
import type { User } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';

const debug = createDebugLogger('AuthStore');

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  lastUserFetch: number | null; // Timestamp of last user fetch for caching
  
  loginSuccess: (user: User) => void;
  loginFailure: (error: string) => void;
  logout: () => void;
  fetchUser: (oxyServices: { getCurrentUser: () => Promise<User> }, forceRefresh?: boolean) => Promise<void>;
  setUser: (user: User) => void; // Direct user setter for caching
}

export const useAuthStore = create<AuthState>((set: (state: Partial<AuthState>) => void, get: () => AuthState) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  lastUserFetch: null,
  
  loginSuccess: (user: User) => set({ 
    isLoading: false, 
    isAuthenticated: true, 
    user, 
    lastUserFetch: Date.now(),
  }),
  loginFailure: (error: string) => set({ isLoading: false, error }),
  logout: () => set({ 
    user: null, 
    isAuthenticated: false, 
    lastUserFetch: null,
  }),
  setUser: (user: User) => set({ user, lastUserFetch: Date.now() }),
  fetchUser: async (oxyServices, forceRefresh = false) => {
    const state = get();
    const now = Date.now();
    const cacheAge = state.lastUserFetch ? now - state.lastUserFetch : Number.POSITIVE_INFINITY;
    const cacheValid = cacheAge < 5 * 60 * 1000; // 5 minutes cache

    // Use cached data if available and not forcing refresh
    if (!forceRefresh && state.user && cacheValid) {
      debug.log('Using cached user data (age:', cacheAge, 'ms)');
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const user = await oxyServices.getCurrentUser();
      set({ user, isLoading: false, isAuthenticated: true, lastUserFetch: now });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch user';
      debug.error('Error fetching user:', error);
      set({ error: errorMessage, isLoading: false });
    }
  },
})); 