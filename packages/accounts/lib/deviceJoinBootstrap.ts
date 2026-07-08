import { captureDeviceJoinFragmentFromUrl } from '@oxyhq/core';

/**
 * Runs before Expo Router imports so join credentials are stripped from the URL
 * before the router reads `window.location` (see `public/device-join-strip.js`
 * for the even-earlier HTML-head pass).
 */
captureDeviceJoinFragmentFromUrl();
