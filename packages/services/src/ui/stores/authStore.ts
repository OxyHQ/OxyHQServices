import { create } from 'zustand';
import type { User } from '../../models/interfaces';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  loginStart: () => void;
  loginSuccess: (user: User) => void;
  loginFailure: (error: string) => void;
  logout: () => void;
  fetchUser: (oxyServices: any) => Promise<void>;
  updateUser: (updates: Partial<User>, oxyServices: any) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set: (state: Partial<AuthState>) => void) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  loginStart: () => set({ isLoading: true, error: null }),
  loginSuccess: (user: User) => set({ isLoading: false, isAuthenticated: true, user }),
  loginFailure: (error: string) => set({ isLoading: false, error }),
  logout: () => set({ user: null, isAuthenticated: false }),
  fetchUser: async (oxyServices) => {
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
      set({ user, isLoading: false, isAuthenticated: true });
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
      await useAuthStore.getState().fetchUser(oxyServices);
      console.log('AuthStore: User data refreshed');
    } catch (error: any) {
      console.error('AuthStore: Error updating user:', error);
      set({ error: error.message || 'Failed to update user', isLoading: false });
    }
  },
})); 