/**
 * @oxyhq/core — OxyHQ SDK Foundation
 *
 * Platform-agnostic core providing API client, authentication,
 * cryptographic identity, and shared utilities.
 *
 * Works in Node.js, Browser, and React Native.
 *
 * @example
 * ```ts
 * import { OxyServices, oxyClient } from '@oxyhq/core';
 *
 * const user = await oxyClient.signIn(publicKey);
 * ```
 */

// Ensure crypto polyfills are loaded before anything else
import './crypto/polyfill';

// --- Core API Client ---
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './OxyServices';
export { OXY_CLOUD_URL, oxyClient } from './OxyServices';

// --- Authentication ---
export { AuthManager, createAuthManager } from './AuthManager';
export type { StorageAdapter, AuthStateChangeCallback, AuthMethod, AuthManagerConfig } from './AuthManager';

export { CrossDomainAuth, createCrossDomainAuth } from './CrossDomainAuth';
export type { CrossDomainAuthOptions } from './CrossDomainAuth';
export type { FedCMAuthOptions, FedCMConfig } from './mixins/OxyServices.fedcm';
export type { PopupAuthOptions } from './mixins/OxyServices.popup';
export type { RedirectAuthOptions } from './mixins/OxyServices.redirect';
export type { ServiceTokenResponse } from './mixins/OxyServices.auth';
export type { ServiceApp } from './mixins/OxyServices.utility';

// --- Crypto / Identity ---
export { KeyManager, SignatureService, RecoveryPhraseService } from './crypto';
export type { KeyPair, SignedMessage, AuthChallenge, RecoveryPhraseResult } from './crypto';

// --- Models & Types ---
export * from './models/interfaces';
export * from './models/session';

// --- Device Management ---
export { DeviceManager } from './utils/deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from './utils/deviceManager';

// --- Language Utilities ---
export {
  SUPPORTED_LANGUAGES,
  getLanguageMetadata,
  getLanguageName,
  getNativeLanguageName,
  normalizeLanguageCode,
} from './utils/languageUtils';
export type { LanguageMetadata } from './utils/languageUtils';

// --- Platform Detection ---
export {
  getPlatformOS,
  setPlatformOS,
  isWeb,
  isNative,
  isIOS,
  isAndroid,
} from './utils/platform';
export type { PlatformOS } from './utils/platform';

// --- Shared Utilities ---
export {
  darkenColor,
  lightenColor,
  hexToRgb,
  rgbToHex,
  withOpacity,
  isLightColor,
  getContrastTextColor,
} from './shared/utils/colorUtils';

export {
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from './shared/utils/themeUtils';
export type { ThemeValue } from './shared/utils/themeUtils';

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
} from './shared/utils/errorUtils';

export {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  createCircuitBreakerState,
  calculateBackoffInterval,
  recordFailure,
  recordSuccess,
  shouldAllowRequest,
  delay,
  withRetry,
} from './shared/utils/networkUtils';
export type { CircuitBreakerState, CircuitBreakerConfig } from './shared/utils/networkUtils';

export {
  isDev,
  debugLog,
  debugWarn,
  debugError,
  createDebugLogger,
} from './shared/utils/debugUtils';

// --- i18n ---
export { translate } from './i18n';

// --- Session Utilities ---
export { mergeSessions, normalizeAndSortSessions, sessionsArraysEqual } from './utils/sessionUtils';

// --- Constants ---
export { packageInfo } from './constants/version';

// --- API & Error Utilities ---
export * from './utils/apiUtils';
export {
  ErrorCodes,
  createApiError,
  handleHttpError,
  validateRequiredFields,
} from './utils/errorUtils';
export { retryAsync } from './utils/asyncUtils';
export * from './utils/validationUtils';
export {
  logger,
  LogLevel,
  logAuth,
  logApi,
  logSession,
  logUser,
  logDevice,
  logPayment,
  logPerformance,
} from './utils/loggerUtils';
export type { LogContext } from './utils/loggerUtils';

// Default export
import { OxyServices } from './OxyServices';
export default OxyServices;
