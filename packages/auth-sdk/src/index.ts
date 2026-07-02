/**
 * @oxyhq/auth — OxyHQ Web Authentication SDK
 *
 * Headless authentication for React web apps (Next.js, Vite, CRA).
 * Zero React Native / Expo dependencies. Does NOT re-export from @oxyhq/core —
 * consumers import core types/values directly from `@oxyhq/core`.
 *
 * Every export below is NOMINAL — no `export *`, no compat shims.
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
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Provider + auth hooks
// ---------------------------------------------------------------------------
export { WebOxyProvider, useWebOxy, useWebOxyOptional, useAuth } from './WebOxyProvider';
export type {
    WebOxyProviderProps,
    WebAuthState,
    WebAuthActions,
    WebOxyContextValue,
} from './WebOxyProvider';

// ---------------------------------------------------------------------------
// "Sign in with Oxy" — cross-device QR handoff (Workstream C)
// ---------------------------------------------------------------------------
export { useCommonsSignIn } from './hooks/useCommonsSignIn';
export type {
    UseCommonsSignInOptions,
    UseCommonsSignInResult,
    CommonsSignInPhase,
    CommonsClaimResult,
} from './hooks/useCommonsSignIn';
export { renderQrDataUrl } from './utils/qrCode';

// ---------------------------------------------------------------------------
// Zustand stores
// ---------------------------------------------------------------------------
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
export {
    useAccountStore,
    useAccounts,
    useAccountLoading,
    useAccountError,
    useAccountLoadingSession,
} from './stores/accountStore';
export type { QuickAccount } from './stores/accountStore';
export { useFollowStore } from './stores/followStore';

// ---------------------------------------------------------------------------
// Query hooks (TanStack Query — fetching)
// ---------------------------------------------------------------------------
export {
    useUserProfile,
    useUserProfiles,
    useCurrentUser,
    useUserById,
    useUserByUsername,
    useUsersBySessions,
    usePrivacySettings,
} from './hooks/queries/useAccountQueries';
export {
    useSessions,
    useSession,
    useDeviceSessions,
    useUserDevices,
    useSecurityInfo,
} from './hooks/queries/useServicesQueries';
export {
    useSecurityActivity,
    useRecentSecurityActivity,
} from './hooks/queries/useSecurityQueries';
export {
    queryKeys,
    invalidateAccountQueries,
    invalidateUserQueries,
    invalidateSessionQueries,
} from './hooks/queries/queryKeys';

// App-data KV store query hooks
export { useAppData, useAppDataNamespace } from './hooks/queries/useAppData';
export {
    appDataQueryKeys,
    isMissingAppDataEndpointError,
} from './hooks/queries/appDataQueryKeys';

// ---------------------------------------------------------------------------
// Mutation hooks (TanStack Query — updates)
// ---------------------------------------------------------------------------
export {
    useUpdateProfile,
    useUploadAvatar,
    useUpdateAccountSettings,
    useUpdatePrivacySettings,
    useUploadFile,
} from './hooks/mutations/useAccountMutations';
export {
    useSwitchSession,
    useLogoutSession,
    useLogoutAll,
    useUpdateDeviceName,
    useRemoveDevice,
} from './hooks/mutations/useServicesMutations';

// App-data KV store mutations
export { useSetAppData, useDeleteAppData } from './hooks/mutations/useAppData';

export {
    createProfileMutation,
    createGenericMutation,
} from './hooks/mutations/mutationFactory';
export type {
    ProfileMutationConfig,
    GenericMutationConfig,
} from './hooks/mutations/mutationFactory';

// ---------------------------------------------------------------------------
// Custom hooks
// ---------------------------------------------------------------------------
export { useWebSSO, isWebBrowser } from './hooks/useWebSSO';
export { useAssets, setOxyAssetInstance } from './hooks/useAssets';
export { useFileDownloadUrl } from './hooks/useFileDownloadUrl';
export { useFollow, useFollowerCounts } from './hooks/useFollow';
export { useFileFiltering } from './hooks/useFileFiltering';
export type { ViewMode, SortBy, SortOrder } from './hooks/useFileFiltering';

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
export {
    handleAuthError,
    isInvalidSessionError,
    isTimeoutOrNetworkError,
    extractErrorMessage,
} from './utils/errorHandlers';
export type { HandleAuthErrorOptions } from './utils/errorHandlers';

// ---------------------------------------------------------------------------
// Default export (the provider is the most common entry)
// ---------------------------------------------------------------------------
import { WebOxyProvider as _WebOxyProvider } from './WebOxyProvider';
export default _WebOxyProvider;
