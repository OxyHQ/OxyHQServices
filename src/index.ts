import OxyCore from './core';
import { OxyServices } from './core';

// Export UI components and types
import { 
  OxyProvider, 
  OxyContextProvider, 
  useOxy, 
  SignInScreen, 
  SignUpScreen, 
  AccountCenterScreen,
  OxySignInButton,
  OxyLogo,
  FontLoader
} from './ui';

// Export OxyContext types directly
import { OxyContextState, OxyContextProviderProps } from './ui/context/OxyContext';

// Create a default export for backward compatibility
export default OxyCore;

// Export OxyServices class directly from core
export { OxyServices };

// Export other items from core
export * from './core';

// Export UI components
export { 
  OxyProvider, 
  OxyContextProvider, 
  useOxy, 
  SignInScreen, 
  SignUpScreen,
  AccountCenterScreen,
  OxySignInButton,
  OxyLogo,
  FontLoader
};

// Export types explicitly
export { OxyContextState, OxyContextProviderProps }

// Export navigation types
export * from './ui/navigation/types';