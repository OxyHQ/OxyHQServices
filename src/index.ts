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
  
  // Components
  OxySignInButton,
  OxyLogo,
  Avatar,
  FontLoader
} from './ui';

// ------------- Type Imports -------------
import { OxyContextState, OxyContextProviderProps } from './ui/context/OxyContext';

// ------------- Core Exports -------------
export default OxyCore; // Default export for backward compatibility
export { OxyServices };
export * from './core';

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
  
  // Components
  OxySignInButton,
  OxyLogo,
  Avatar,
  FontLoader
};

// ------------- Type Exports -------------
export { OxyContextState, OxyContextProviderProps };
export * from './ui/navigation/types';