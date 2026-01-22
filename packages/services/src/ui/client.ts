/**
 * Client-only UI exports (tree-shakeable)
 *
 * Import from this module for client-side bundles where tree-shaking is important.
 * These are direct exports without runtime detection overhead.
 *
 * @example
 * import { OxyProvider, useOxy, Avatar } from '@oxyhq/services/ui/client';
 */

// Components
export { default as OxyProvider } from './components/OxyProvider';
export { default as OxySignInButton } from './components/OxySignInButton';
export { default as OxyLogo } from './components/OxyLogo';
export { default as Avatar } from './components/Avatar';
export { default as FollowButton } from './components/FollowButton';
export { default as OxyPayButton } from './components/OxyPayButton';
export { FontLoader, setupFonts } from './components/FontLoader';
export { OxyIcon } from './components/icon';

// Context
export { useOxy } from './context/OxyContext';

// Hooks
export { useAuth } from './hooks/useAuth';
export type { AuthState, AuthActions, UseAuthReturn } from './hooks/useAuth';
export { useFollow } from './hooks';
export { useStorage } from './hooks/useStorage';
export type { UseStorageOptions, UseStorageResult } from './hooks/useStorage';

// Screens
export { default as ProfileScreen } from './screens/ProfileScreen';

// Stores
export { useAuthStore } from './stores/authStore';
export { useAccountStore } from './stores/accountStore';

// Styles
export { fontFamilies, fontStyles } from './styles/fonts';

// Toast
export { toast } from '../lib/sonner';

// Core re-exports for convenience
export { OxyServices } from '../core';
export type { User, LoginResponse, ApiError } from '../models/interfaces';

// Error handler utilities
export {
    handleAuthError,
    isInvalidSessionError,
    isTimeoutOrNetworkError,
    extractErrorMessage,
} from './utils/errorHandlers';
export type { HandleAuthErrorOptions } from './utils/errorHandlers';
