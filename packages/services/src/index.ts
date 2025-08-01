/**
 * OxyHQServices Main Export File - Universal (Frontend + Backend)
 * 
 * This exports everything but uses environment detection to avoid crashes.
 * - Frontend: Full UI + Core functionality
 * - Backend: Core functionality only (UI components are no-ops)
 */

// Core exports
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './core';
export { OXY_CLOUD_URL, oxyClient } from './core';

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
  UpdateDeviceNameResponse
} from './models/interfaces';

export type {
  SessionLoginResponse,
  ClientSession,
  MinimalUserData
} from './models/session';

// UI components and hooks
export { useAuthStore } from './ui/stores/authStore';
export { useSessionSocket } from './ui/hooks/useSessionSocket';

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