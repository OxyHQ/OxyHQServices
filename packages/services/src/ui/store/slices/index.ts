/**
 * Redux slices exports
 * This file exports individual slices and their components for tree-shaking
 */

export { 
  authSlice, 
  authActions, 
  authSelectors, 
  authReducer,
  loginStart,
  loginSuccess, 
  loginFailure,
  logout 
} from './authSlice';  

export { 
  followSlice, 
  followActions, 
  followSelectors, 
  followThunks,
  followReducer,
  setFollowingStatus,
  clearFollowError,
  resetFollowState,
  fetchFollowStatus,
  toggleFollowUser
} from './followSlice';

export type { AuthState, FollowState } from './types';
export { initialAuthState, initialFollowState } from './types';