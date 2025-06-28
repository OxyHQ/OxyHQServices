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

// Redux store exports
export { store } from './store';
export type { RootState, AppDispatch } from './store';

// Export styles
export { fontFamilies, fontStyles } from './styles/fonts';

// Export types for navigation (internal use)
export * from './navigation/types';

// Hooks
export { useFollow } from './hooks';

// Screens
export { default as ProfileScreen } from './screens/ProfileScreen';

// Navigation
export { default as OxyRouter } from './navigation/OxyRouter';
