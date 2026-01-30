/**
 * OxyServices Shared Module
 *
 * Platform-agnostic utilities and helpers that work everywhere:
 * - Browser (Web, Expo Web)
 * - React Native (iOS, Android)
 * - Node.js (Backend)
 *
 * This module contains NO React Native or browser-specific dependencies.
 *
 * @module shared
 *
 * @example
 * ```ts
 * import { darkenColor, normalizeTheme, withRetry } from '@oxyhq/services/shared';
 *
 * const darkBlue = darkenColor('#0066FF', 0.3);
 * const theme = normalizeTheme(userPreference);
 * const data = await withRetry(() => fetchData(), { maxRetries: 3 });
 * ```
 */

// Color utilities
export {
  darkenColor,
  lightenColor,
  hexToRgb,
  rgbToHex,
  withOpacity,
  isLightColor,
  getContrastTextColor,
} from './utils/colorUtils';

// Theme utilities
export {
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from './utils/themeUtils';
export type { ThemeValue } from './utils/themeUtils';

// Error utilities
export {
  HttpStatus,
  getErrorStatus,
  getErrorMessage,
  isAlreadyRegisteredError,
  isUnauthorizedError,
  isForbiddenError,
  isNotFoundError,
  isRateLimitError,
  isServerError,
  isNetworkError,
  isRetryableError,
} from './utils/errorUtils';

// Network utilities
export {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  createCircuitBreakerState,
  calculateBackoffInterval,
  recordFailure,
  recordSuccess,
  shouldAllowRequest,
  delay,
  withRetry,
} from './utils/networkUtils';
export type {
  CircuitBreakerState,
  CircuitBreakerConfig,
} from './utils/networkUtils';

// Debug utilities
export {
  isDev,
  debugLog,
  debugWarn,
  debugError,
  createDebugLogger,
} from './utils/debugUtils';
