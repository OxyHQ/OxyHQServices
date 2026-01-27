/**
 * @oxyhq/services/web - Web-Only Module
 *
 * Clean, professional web module with ZERO React Native dependencies.
 * Perfect for Next.js, Vite, Create React App, and other pure React web apps.
 *
 * Features:
 * - WebOxyProvider for React context
 * - useAuth hook for authentication
 * - Cross-domain SSO via FedCM
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
 *   const { user, isAuthenticated, signIn, signOut } = useAuth();
 *   // ... your app logic
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
} from '../core';

export type {
  CrossDomainAuthOptions,
  DeviceFingerprint,
  StoredDeviceInfo,
} from '../core';

// ==================== Web Components ====================
export { WebOxyProvider, useWebOxy, useAuth } from './WebOxyContext';
export type { WebOxyProviderProps, WebAuthState, WebAuthActions, WebOxyContextValue } from './WebOxyContext';

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
} from '../models/interfaces';

// Re-export session types
export type { ClientSession } from '../models/session';

// ==================== Utilities ====================
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
