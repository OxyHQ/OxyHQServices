/**
 * OxyHQServices Main Export File
 */

// ------------- Core Imports -------------
import OxyCore from './core';
import { OxyServices } from './core';

// ------------- Utility Imports -------------
import { DeviceManager } from './utils/deviceManager';

// ------------- UI Imports -------------
import { 
  // Context and Hooks
  OxyProvider, 
  OxyContextProvider, 
  useOxy,
  
  // Components
  OxySignInButton,
  OxyLogo,
  Avatar,
  FollowButton,
  FontLoader,
  OxyIcon,
  useFollow,
  ProfileScreen,
  OxyRouter,
} from './ui';

// ------------- Type Imports -------------
import * as Models from './models/interfaces';

// ------------- Core Exports -------------
export default OxyCore; // Default export for backward compatibility
export { OxyServices };
export * from './core';

// ------------- Utility Exports -------------
export { DeviceManager } from './utils';
export type { DeviceFingerprint, StoredDeviceInfo } from './utils';

// ------------- Model Exports -------------
export { Models };  // Export all models as a namespace
export * from './models/interfaces';  // Export all models directly

// ------------- UI Exports -------------
export { 
  // Context and Hooks
  OxyProvider, 
  OxyContextProvider, 
  useOxy,
  
  // Components
  OxySignInButton,
  OxyLogo,
  Avatar,
  FollowButton,
  FontLoader,
  OxyIcon,
  useOxyFollow,
  useFollow,
  ProfileScreen,
  OxyRouter,
} from './ui';

// ------------- Zustand Store Exports -------------
// Zustand-based state management
export { 
  useOxyStore,
  initializeOxyStore,
  useAuth,
  useAuthUser,
  useIsAuthenticated,
  useAuthLoading,
  useAuthError,
  useAuthSessions,
  useUserFollowStatus,
  useMultipleFollowStatuses
} from './stores';

export {
  ApiUtils,
  createApiUtils
} from './utils/api';

// Export types
export type { 
  OxyStore,
  AuthState,
  FollowState
} from './stores';

// ------------- Type Exports -------------
export * from './ui/navigation/types';
export * from './models/secureSession';

// Sonner toast integration
export { toast } from './lib/sonner';