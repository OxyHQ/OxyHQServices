/**
 * UI Component exports - Frontend Only (with backend-safe fallbacks)
 * 
 * This module exports all React/React Native UI components and hooks.
 * In backend, all exports are no-ops or empty objects.
 */
import isFrontend from './isFrontend';

// UI exports
let OxyProvider, OxySignInButton, OxyLogo, Avatar, FollowButton, OxyPayButton, FontLoader, setupFonts, OxyIcon, useOxy, useFollow, ProfileScreen, useAuthStore, useAccountStore, fontFamilies, fontStyles, toast, useStorage;

if (isFrontend) {
  OxyProvider = require('./components/OxyProvider').default;
  OxySignInButton = require('./components/OxySignInButton').default;
  OxyLogo = require('./components/OxyLogo').default;
  Avatar = require('./components/Avatar').default;
  FollowButton = require('./components/FollowButton').default;
  OxyPayButton = require('./components/OxyPayButton').default;
  FontLoader = require('./components/FontLoader').FontLoader;
  setupFonts = require('./components/FontLoader').setupFonts;
  OxyIcon = require('./components/icon').OxyIcon;
  useOxy = require('./context/OxyContext').useOxy;
  useFollow = require('./hooks').useFollow;
  ProfileScreen = require('./screens/ProfileScreen').default;
  useAuthStore = require('./stores/authStore').useAuthStore;
  useAccountStore = require('./stores/accountStore').useAccountStore;
  fontFamilies = require('./styles/fonts').fontFamilies;
  fontStyles = require('./styles/fonts').fontStyles;
  toast = require('../lib/sonner').toast;
  useStorage = require('./hooks/useStorage').useStorage;
} else {
  // Backend: no-op fallbacks
  const noopComponent = () => null;
  const noopHook = () => ({});
  const noopStorageResult = { storage: null, isReady: false };

  OxyProvider = noopComponent;
  OxySignInButton = noopComponent;
  OxyLogo = noopComponent;
  Avatar = noopComponent;
  FollowButton = noopComponent;
  OxyPayButton = noopComponent;
  FontLoader = noopComponent;
  setupFonts = () => {};
  OxyIcon = noopComponent;
  useOxy = noopHook;
  useFollow = noopHook;
  ProfileScreen = noopComponent;
  useAuthStore = noopHook;
  useAccountStore = noopHook;
  fontFamilies = {};
  fontStyles = {};
  toast = () => {};
  useStorage = () => noopStorageResult;
}

export {
  OxyProvider,
  OxySignInButton,
  OxyLogo,
  Avatar,
  FollowButton,
  OxyPayButton,
  FontLoader,
  setupFonts,
  OxyIcon,
  useOxy,
  useFollow,
  ProfileScreen,
  useAuthStore,
  useAccountStore,
  fontFamilies,
  fontStyles,
  toast,
  useStorage,
};

// Re-export core services for convenience in UI context
export { OxyServices } from '../core';
export type { User, LoginResponse, ApiError } from '../models/interfaces';

// Export error handler utilities (pure functions, no conditional needed)
export {
  handleAuthError,
  isInvalidSessionError,
  isTimeoutOrNetworkError,
  extractErrorMessage,
} from './utils/errorHandlers';
export type { HandleAuthErrorOptions } from './utils/errorHandlers';

// Export useStorage hook and types (kept for external consumers)
export type { UseStorageOptions, UseStorageResult } from './hooks/useStorage';
