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
    [key: string]: any;
  };
  name?: {
    first?: string;
    last?: string;
    full?: string;
    [key: string]: any;
  };
  bio?: string;
  karma?: number;
  location?: string;
  website?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
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
  details?: any;
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
    [key: string]: any;
  };
}

export interface FileUploadResponse {
  success: boolean;
  file: FileMetadata;
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
    [key: string]: any;
  };
}

export interface FileDeleteResponse {
  success: boolean;
  message: string;
  fileId: string;
}