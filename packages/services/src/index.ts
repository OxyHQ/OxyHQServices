/**
 * OxyHQServices Main Export File
 */

// ------------- Polyfills -------------
import './utils/polyfills';

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
  OxyIcon
} from './ui';

// ------------- Type Imports -------------
import { OxyContextState, OxyContextProviderProps } from './ui/context/OxyContext';
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
  OxyIcon
};

// ------------- Type Exports -------------
export { OxyContextState, OxyContextProviderProps };
export * from './ui/navigation/types';