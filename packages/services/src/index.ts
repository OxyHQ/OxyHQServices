/**
 * @oxyhq/services — OxyHQ Expo/React Native SDK
 *
 * Full UI components, screens, and native features for Expo apps.
 * Depends on @oxyhq/core for foundation services. Does NOT re-export from
 * @oxyhq/core — consumers import core types/values directly from `@oxyhq/core`.
 *
 * Every export below is NOMINAL — no `export *`, no compat shims.
 *
 * @example
 * ```tsx
 * import { OxyProvider, useAuth, OxySignInButton } from '@oxyhq/services';
 *
 * function App() {
 *   return (
 *     <OxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </OxyProvider>
 *   );
 * }
 * ```
 */

/// <reference path="./types/react-native-classname.d.ts" />
/// <reference path="./types/react-native-web-style.d.ts" />

import { setPlatformOS, type PlatformOS } from '@oxyhq/core';
import { Platform } from 'react-native';
setPlatformOS(Platform.OS as PlatformOS);

// ---------------------------------------------------------------------------
// Provider + auth context
// ---------------------------------------------------------------------------
export { default as OxyProvider } from './ui/components/OxyProvider';
export { useOxy } from './ui/context/OxyContext';
export type { OxyContextState, PasswordSignInResult } from './ui/context/OxyContext';
export { useAuth } from './ui/hooks/useAuth';
export type { AuthState, AuthActions, UseAuthReturn } from './ui/hooks/useAuth';

// ---------------------------------------------------------------------------
// Font loading
// ---------------------------------------------------------------------------
export { FontLoader, setupFonts } from './ui/components/FontLoader';

// ---------------------------------------------------------------------------
// Zustand stores
// ---------------------------------------------------------------------------
export { useAuthStore } from './ui/stores/authStore';
export { useAccountStore } from './ui/stores/accountStore';
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
} from './ui/stores/assetStore';

// ---------------------------------------------------------------------------
// Session / asset hooks
// ---------------------------------------------------------------------------
export { useAssets, setOxyAssetInstance } from './ui/hooks/useAssets';
export { useFileDownloadUrl } from './ui/hooks/useFileDownloadUrl';
export { useFollow, useFollowerCounts } from './ui/hooks/useFollow';
export { useStorage } from './ui/hooks/useStorage';
export type { UseStorageOptions, UseStorageResult } from './ui/hooks/useStorage';

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
    useConnectedApps,
} from './ui/hooks/queries/useAccountQueries';
export {
    useSessions,
    useSession,
    useDeviceSessions,
    useUserDevices,
    useSecurityInfo,
    useAccountStorageUsage,
} from './ui/hooks/queries/useServicesQueries';
export {
    useSecurityActivity,
    useRecentSecurityActivity,
    useInfiniteSecurityActivity,
} from './ui/hooks/queries/useSecurityQueries';
export {
    useUserSubscription,
    useUserPayments,
    useUserWallet,
    useUserWalletTransactions,
} from './ui/hooks/queries/usePaymentQueries';

// Payment / wallet / subscription domain types
export type {
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
    SubscriptionFeatures,
    Payment,
    Wallet,
    WalletTransaction,
    WalletTransactionType,
    WalletTransactionStatus,
    WalletPagination,
    WalletTransactionsResponse,
} from './ui/hooks/queries/paymentTypes';

// ---------------------------------------------------------------------------
// Mutation hooks (TanStack Query — updates)
// ---------------------------------------------------------------------------
export {
    useUpdateProfile,
    useUploadAvatar,
    useUpdateAccountSettings,
    useUpdatePrivacySettings,
    useUpdateNotificationPreferences,
    useUpdateUserPreferences,
    useRevokeConnectedApp,
    useUploadFile,
} from './ui/hooks/mutations/useAccountMutations';
export {
    useSwitchSession,
    useLogoutSession,
    useLogoutAll,
    useUpdateDeviceName,
    useRemoveDevice,
} from './ui/hooks/mutations/useServicesMutations';
export {
    createProfileMutation,
    createGenericMutation,
} from './ui/hooks/mutations/mutationFactory';
export type {
    ProfileMutationConfig,
    GenericMutationConfig,
} from './ui/hooks/mutations/mutationFactory';

// Stable mutation keys for the offline queue
export { mutationKeys } from './ui/hooks/mutations/mutationKeys';

// ---------------------------------------------------------------------------
// Query keys + cache invalidation helpers
// ---------------------------------------------------------------------------
// Consumers (Mention, Homiio, Alia, accounts) use these to invalidate cached
// data after writes that touch shared backend state. Keep nominal — no
// `export *` — and never drop a public symbol without a major version bump.
export {
    queryKeys,
    invalidateAccountQueries,
    invalidateUserQueries,
    invalidateSessionQueries,
    invalidateDeviceQueries,
    invalidatePrivacyQueries,
    invalidateSecurityQueries,
    invalidateStorageQueries,
    invalidatePaymentsQueries,
    invalidateConnectedAppsQueries,
} from './ui/hooks/queries/queryKeys';

