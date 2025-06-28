import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { User } from '../../../models/interfaces';
import type { AuthState } from './types';
import { initialAuthState } from './types';

export const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    loginStart(state: AuthState) {
      state.isLoading = true;
      state.error = null;
    },
    loginSuccess(state: AuthState, action: PayloadAction<User>) {
      state.isLoading = false;
      state.isAuthenticated = true;
      state.user = action.payload;
    },
    loginFailure(state: AuthState, action: PayloadAction<string>) {
      state.isLoading = false;
      state.error = action.payload;
    },
    logout(state: AuthState) {
      state.user = null;
      state.isAuthenticated = false;
    },
  },
});

// Export actions
export const authActions = authSlice.actions;
export const { loginStart, loginSuccess, loginFailure, logout } = authSlice.actions;

// Export selectors
export const authSelectors = {
  selectUser: (state: { auth: AuthState }) => state.auth.user,
  selectIsAuthenticated: (state: { auth: AuthState }) => state.auth.isAuthenticated,
  selectIsLoading: (state: { auth: AuthState }) => state.auth.isLoading,
  selectError: (state: { auth: AuthState }) => state.auth.error,
};

// Export reducer
export const authReducer = authSlice.reducer;