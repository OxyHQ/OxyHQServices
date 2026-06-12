export interface OxyConfig {
  baseURL: string;
  cloudURL?: string;
  /**
   * Base URL the SDK's first-party session/refresh calls target.
   *
   * Per the 2026 session architecture (docs/SESSION-ARCHITECTURE.md), every app
   * keeps its OWN first-party session on its OWN domain. For non-`oxy.so` apps
   * this is the app's own same-site backend (e.g. `https://api.mention.earth`),
   * whose session bridge forwards the user's refresh credential to
   * `api.oxy.so`. For `*.oxy.so` apps this is omitted and falls back to
   * `baseURL` (`https://api.oxy.so`), so their behavior is unchanged.
   *
   * Resolve via {@link OxyServices.getSessionBaseUrl}; when unset it returns
   * `baseURL`. This is purely additive — no refresh/auth logic reads it yet.
   */
  sessionBaseUrl?: string;
  authWebUrl?: string;
  authRedirectUri?: string;
  // Performance & caching options
  enableCache?: boolean;
  cacheTTL?: number; // Cache TTL in milliseconds (default: 5 minutes)
  enableRequestDeduplication?: boolean;
  enableRetry?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  requestTimeout?: number; // Default timeout in milliseconds (default: 5000)
  // Rate limiting
  maxConcurrentRequests?: number;
  requestQueueSize?: number;
  // Logging
  enableLogging?: boolean;
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  // Performance monitoring
  onRequestStart?: (url: string, method: string) => void;
  onRequestEnd?: (url: string, method: string, duration: number, success: boolean) => void;
  onRequestError?: (url: string, method: string, error: Error) => void;
}

/**
 * Privacy settings for a user account.
 *
 * All fields are optional because:
 *  - Updates are dot-path partial PATCHes — clients send only changed keys.
 *  - The server may return a partial subdocument depending on the API
 *    build (older builds returned only the field that changed).
 *  - User accounts created before a new toggle was introduced won't
 *    have that key persisted yet.
 *
 * Mirrors `IPrivacySettings` from `packages/api/src/types/privacy.types.ts`,
 * but with every field marked optional.
 */
export interface PrivacySettings {
  isPrivateAccount?: boolean;
  hideOnlineStatus?: boolean;
  hideLastSeen?: boolean;
  profileVisibility?: boolean;
  loginAlerts?: boolean;
  blockScreenshots?: boolean;
  login?: boolean;
  biometricLogin?: boolean;
  showActivity?: boolean;
  allowTagging?: boolean;
  allowMentions?: boolean;
  hideReadReceipts?: boolean;
  allowDirectMessages?: boolean;
  dataSharing?: boolean;
  locationSharing?: boolean;
  analyticsSharing?: boolean;
  sensitiveContent?: boolean;
  autoFilter?: boolean;
  muteKeywords?: boolean;
}

export interface User {
  id: string;
  publicKey: string;
  username: string;
  email?: string;
  // Avatar file id (asset id)
  avatar?: string;
  // Named color preset (e.g. 'teal', 'blue', 'purple')
  color?: string;
  // Privacy and security settings
  privacySettings?: PrivacySettings;
  name?: {
    first?: string;
    last?: string;
    full?: string; // virtual, not stored in DB, returned by API
    [key: string]: unknown;
  };
  bio?: string;
  karma?: number;
  location?: string;
  website?: string;
  createdAt?: string;
  updatedAt?: string;
  links?: Array<{
    title?: string;
    description?: string;
    image?: string;
    link: string;
  }>;
  // Social counts
  _count?: {
    followers?: number;
    following?: number;
  };
  accountExpiresAfterInactivityDays?: number | null; // Days of inactivity before account expires (null = never expire)
  // User type and external account support
  type?: 'local' | 'federated' | 'agent' | 'automated';
  isFederated?: boolean;
  isAgent?: boolean;
  isAutomated?: boolean;
  instance?: string;
  federation?: {
    actorUri?: string;
    domain?: string;
    actorId?: string;
  };
  automation?: {
    ownerId?: string;
  };
  // Managed account fields
  isManagedAccount?: boolean;
  managedBy?: string;
  // User-controlled notification preferences. All channels default to on; users
  // opt out per-channel. Updated via `PUT /users/me`.
  notificationPreferences?: NotificationPreferences;
  // General app-wide user preferences. Updated via `PUT /users/me`.
  userPreferences?: UserPreferences;
  [key: string]: unknown;
}

