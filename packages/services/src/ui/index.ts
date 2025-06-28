/**
 * UI Component exports
 */

// Export the main provider component and context
export { default as OxyProvider } from './components/OxyProvider';
export { default as OxySignInButton } from './components/OxySignInButton';
export { default as OxyLogo } from './components/OxyLogo';
export { default as Avatar } from './components/Avatar';
export { default as FollowButton } from './components/FollowButton';
export { FontLoader, setupFonts } from './components/FontLoader';

// Export icon components
export { OxyIcon } from './components/icon';
export type { IconProps } from './components/icon';

export {
  OxyContextProvider,
  useOxy,
  OxyContextState,
  OxyContextProviderProps
} from './context/OxyContext';

// Redux store exports - NEW ARCHITECTURE
export { 
  setupOxyStore, 
  oxyReducers,
  // Individual slices
  authSlice,
  authActions,
  authSelectors,
  authReducer,
  followSlice,
  followActions,
  followSelectors,
  followThunks,
  followReducer,
  // Action creators
  loginStart,
  loginSuccess,
  loginFailure,
  logout,
  setFollowingStatus,
  clearFollowError,
  resetFollowState,
  fetchFollowStatus,
  toggleFollowUser,
  // Types
  AuthState,
  FollowState,
  initialAuthState,
  initialFollowState
} from './store';

// Legacy store exports (deprecated)
export { store } from './store';
export type { RootState, AppDispatch } from './store';

// Export styles
export { fontFamilies, fontStyles } from './styles/fonts';

// Export types for navigation (internal use)
export * from './navigation/types';

// Hooks
export { useOxyFollow, useFollow } from './hooks';

// Screens
export { default as ProfileScreen } from './screens/ProfileScreen';

// Navigation
export { default as OxyRouter } from './navigation/OxyRouter';
