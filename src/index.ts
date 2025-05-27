/**
 * OxyHQServices Main Export File
 */

// ------------- Core Imports -------------
import OxyCore from './core';
import { OxyServices } from './core';

// ------------- UI Imports -------------
import { 
  // Context and Hooks
  OxyProvider, 
  OxyContextProvider, 
  useOxy, 
  
  // Screens
  SignInScreen, 
  SignUpScreen, 
  AccountCenterScreen,
  SessionManagementScreen,
  
  // Components
  OxySignInButton,
  OxyLogo,
  Avatar,
  FollowButton,
  FontLoader
} from './ui';

// ------------- Type Imports -------------
import { OxyContextState, OxyContextProviderProps } from './ui/context/OxyContext';
import * as Models from './models/interfaces';

// ------------- Core Exports -------------
export default OxyCore; // Default export for backward compatibility
export { OxyServices };
export * from './core';

// ------------- Model Exports -------------
export { Models };  // Export all models as a namespace
export * from './models/interfaces';  // Export all models directly

// ------------- UI Exports -------------
export { 
  // Context and Hooks
  OxyProvider, 
  OxyContextProvider, 
  useOxy, 
  
  // Screens
  SignInScreen, 
  SignUpScreen,
  AccountCenterScreen,
  SessionManagementScreen,
  
  // Components
  OxySignInButton,
  OxyLogo,
  Avatar,
  FollowButton,
  FontLoader
};

// ------------- Type Exports -------------
export { OxyContextState, OxyContextProviderProps };
export * from './ui/navigation/types';