/**
 * User-controlled notification channels. Persisted on the User document.
 */
export interface NotificationPreferences {
  /** Push notifications on registered devices. */
  pushEnabled?: boolean;
  /** Periodic email digest of activity. */
  emailDigest?: boolean;
  /** Security/account alerts (sign-ins, recovery, key changes). */
  securityAlerts?: boolean;
  /** Marketing / product update emails. */
  marketingEmails?: boolean;
}

/**
 * General per-user preferences applied across all Oxy apps for the user.
 * Persisted on the User document.
 */
export interface UserPreferences {
  /** BCP-47 language tag, e.g. "en-US", "es-ES". Empty string = follow device. */
  language?: string;
  /** Theme mode preference. */
  theme?: 'light' | 'dark' | 'system';
  /** Mirror of OS reduce-motion preference, persisted server-side. */
  reduceMotion?: boolean;
  /** IANA timezone, e.g. "Europe/Madrid". Empty string = follow device. */
  timezone?: string;
}

export interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  token?: string; // For backwards compatibility
  user: User;
  message?: string;
}

export interface Notification {
  id: string;
  message: string;
  // Add other notification fields as needed
}

export interface Wallet {
  id: string;
  balance: number;
  // Add other wallet fields as needed
}

export interface Transaction {
  id: string;
  amount: number;
  type: string;
  timestamp: string;
  // Add other transaction fields as needed
}

export interface BlockedUser {
  _id?: string;
  blockedId: string | {
    _id: string;
    username: string;
    avatar?: string;
  };
  userId: string;
  createdAt?: string;
  blockedAt?: string;
  username?: string;
  avatar?: string;
}

export interface RestrictedUser {
  _id?: string;
  restrictedId: string | {
    _id: string;
    username: string;
    avatar?: string;
  };
  userId: string;
  createdAt?: string;
  restrictedAt?: string;
  username?: string;
  avatar?: string;
}

