export interface OxyConfig {
  baseURL: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: {
    id?: string;
    url?: string;
    [key: string]: unknown;
  };
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
  // Social counts - can be returned by API in different formats
  _count?: {
    followers?: number;
    following?: number;
  };
  stats?: {
    followers?: number;
    following?: number;
  };
  [key: string]: unknown;
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
 * Central Asset Service interfaces
 */
export interface AssetLink {
  app: string;
  entityType: string;
  entityId: string;
  createdBy: string;
  createdAt: string;
}

export interface AssetVariant {
  type: string;
  key: string;
  width?: number;
  height?: number;
  readyAt?: string;
  size?: number;
  metadata?: Record<string, any>;
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
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  links: AssetLink[];
  variants: AssetVariant[];
  metadata?: Record<string, any>;
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
  metadata?: Record<string, any>;
}

export interface AssetLinkRequest {
  app: string;
  entityType: string;
  entityId: string;
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