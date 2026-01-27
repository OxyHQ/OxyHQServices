/**
 * OxyHQServices Web Entry Point - Pure React/Next.js Apps
 *
 * This entry point is optimized for pure web applications without Expo or React Native.
 * It excludes all React Native dependencies for a smaller bundle size.
 *
 * Use this for:
 * - Pure React apps (Vite, Create React App)
 * - Next.js apps
 * - Any web-only application
 *
 * For Expo apps (native + web), use the main entry point instead:
 * import { OxyProvider } from '@oxyhq/services';
 */

// IMPORTANT: Import crypto module first to ensure polyfills are loaded
import './crypto/polyfill';

// Core exports (no React Native dependencies)
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './core';
export { OXY_CLOUD_URL, oxyClient } from './core';

// Cross-domain authentication (Web SSO via FedCM/popup/redirect)
export { CrossDomainAuth, createCrossDomainAuth } from './core';
export type { CrossDomainAuthOptions } from './core';

// Crypto/Identity exports
export {
  KeyManager,
  SignatureService,
  RecoveryPhraseService
} from './crypto';
export type {
  KeyPair,
  SignedMessage,
  AuthChallenge,
  RecoveryPhraseResult
} from './crypto';

// React context and auth hooks
export { useOxy } from './ui/context/OxyContext';
export { useAuth } from './ui/hooks/useAuth';
export type { AuthState, AuthActions, UseAuthReturn } from './ui/hooks/useAuth';

// Web-only provider (NO React Native dependencies)
export { default as WebOxyProvider } from './ui/components/WebOxyProvider';

// Device management
export { DeviceManager } from './utils/deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from './utils/deviceManager';

// Language utilities
export {
  SUPPORTED_LANGUAGES,
  getLanguageMetadata,
  getLanguageName,
  getNativeLanguageName,
  normalizeLanguageCode
} from './utils/languageUtils';
export type { LanguageMetadata } from './utils/languageUtils';

// Type exports
export type {
  OxyConfig,
  User,
  LoginResponse,
  Notification,
  Wallet,
  Transaction,
  TransferFundsRequest,
  PurchaseRequest,
  WithdrawalRequest,
  TransactionResponse,
  KarmaRule,
  KarmaHistory,
  KarmaLeaderboardEntry,
  KarmaAwardRequest,
  ApiError,
  PaymentMethod,
  PaymentRequest,
  PaymentResponse,
  AnalyticsData,
  FollowerDetails,
  ContentViewer,
  FileMetadata,
  FileUploadResponse,
  FileListResponse,
  FileUpdateRequest,
  FileDeleteResponse,
  DeviceSession,
  DeviceSessionsResponse,
  DeviceSessionLogoutResponse,
  UpdateDeviceNameResponse,
  BlockedUser,
  RestrictedUser,
  FileVisibility,
  AssetLink,
  AssetVariant,
  Asset,
  AssetInitRequest,
  AssetInitResponse,
  AssetCompleteRequest,
  AssetLinkRequest,
  AssetUnlinkRequest,
  AssetUrlResponse,
  AssetDeleteSummary,
  AssetUploadProgress,
  AssetUpdateVisibilityRequest,
  AssetUpdateVisibilityResponse,
  AccountStorageCategoryUsage,
  AccountStorageUsageResponse,
  SecurityEventType,
  SecurityEventSeverity,
  SecurityActivity,
  SecurityActivityResponse
} from './models/interfaces';

export { SECURITY_EVENT_SEVERITY_MAP } from './models/interfaces';

export type {
  SessionLoginResponse,
  ClientSession,
  MinimalUserData
} from './models/session';

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
  useIsAssetLinked
} from './ui/stores/assetStore';

// UI hooks - Custom hooks
export { useSessionSocket } from './ui/hooks/useSessionSocket';
export { useAssets, setOxyAssetInstance } from './ui/hooks/useAssets';
export { useFileDownloadUrl, setOxyFileUrlInstance } from './ui/hooks/useFileDownloadUrl';

// UI hooks - Query hooks (TanStack Query)
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
} from './ui/hooks/queries';

// UI hooks - Mutation hooks (TanStack Query)
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
} from './ui/hooks/mutations';

// Mutation factory utilities
export {
  createProfileMutation,
  createGenericMutation,
} from './ui/hooks/mutations/mutationFactory';
export type {
  ProfileMutationConfig,
  GenericMutationConfig,
} from './ui/hooks/mutations/mutationFactory';

// Authentication helpers
export {
  ensureValidToken,
  withAuthErrorHandling,
  authenticatedApiCall,
  isAuthenticationError,
  SessionSyncRequiredError,
  AuthenticationFailedError,
} from './ui/utils/authHelpers';
export type { HandleApiErrorOptions } from './ui/utils/authHelpers';

// File filtering hook
export { useFileFiltering } from './ui/hooks/useFileFiltering';
export type { ViewMode, SortBy, SortOrder } from './ui/hooks/useFileFiltering';

// Note: UI components like OxySignInButton and OxyLogo use React Native
// and are not included in the /web entry point. For pure web apps, use the
// useAuth hook and create your own sign-in button.

// Utilities
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
  logPerformance
} from './utils/loggerUtils';
export type { LogContext } from './utils/loggerUtils';
export * from './utils/asyncUtils';
export * from './utils/hookUtils';