export interface TransferFundsRequest {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export interface PurchaseRequest {
  userId: string;
  itemId: string;
  amount: number;
}

export interface WithdrawalRequest {
  userId: string;
  amount: number;
  address: string;
}

export interface TransactionResponse {
  success: boolean;
  transaction: Transaction;
}

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SearchProfilesResponse {
  data: User[];
  pagination: PaginationInfo;
}

export interface KarmaRule {
  id: string;
  description: string;
  // Add other karma rule fields as needed
}

export interface KarmaHistory {
  id: string;
  userId: string;
  points: number;
  // Add other karma history fields as needed
}

export interface KarmaLeaderboardEntry {
  userId: string;
  total: number;
}

export interface KarmaAwardRequest {
  userId: string;
  points: number;
  reason?: string;
}

export interface ApiError {
  message: string;
  code: string;
  status: number;
  details?: Record<string, unknown>;
}

export interface PaymentMethod {
  id: string;
  type: string;
  // Add other payment method fields as needed
}

export interface PaymentRequest {
  userId: string;
  planId: string;
  paymentMethodId: string;
}

export interface PaymentResponse {
  transactionId: string;
  status: string;
}

export interface AnalyticsData {
  userId: string;
  // Add other analytics fields as needed
}

export interface FollowerDetails {
  userId: string;
  followers: number;
  // Add other follower details as needed
}

export interface ContentViewer {
  userId: string;
  viewedAt: string;
  // Add other content viewer fields as needed
}

/**
 * File management interfaces
 */
export interface FileMetadata {
  id: string;
  filename: string;
  contentType: string;
  length: number;
  chunkSize: number;
  uploadDate: string;
  metadata?: {
    userId?: string;
    description?: string;
    title?: string;
    tags?: string[];
    [key: string]: unknown;
  };
  variants?: Array<{
    type: string; // e.g. 'thumb', 'poster'
    key: string; // storage key/path
    width?: number;
    height?: number;
    readyAt?: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface FileUploadResponse {
  files: FileMetadata[];
}

export interface FileListResponse {
  files: FileMetadata[];
  total: number;
  hasMore: boolean;
}

export interface FileUpdateRequest {
  filename?: string;
  metadata?: {
    description?: string;
    title?: string;
    tags?: string[];
    [key: string]: unknown;
  };
}

export interface FileDeleteResponse {
  success: boolean;
  message: string;
  fileId: string;
}

/**
 * React Native file descriptor accepted by FormData.
 *
 * On React Native, the multipart upload reads the file from disk via the URI
 * during the network request — no in-JS Blob construction is required (and
 * doing so would fail on Hermes since RN's BlobManager cannot wrap an
 * ArrayBuffer/ArrayBufferView).
 *
 * This shape matches what `expo-document-picker` and `expo-image-picker`
 * return for selected assets, and is what `OxyServices.assetUpload` accepts
 * on native platforms.
 */
export interface RNFileDescriptor {
  uri: string;
  type?: string;
  name?: string;
  size?: number;
}

/**
 * Asset upload input — accepted by `OxyServices.assetUpload` and `uploadRawFile`.
 *
 * - `File` / `Blob`: standard web browser path. `assetUpload` appends the
 *   Blob to FormData directly.
 * - {@link RNFileDescriptor}: React Native path. FormData reads the file from
 *   disk via the URI during the multipart request.
 */
export type AssetUploadInput = File | Blob | RNFileDescriptor;

/**
 * Central Asset Service interfaces
 */

/**
 * File visibility levels
 * - private: Only accessible by owner (default)
 * - public: Accessible by anyone without authentication (e.g., avatars, public profile content)
 * - unlisted: Accessible with direct link but not listed publicly
 */
export type FileVisibility = 'private' | 'public' | 'unlisted';

export interface AssetLink {
  app: string;
  entityType: string;
  entityId: string;
  createdBy: string;
  createdAt: string;
}

export type AssetMetadata = Record<string, string | number | boolean | null | undefined>;

export interface AssetVariant {
  type: string;
  key: string;
  width?: number;
  height?: number;
  readyAt?: string;
  size?: number;
  metadata?: AssetMetadata;
}

export interface Asset {
  id: string;
  sha256: string;
  size: number;
  mime: string;
  ext: string;
  originalName?: string;
  ownerUserId: string;
  status: 'active' | 'trash' | 'deleted';
  visibility: FileVisibility;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  links: AssetLink[];
  variants: AssetVariant[];
  metadata?: AssetMetadata;
}

export interface AssetInitRequest {
  sha256: string;
  size: number;
  mime: string;
}

export interface AssetInitResponse {
  uploadUrl: string;
  fileId: string;
  sha256: string;
}

export interface AssetCompleteRequest {
  fileId: string;
  originalName: string;
  size: number;
  mime: string;
  visibility?: FileVisibility;
  metadata?: AssetMetadata;
}

export interface AssetLinkRequest {
  app: string;
  entityType: string;
  entityId: string;
  visibility?: FileVisibility;
}

export interface AssetUnlinkRequest {
  app: string;
  entityType: string;
  entityId: string;
}

export interface AssetUrlResponse {
  success: boolean;
  url: string;
  variant?: string;
  expiresIn: number;
}

export interface AssetDeleteSummary {
  fileId: string;
  wouldDelete: boolean;
  affectedApps: string[];
  remainingLinks: number;
  variants: string[];
}

export interface AssetUpdateVisibilityRequest {
  visibility: FileVisibility;
}

export interface AssetUpdateVisibilityResponse {
  success: boolean;
  file: {
    id: string;
    visibility: FileVisibility;
    updatedAt: string;
  };
}

/**
 * Account storage usage (server-side usage, not local AsyncStorage)
 */
export interface AccountStorageCategoryUsage {
  bytes: number;
  count: number;
}

export interface AccountStorageUsageResponse {
  plan: 'basic' | 'pro' | 'business';
  totalUsedBytes: number;
  totalLimitBytes: number;
  categories: {
    documents: AccountStorageCategoryUsage;
    mail: AccountStorageCategoryUsage;
    photosVideos: AccountStorageCategoryUsage;
    recordings: AccountStorageCategoryUsage;
    family: AccountStorageCategoryUsage;
    other: AccountStorageCategoryUsage;
  };
  updatedAt: string;
}

/**
 * Security activity event types
 */
export type SecurityEventType = 
  | 'sign_in'
  | 'sign_out'
  | 'email_changed'
  | 'profile_updated'
  | 'device_added'
  | 'device_removed'
  | 'account_recovery'
  | 'security_settings_changed'
  | 'private_key_exported'
  | 'backup_created'
  | 'suspicious_activity';

/**
 * Security event severity levels
 */
export type SecurityEventSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Security event severity mapping (single source of truth)
 * Maps each event type to its default severity level
 */
export const SECURITY_EVENT_SEVERITY_MAP: Record<SecurityEventType, SecurityEventSeverity> = {
  'sign_in': 'low',
  'sign_out': 'low',
  'profile_updated': 'low',
  'email_changed': 'medium',
  'device_added': 'medium',
  'device_removed': 'medium',
  'security_settings_changed': 'medium',
  'account_recovery': 'high',
  'private_key_exported': 'high',
  'backup_created': 'high',
  'suspicious_activity': 'critical',
};

/**
 * Security activity event
 */
export interface SecurityActivity {
  id: string;
  userId: string;
  eventType: SecurityEventType;
  eventDescription: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  timestamp: string;
  severity: SecurityEventSeverity;
  createdAt: string;
}

/**
 * Security activity response with pagination
 */
export interface SecurityActivityResponse {
  data: SecurityActivity[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AssetUploadProgress {
  fileId: string;
  uploaded: number;
  total: number;
  percentage: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
}

// Device Session interfaces
export interface DeviceSession {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  isActive: boolean;
  lastActive: string;
  expiresAt: string;
  isCurrent: boolean;
  user?: User;
  createdAt?: string;
}

export interface DeviceSessionsResponse {
  deviceId: string;
  sessions: DeviceSession[];
}

export interface DeviceSessionLogoutResponse {
  message: string;
  deviceId: string;
  sessionsTerminated: number;
}

export interface UpdateDeviceNameResponse {
  message: string;
  deviceName: string;
}

// ---------------------------------------------------------------------------
// Multi-account "refresh-all" (Google-style)
// ---------------------------------------------------------------------------
// Wire shape of `POST /auth/refresh-all`. The server rotates every device-local
// `oxy_rt_${authuser}` cookie in parallel and returns one entry per VALID
// account, sorted by `authuser` ascending. Slot-level errors are silently
// omitted; the response is `{ accounts: [] }` in the worst case (no signed-in
// accounts, all cookies expired, or origin not allowlisted).

/**
 * Minimal user shape included in a `RefreshAllAccount` entry. The server
 * projects a small whitelist (`username name avatar email color`) so the
 * client can render the account chooser without an extra `/users/me` round
 * trip per account.
 *
 * `avatar` and `color` are `string | null` because they are stored as nullable
 * fields in the user document.
 */
export interface RefreshAllAccountUser {
  id: string;
  username: string;
  name?: string;
  avatar?: string | null;
  email?: string;
  color?: string | null;
}

/**
 * One rotated account entry returned by `POST /auth/refresh-all`. `authuser` is
 * the device-local slot index (0..N-1) the cookie was bound to. The legacy
 * un-suffixed `oxy_rt` cookie yields `authuser: null` server-side, but the SDK
 * normalises that to `0` before exposing it (the chooser always operates on
 * numeric indices).
 *
 * `user` is `null` only on the SDK-side synthesised legacy fallback (when the
 * server is too old to support `/auth/refresh-all` and we wrap a
 * `/auth/refresh` response — that endpoint does not project a user shape).
 * On the modern path every accepted entry carries a non-null user.
 */
export interface RefreshAllAccount {
  authuser: number;
  accessToken: string;
  expiresAt: string;
  sessionId: string;
  user: RefreshAllAccountUser | null;
}

/**
 * Wire shape of `POST /auth/refresh-all`. Always 200 with a (possibly empty)
 * accounts array — 401 means "no accounts signed in on this device" and is
 * normalised to `{ accounts: [] }` at the SDK layer.
 */
export interface RefreshAllResponse {
  accounts: RefreshAllAccount[];
}

/**
 * Wire shape of `POST /auth/refresh` (single-account refresh, optionally
 * targeting a specific `?authuser=N` slot). The server includes `authuser` in
 * the response when an indexed slot was rotated; the legacy slot yields
 * `authuser: null`.
 */
export interface RefreshCookieResponse {
  accessToken: string;
  expiresAt: string;
  authuser: number | null;
}
