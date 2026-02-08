/**
 * @oxyhq/services — OxyHQ Expo/React Native SDK
 *
 * Full UI components, screens, and native features for Expo apps.
 * Depends on @oxyhq/core for foundation services.
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

// Platform initialization (React Native)
import { setPlatformOS, type PlatformOS } from '@oxyhq/core';
import { Platform } from 'react-native';
setPlatformOS(Platform.OS as PlatformOS);

// --- Services-specific (React Native / Expo) ---

// React context and auth hooks
export { useOxy } from './ui/context/OxyContext';
export { useAuth } from './ui/hooks/useAuth';
export type { AuthState, AuthActions, UseAuthReturn } from './ui/hooks/useAuth';

// Provider
export { default as OxyProvider } from './ui/components/OxyProvider';

// Font loading
export { FontLoader } from './ui/components/FontLoader';

// UI hooks - Stores
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

// UI hooks
export { useSessionSocket } from './ui/hooks/useSessionSocket';
export { useAssets, setOxyAssetInstance } from './ui/hooks/useAssets';
export { useFileDownloadUrl, setOxyFileUrlInstance } from './ui/hooks/useFileDownloadUrl';
export { useFollow, useFollowerCounts } from './ui/hooks/useFollow';

// Query hooks
export {
  useUserProfile, useUserProfiles, useCurrentUser,
  useUserById, useUserByUsername, useUsersBySessions,
  usePrivacySettings, useSessions, useSession,
  useDeviceSessions, useUserDevices, useSecurityInfo,
  useSecurityActivity, useRecentSecurityActivity,
} from './ui/hooks/queries';

// Mutation hooks
export {
  useUpdateProfile, useUploadAvatar, useUpdateAccountSettings,
  useUpdatePrivacySettings, useUploadFile, useSwitchSession,
  useLogoutSession, useLogoutAll, useUpdateDeviceName, useRemoveDevice,
} from './ui/hooks/mutations';

export {
  createProfileMutation, createGenericMutation,
} from './ui/hooks/mutations/mutationFactory';
export type {
  ProfileMutationConfig, GenericMutationConfig,
} from './ui/hooks/mutations/mutationFactory';

// Error handlers
export {
  handleAuthError, isInvalidSessionError,
  isTimeoutOrNetworkError, extractErrorMessage,
} from './ui/utils/errorHandlers';
export type { HandleAuthErrorOptions } from './ui/utils/errorHandlers';

// File filtering
export { useFileFiltering } from './ui/hooks/useFileFiltering';
export type { ViewMode, SortBy, SortOrder } from './ui/hooks/useFileFiltering';

// UI components
export { OxySignInButton } from './ui/components/OxySignInButton';
export { OxyLogo, FollowButton } from './ui';

// Bottom sheet navigation
export { showBottomSheet, closeBottomSheet } from './ui/navigation/bottomSheetManager';
export type { RouteName } from './ui/navigation/routes';

// Sign-in modal
export { showSignInModal, hideSignInModal } from './ui/components/SignInModal';

// Toast notifications
export { toast } from './lib/sonner';
