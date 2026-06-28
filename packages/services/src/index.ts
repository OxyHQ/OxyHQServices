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
export { FontLoader } from './ui/components/FontLoader';

// ---------------------------------------------------------------------------
// Zustand stores
// ---------------------------------------------------------------------------
export { useAuthStore } from './ui/stores/authStore';
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
export { useSessionSocket } from './ui/hooks/useSessionSocket';
export { useAssets, setOxyAssetInstance } from './ui/hooks/useAssets';
export { useFileDownloadUrl } from './ui/hooks/useFileDownloadUrl';
export { useFollow, useFollowerCounts } from './ui/hooks/useFollow';

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
    useAuthorizedApps,
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
    useRevokeAuthorizedApp,
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
export { default as Avatar } from './ui/components/Avatar';
export type { AvatarProps } from './ui/components/Avatar';
export { OxySignInButton } from './ui/components/OxySignInButton';
export { OxyAuthPrompt } from './ui/components/OxyAuthPrompt';
export type { OxyAuthPromptProps } from './ui/components/OxyAuthPrompt';
export { default as OxyLogo } from './ui/components/OxyLogo';
export { default as FollowButton } from './ui/components/FollowButton';
export type { FollowButtonProps, SingleFollowButtonProps, MultiFollowButtonProps } from './ui/components/FollowButton';
export { LogoIcon } from './ui/components/logo/LogoIcon';
export { LogoText } from './ui/components/logo/LogoText';

// Acting-as banner for managed accounts
export { default as ActingAsBanner } from './ui/components/ActingAsBanner';

// Unified account menu (popover on web, bottom-sheet style modal on native)
export { default as AccountMenu } from './ui/components/AccountMenu';
export type { AccountMenuProps, AccountMenuAnchor } from './ui/components/AccountMenu';
export { default as AccountMenuButton } from './ui/components/AccountMenuButton';
export type { AccountMenuButtonProps } from './ui/components/AccountMenuButton';

// Unified device-account hook (hydrates every signed-in account on the device
// with real name/email/avatar/color for the account switcher).
export { useDeviceAccounts } from './ui/hooks/useDeviceAccounts';
export type {
    DeviceAccount,
    DeviceAccountUser,
    UseDeviceAccountsResult,
} from './ui/hooks/useDeviceAccounts';

// Unified "Manage your Oxy Account" screen
export { default as ManageAccountScreen } from './ui/screens/ManageAccountScreen';
export { default as NotificationsScreen } from './ui/screens/NotificationsScreen';
export { default as PreferencesScreen } from './ui/screens/PreferencesScreen';
export { default as ConnectedAppsScreen } from './ui/screens/ConnectedAppsScreen';

// ---------------------------------------------------------------------------
// Bottom-sheet navigation
// ---------------------------------------------------------------------------
export { showBottomSheet, closeBottomSheet } from './ui/navigation/bottomSheetManager';
export type { RouteName } from './ui/navigation/routes';

// ---------------------------------------------------------------------------
// Sign-in modal
// ---------------------------------------------------------------------------
export { showSignInModal, hideSignInModal } from './ui/components/SignInModal';
