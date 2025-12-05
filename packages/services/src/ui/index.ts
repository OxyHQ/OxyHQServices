/**
 * UI Component exports - Frontend Only (with backend-safe fallbacks)
 * 
 * This module exports all React/React Native UI components and hooks.
 * In backend, all exports are no-ops or empty objects.
 */
import isFrontend from './isFrontend';

// Real UI exports
let OxyProvider, OxySignInButton, OxyLogo, Avatar, FollowButton, OxyPayButton, FontLoader, setupFonts, OxyIcon, useOxy, useOxyAuth, useOxyUser, useOxyKarma, useOxyPayments, useOxyDevices, useOxyNotifications, useOxySocket, useOxyQR, OxyContextProvider, OxyContextState, OxyContextProviderProps, useFollow, ProfileScreen, useAuthStore, useAccountStore, fontFamilies, fontStyles, toast;

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
  OxyContextProvider = require('./context/OxyContext').OxyContextProvider;
  OxyContextState = require('./context/OxyContext').OxyContextState;
  OxyContextProviderProps = require('./context/OxyContext').OxyContextProviderProps;
  useFollow = require('./hooks').useFollow;
  ProfileScreen = require('./screens/ProfileScreen').default;
  useAuthStore = require('./stores/authStore').useAuthStore;
  useAccountStore = require('./stores/accountStore').useAccountStore;
  fontFamilies = require('./styles/fonts').fontFamilies;
  fontStyles = require('./styles/fonts').fontStyles;
  toast = require('../lib/sonner').toast;
} else {
  // Backend: no-op fallbacks
  const noopComponent = () => null;
  const noopHook = () => ({});
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
  OxyContextProvider = noopComponent;
  OxyContextState = {};
  OxyContextProviderProps = {};
  useFollow = noopHook;
  ProfileScreen = noopComponent;
  useAuthStore = noopHook;
  useAccountStore = noopHook;
  fontFamilies = {};
  fontStyles = {};
  toast = () => {};
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
  OxyContextProvider,
  OxyContextState,
  OxyContextProviderProps,
  useFollow,
  ProfileScreen,
  useAuthStore,
  useAccountStore,
  fontFamilies,
  fontStyles,
  toast
};

// Re-export core services for convenience in UI context
export { OxyServices } from '../core';
export type { User, LoginResponse, ApiError } from '../models/interfaces';