// Mutation status aggregator (for "Syncing..." indicators)
export { useMutationStatus } from './ui/hooks/useMutationStatus';
export type { MutationStatus } from './ui/hooks/useMutationStatus';
export { useOnlineStatus } from './ui/hooks/useOnlineStatus';

// ---------------------------------------------------------------------------
// Error handlers
// ---------------------------------------------------------------------------
export {
    handleAuthError,
    isInvalidSessionError,
    isTimeoutOrNetworkError,
    extractErrorMessage,
} from './ui/utils/errorHandlers';
export type { HandleAuthErrorOptions } from './ui/utils/errorHandlers';

// ---------------------------------------------------------------------------
// File filtering
// ---------------------------------------------------------------------------
export { useFileFiltering } from './ui/hooks/useFileFiltering';
export type { ViewMode, SortBy, SortOrder } from './ui/hooks/useFileFiltering';

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------
export {
  OXY_OAUTH_STATE_STORAGE_KEY,
  OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY,
} from '@oxyhq/core';
export { default as OxySignInButton } from './ui/components/OxySignInButton';
export type { OxySignInButtonProps, OxyOAuthResult } from './ui/components/OxySignInButton';
export { OxyAuthPrompt } from './ui/components/OxyAuthPrompt';
export type { OxyAuthPromptProps } from './ui/components/OxyAuthPrompt';
export { OxyConsentScreen } from './ui/components/OxyConsentScreen';
export type {
  OxyConsentScreenProps,
  OxyConsentApplication,
  OxyConsentUser,
} from './ui/components/OxyConsentScreen';

// Optional signed-out gate primitive. Wrap any subtree (or the whole app via
// `OxyProvider`'s `requireAuth` prop) to opt into a shared, readiness-safe wall.
// `prompt`: `off` (render always) | `soft` (dismissible banner) | `hard` (block).
// Gates on `useOxy().canUsePrivateApi` / `isPrivateApiPending` — never flashes the
// wall before the device-first cold boot resolves. Opens the ONE account dialog.
export { RequireOxyAuth } from './ui/components/RequireOxyAuth';
export type { RequireOxyAuthProps, RequireOxyAuthPrompt } from './ui/components/RequireOxyAuth';

export { default as FollowButton } from './ui/components/FollowButton';
export type { FollowButtonProps, SingleFollowButtonProps, MultiFollowButtonProps } from './ui/components/FollowButton';
export { default as OxyPayButton } from './ui/components/OxyPayButton';
export { LogoIcon } from './ui/components/logo/LogoIcon';
export { LogoText } from './ui/components/logo/LogoText';

// Sidebar account trigger. Pressing `ProfileButton` opens the unified
// `OxyAccountDialog` (the single account switcher + sign-in surface) via
// `useOxy().openAccountDialog`.
export { default as ProfileButton } from './ui/components/ProfileButton';
export type { ProfileButtonProps } from './ui/components/ProfileButton';

// Unified switchable-accounts hook — the single source of everything the user
// can switch into: device sign-ins AND linked graph accounts (owned orgs +
// shared-with-you), deduped by account id and hydrated with real
// name/email/avatar/color. Backed by the shared `AccountDialogController` in
// `@oxyhq/core`. Every switch routes through `useOxy().switchToAccount`.
// The `SwitchableAccount` type lives in `@oxyhq/core` — import it from there.
export { useSwitchableAccounts } from './ui/hooks/useSwitchableAccounts';
export type { UseSwitchableAccountsResult } from './ui/hooks/useSwitchableAccounts';

// Unified "Manage your Oxy Account" screen (the caller's own personal account)
export { default as ProfileScreen } from './ui/screens/ProfileScreen';
export { default as ManageAccountScreen } from './ui/screens/ManageAccountScreen';
export { default as NotificationsScreen } from './ui/screens/NotificationsScreen';
export { default as PreferencesScreen } from './ui/screens/PreferencesScreen';
export { default as ConnectedAppsScreen } from './ui/screens/ConnectedAppsScreen';

// Account-graph screens (organization / project / bot accounts)
export { default as CreateAccountScreen } from './ui/screens/CreateAccountScreen';
export { default as AccountMembersScreen } from './ui/screens/AccountMembersScreen';
export { default as AccountSettingsScreen } from './ui/screens/AccountSettingsScreen';

// ---------------------------------------------------------------------------
// Bottom-sheet navigation
// ---------------------------------------------------------------------------
export { showBottomSheet, closeBottomSheet } from './ui/navigation/bottomSheetManager';
export type { RouteName } from './ui/navigation/routes';

// ---------------------------------------------------------------------------
// Unified account dialog — imperative entry points
// ---------------------------------------------------------------------------
// `showSignInModal` / `hideSignInModal` open / close the unified account dialog
// on its sign-in view. Prefer `useOxy().openAccountDialog(view?)` inside React.
export { showSignInModal, hideSignInModal } from './ui/navigation/accountDialogManager';
