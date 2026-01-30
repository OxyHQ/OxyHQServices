/**
 * @oxyhq/auth — OxyHQ Web Authentication SDK
 *
 * Headless authentication for React web apps (Next.js, Vite, CRA).
 * Zero React Native / Expo dependencies.
 *
 * @example
 * ```tsx
 * import { WebOxyProvider, useAuth } from '@oxyhq/auth';
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
 *   // ...
 * }
 * ```
 */

// --- Provider & Hooks ---
export { WebOxyProvider, useWebOxy, useAuth } from './WebOxyProvider';
export type {
  WebOxyProviderProps,
  WebAuthState,
  WebAuthActions,
  WebOxyContextValue,
} from './WebOxyProvider';

// --- Stores ---
export { useAuthStore } from './stores/authStore';
export {
  useAssetStore,
  useAssets as useAssetsStore,
  useAsset,
  useUploadProgress,
  useAssetLoading,
  useAssetErrors,
  useAssetsByApp,
  useAssetsByEntity,
  useAssetUsageCount,
  useIsAssetLinked,
} from './stores/assetStore';

// --- Query Hooks ---
export {
  useUserProfile,
  useUserProfiles,
  useCurrentUser,
  useUserById,
  useUserByUsername,
  useUsersBySessions,
  usePrivacySettings,
  useSessions,
  useSession,
  useDeviceSessions,
  useUserDevices,
  useSecurityInfo,
  useSecurityActivity,
  useRecentSecurityActivity,
} from './hooks/queries';

// --- Mutation Hooks ---
export {
  useUpdateProfile,
  useUploadAvatar,
  useUpdateAccountSettings,
  useUpdatePrivacySettings,
  useUploadFile,
  useSwitchSession,
  useLogoutSession,
  useLogoutAll,
  useUpdateDeviceName,
  useRemoveDevice,
} from './hooks/mutations';

export {
  createProfileMutation,
  createGenericMutation,
} from './hooks/mutations/mutationFactory';
export type {
  ProfileMutationConfig,
  GenericMutationConfig,
} from './hooks/mutations/mutationFactory';

// --- Custom Hooks ---
export { useSessionSocket } from './hooks/useSessionSocket';
export { useAssets, setOxyAssetInstance } from './hooks/useAssets';
export { useFileDownloadUrl, setOxyFileUrlInstance } from './hooks/useFileDownloadUrl';
export { useFollow, useFollowerCounts } from './hooks/useFollow';
export { useFileFiltering } from './hooks/useFileFiltering';
export type { ViewMode, SortBy, SortOrder } from './hooks/useFileFiltering';

// --- Auth Helpers ---
export {
  ensureValidToken,
  withAuthErrorHandling,
  authenticatedApiCall,
  isAuthenticationError,
  SessionSyncRequiredError,
  AuthenticationFailedError,
} from './utils/authHelpers';
export type { HandleApiErrorOptions } from './utils/authHelpers';

// --- Error Handlers ---
export {
  handleAuthError,
  isInvalidSessionError,
  isTimeoutOrNetworkError,
  extractErrorMessage,
} from './utils/errorHandlers';
export type { HandleAuthErrorOptions } from './utils/errorHandlers';

// Re-export core for convenience
export {
  OxyServices,
  CrossDomainAuth,
  AuthManager,
  createAuthManager,
  createCrossDomainAuth,
} from '@oxyhq/core';

export type {
  User,
  LoginResponse,
  ApiError,
  SessionLoginResponse,
  ClientSession,
  MinimalUserData,
  OxyConfig,
  StorageAdapter,
  AuthStateChangeCallback,
  AuthMethod,
  AuthManagerConfig,
  CrossDomainAuthOptions,
} from '@oxyhq/core';

import { WebOxyProvider as _WebOxyProvider } from './WebOxyProvider';
export default _WebOxyProvider;
