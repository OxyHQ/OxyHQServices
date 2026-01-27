/**
 * OxyHQServices Main Export File - Universal (Frontend + Backend)
 * 
 * This exports everything but uses environment detection to avoid crashes.
 * - Frontend: Full UI + Core functionality
 * - Backend: Core functionality only (UI components are no-ops)
 */

// IMPORTANT: Import crypto module first to ensure polyfills are loaded
// before any other code that might use Buffer or other polyfilled APIs
import './crypto/polyfill';

// Crypto/Identity exports (must be before core to ensure polyfills are available)
export { 
  KeyManager, 
  SignatureService, 
  RecoveryPhraseService 
} from './crypto';

// Core exports
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './core';
export { OXY_CLOUD_URL, oxyClient } from './core';

// Cross-domain authentication (Web SSO via FedCM/popup/redirect)
export { CrossDomainAuth, createCrossDomainAuth } from './core';
export type { CrossDomainAuthOptions } from './core';
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

// Streamlined provider with built-in bottom sheet
export { default as OxyProvider } from './ui/components/OxyProvider';

// Font loading utility
export { FontLoader } from './ui/components/FontLoader';

// Web-only provider (no React Native dependencies)
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
  // Blocked users
  BlockedUser,
  // Restricted users
  RestrictedUser,
  // Central Asset Service types
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
  // Account storage usage
  AccountStorageCategoryUsage,
  AccountStorageUsageResponse,
  // Security activity
  SecurityEventType,
  SecurityEventSeverity,
  SecurityActivity,
  SecurityActivityResponse
} from './models/interfaces';

// Export security constants
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
  // Account queries
  useUserProfile,
  useUserProfiles,
  useCurrentUser,
  useUserById,
  useUserByUsername,
  useUsersBySessions,
  usePrivacySettings,
  // Service queries
  useSessions,
  useSession,
  useDeviceSessions,
  useUserDevices,
  useSecurityInfo,
  // Security activity queries
  useSecurityActivity,
  useRecentSecurityActivity,
} from './ui/hooks/queries';

// UI hooks - Mutation hooks (TanStack Query)
export {
  // Account mutations
  useUpdateProfile,
  useUploadAvatar,
  useUpdateAccountSettings,
  useUpdatePrivacySettings,
  useUploadFile,
  // Service mutations
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

// Error handlers
export { handleAuthError, isInvalidSessionError, isTimeoutOrNetworkError, extractErrorMessage } from './ui/utils/errorHandlers';
export type { HandleAuthErrorOptions } from './ui/utils/errorHandlers';

// File filtering hook
export { useFileFiltering } from './ui/hooks/useFileFiltering';
export type { ViewMode, SortBy, SortOrder } from './ui/hooks/useFileFiltering';

// UI components
export { OxySignInButton } from './ui/components/OxySignInButton';
export { OxyLogo, FollowButton } from './ui';

// Shared utilities (platform-agnostic)
export {
  // Color utilities
  darkenColor,
  lightenColor,
  hexToRgb,
  rgbToHex,
  withOpacity,
  isLightColor,
  getContrastTextColor,
} from './shared/utils/colorUtils';

export {
  // Theme utilities
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from './shared/utils/themeUtils';
export type { ThemeValue } from './shared/utils/themeUtils';

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
} from './shared/utils/errorUtils';

export {
  // Network utilities
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

// Other utilities
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
  LogContext,
  logAuth,
  logApi,
  logSession,
  logUser,
  logDevice,
  logPayment,
  logPerformance
} from './utils/loggerUtils';
export * from './utils/asyncUtils';
export * from './utils/hookUtils';

// Bottom sheet navigation
export { showBottomSheet, closeBottomSheet } from './ui/navigation/bottomSheetManager';
export type { RouteName } from './ui/navigation/routes';