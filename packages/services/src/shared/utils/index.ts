/**
 * Shared Utility Functions
 *
 * Re-exports all shared utilities for convenient importing.
 *
 * @module shared/utils
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
} from './colorUtils';

// Theme utilities
export {
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from './themeUtils';
export type { ThemeValue } from './themeUtils';

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
} from './errorUtils';

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
} from './networkUtils';
export type {
  CircuitBreakerState,
  CircuitBreakerConfig,
} from './networkUtils';
