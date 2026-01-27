/**
 * @oxyhq/services/web - Web-Only Module
 *
 * Clean, professional web module with ZERO React Native dependencies.
 * Perfect for Next.js, Vite, Create React App, and other pure React web apps.
 *
 * Features:
 * - WebOxyProvider for React context
 * - useAuth hook for authentication
 * - Cross-domain SSO via FedCM, popup, or redirect
 * - Full TypeScript support
 * - Zero bundler configuration needed
 *
 * Usage:
 * ```tsx
 * import { WebOxyProvider, useAuth } from '@oxyhq/services/web';
 *
 * function App() {
 *   return (
 *     <WebOxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </WebOxyProvider>
 *   );
 * }
 *
 * function YourApp() {
 *   const { user, isAuthenticated, signIn, signOut, isFedCMSupported } = useAuth();
 *
 *   return (
 *     <button onClick={signIn}>
 *       {isFedCMSupported() ? 'Sign in with Oxy' : 'Sign in'}
 *     </button>
 *   );
 * }
 * ```
 */

// ==================== Core API ====================
// Re-export core services (zero React Native deps)
export {
  OxyServices,
  OxyAuthenticationError,
  OxyAuthenticationTimeoutError,
  OXY_CLOUD_URL,
  oxyClient,
  CrossDomainAuth,
  createCrossDomainAuth,
  DeviceManager,
  // Centralized auth management
  AuthManager,
  createAuthManager,
} from '../core';

export type {
  CrossDomainAuthOptions,
  DeviceFingerprint,
  StoredDeviceInfo,
  // Auth manager types
  StorageAdapter,
  AuthStateChangeCallback,
  AuthMethod,
  AuthManagerConfig,
} from '../core';

// ==================== Web Components ====================
export {
  WebOxyProvider,
  useWebOxy,
  useAuth,
} from './WebOxyContext';

export type {
  WebOxyProviderProps,
  WebAuthState,
  WebAuthActions,
  WebOxyContextValue,
} from './WebOxyContext';

// ==================== Shared Utilities ====================
// Re-export shared utilities that work everywhere
export {
  // Color utilities
  darkenColor,
  lightenColor,
  hexToRgb,
  rgbToHex,
  withOpacity,
  isLightColor,
  getContrastTextColor,
} from '../shared/utils/colorUtils.js';

export {
  // Theme utilities
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from '../shared/utils/themeUtils.js';
export type { ThemeValue } from '../shared/utils/themeUtils.js';

export {
  // Error utilities
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
} from '../shared/utils/errorUtils.js';

export {
  // Network utilities
  delay,
  withRetry,
} from '../shared/utils/networkUtils.js';

// ==================== Models & Types ====================
// Re-export commonly used types
export type {
  User,
  ApiError,
  Notification,
  FileMetadata,
  AssetUploadProgress,
  PaymentMethod,
  KarmaLeaderboardEntry,
  KarmaRule,
  Transaction,
  DeviceSession,
  LoginResponse,
} from '../models/interfaces';

export type { SessionLoginResponse } from '../models/session';

// Re-export session types
export type { ClientSession, MinimalUserData } from '../models/session';

// ==================== Language Utilities ====================
export {
  SUPPORTED_LANGUAGES,
  getLanguageMetadata,
  getLanguageName,
  getNativeLanguageName,
  normalizeLanguageCode,
} from '../utils/languageUtils';

export type { LanguageMetadata } from '../utils/languageUtils';

// Default export for convenience
import { WebOxyProvider } from './WebOxyContext';
export default WebOxyProvider;
