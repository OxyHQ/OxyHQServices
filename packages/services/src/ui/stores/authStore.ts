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
})); 