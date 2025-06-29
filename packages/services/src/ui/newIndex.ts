/**
 * New UI exports with Zustand-based architecture
 * This provides a cleaner, more performant alternative to the Redux-based system
 */

// Core store and context exports
export {
  // Main store
  useOxyStore,
  initializeOxyStore,
  
  // Convenience hooks
  useAuth,
  useFollow as useFollowStore,
  useAuthUser,
  useIsAuthenticated,
  useAuthLoading,
  useAuthError,
  useAuthSessions,
  useUserFollowStatus,
  useMultipleFollowStatuses,
  
  // Types
  type OxyStore,
  type AuthState,
  type FollowState
} from '../../stores';

// New context provider
export {
  OxyContextProvider,
  useOxyContext,
  useOxy
} from '../context/NewOxyContext';

// New simplified hooks
export {
  useFollowUser,
  useFollowMultipleUsers,
  useFollow,
  useOxyFollow
} from '../hooks/newUseFollow';

// API utilities
export {
  ApiUtils,
  createApiUtils
} from '../../utils/api';