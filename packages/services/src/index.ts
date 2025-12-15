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
export type { 
  KeyPair, 
  SignedMessage, 
  AuthChallenge, 
  RecoveryPhraseResult 
} from './crypto';

// React context
export { 
  OxyContextProvider, // Backward compatibility
  useOxy 
} from './ui/context/OxyContext';

// Streamlined provider with built-in bottom sheet
export { default as OxyProvider } from './ui/components/OxyProvider';

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

// UI components
export { OxySignInButton } from './ui/components/OxySignInButton';
export { OxyLogo, FollowButton } from './ui';

// New consolidated utilities
export * from './utils/apiUtils';
export { 
  ErrorCodes, 
  createApiError, 
  handleHttpError, 
  validateRequiredFields,
  retryWithBackoff 
} from './utils/errorUtils';
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