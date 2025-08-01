/**
 * UI Component exports - Frontend Only (with backend-safe fallbacks)
 * 
 * This module exports all React/React Native UI components and hooks.
 * In backend, all exports are no-ops or empty objects.
 */
import isFrontend from './isFrontend';

// Real UI exports
let OxyProvider, OxySignInButton, OxyLogo, Avatar, FollowButton, OxyPayButton, FontLoader, setupFonts, OxyIcon, useOxy, useSafeOxy, useOxyAuth, useOxyUser, useOxyKarma, useOxyPayments, useOxyDevices, useOxyNotifications, useOxySocket, useOxyQR, useOxyIAP, OxyContextProvider, OxyContextState, OxyContextProviderProps, useFollow, useSearch, ProfileScreen, OxyRouter, useAuthStore, fontFamilies, fontStyles, toast;

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
  useSafeOxy = require('./context/OxyContext').useSafeOxy;
  OxyContextProvider = require('./context/OxyContext').OxyContextProvider;
  OxyContextState = require('./context/OxyContext').OxyContextState;
  OxyContextProviderProps = require('./context/OxyContext').OxyContextProviderProps;
  useFollow = require('./hooks').useFollow;
  useSearch = require('./hooks').useSearch;
  ProfileScreen = require('./screens/ProfileScreen').default;
  OxyRouter = require('./navigation/OxyRouter').default;
  useAuthStore = require('./stores/authStore').useAuthStore;
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
  useSafeOxy = noopHook;
  OxyContextProvider = noopComponent;
  OxyContextState = {};
  OxyContextProviderProps = {};
  useFollow = noopHook;
  useSearch = noopHook;
  ProfileScreen = noopComponent;
  OxyRouter = noopComponent;
  useAuthStore = noopHook;
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
  useSafeOxy,
  OxyContextProvider,
  OxyContextState,
  OxyContextProviderProps,
  useFollow,
  useSearch,
  ProfileScreen,
  OxyRouter,
  useAuthStore,
  fontFamilies,
  fontStyles,
  toast
};

// Re-export core services for convenience in UI context
export { OxyServices } from '../core';
export type { User, LoginResponse, ApiError } from '../models/interfaces';
