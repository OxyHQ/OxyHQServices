import { create } from 'zustand';
import type { User } from '../../models/interfaces';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  lastUserFetch: number | null; // Timestamp of last user fetch for caching
  loginStart: () => void;
  loginSuccess: (user: User) => void;
  loginFailure: (error: string) => void;
  logout: () => void;
  fetchUser: (oxyServices: any, forceRefresh?: boolean) => Promise<void>;
  updateUser: (updates: Partial<User>, oxyServices: any) => Promise<void>;
  setUser: (user: User) => void; // Direct user setter for caching
}

export const useAuthStore = create<AuthState>((set: (state: Partial<AuthState>) => void, get: () => AuthState) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  lastUserFetch: null,
  loginStart: () => set({ isLoading: true, error: null }),
  loginSuccess: (user: User) => set({ isLoading: false, isAuthenticated: true, user, lastUserFetch: Date.now() }),
  loginFailure: (error: string) => set({ isLoading: false, error }),
  logout: () => set({ user: null, isAuthenticated: false, lastUserFetch: null }),
  setUser: (user: User) => set({ user, lastUserFetch: Date.now() }),
  fetchUser: async (oxyServices, forceRefresh = false) => {
    const state = get();
    const now = Date.now();
    const cacheAge = state.lastUserFetch ? now - state.lastUserFetch : Number.POSITIVE_INFINITY;
    const cacheValid = cacheAge < 5 * 60 * 1000; // 5 minutes cache

    // Use cached data if available and not forcing refresh
    if (!forceRefresh && state.user && cacheValid) {
      console.log('AuthStore: Using cached user data (age:', cacheAge, 'ms)');
      return;
    }

    set({ isLoading: true, error: null });
    try {
      console.log('AuthStore: Fetching user data...');
      const user = await oxyServices.getCurrentUser();
      console.log('AuthStore: Received user data:', {
        hasUser: !!user,
        userLinksMetadata: user?.linksMetadata,
        userLinks: user?.links,
        userWebsite: user?.website
      });
      set({ user, isLoading: false, isAuthenticated: true, lastUserFetch: now });
    } catch (error: any) {
      console.error('AuthStore: Error fetching user:', error);
      set({ error: error.message || 'Failed to fetch user', isLoading: false });
    }
  },
  updateUser: async (updates, oxyServices) => {
    set({ isLoading: true, error: null });
    try {
      console.log('AuthStore: Updating user with:', updates);
      await oxyServices.updateProfile(updates);
      console.log('AuthStore: Profile updated successfully');
      // Immediately fetch the latest user data after update
      await useAuthStore.getState().fetchUser(oxyServices, true); // Force refresh
      console.log('AuthStore: User data refreshed');
    } catch (error: any) {
      console.error('AuthStore: Error updating user:', error);
      set({ error: error.message || 'Failed to update user', isLoading: false });
    }
  },
})); 