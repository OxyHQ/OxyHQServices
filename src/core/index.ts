import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';

let NodeFormData: any = null;
if (typeof window === 'undefined') { // Check if in Node.js environment
  try {
    NodeFormData = require('form-data');
  } catch (e) {
    console.warn('form-data module not found, file uploads from Buffer may fail in Node.js');
  }
}

import {
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
  // File management interfaces
  FileMetadata,
  FileUploadResponse,
  FileListResponse,
  FileUpdateRequest,
  FileDeleteResponse
} from '../models/interfaces';

// Import secure session types
import { SecureLoginResponse, SecureClientSession } from '../models/secureSession';

/**
 * Default cloud URL for Oxy services, cloud is where the user files are. (e.g. images, videos, etc.). Not the API.
 */
export const OXY_CLOUD_URL = 'https://cloud.oxy.so';

interface JwtPayload {
  exp: number;
  userId: string;
  [key: string]: any;
}

/**
 * OxyServices - Client library for interacting with the Oxy API
 */
export class OxyServices {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<{ accessToken: string; refreshToken: string }> | null = null;

  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   */
  constructor(config: OxyConfig) {
    this.client = axios.create({ 
      baseURL: config.baseURL,
      timeout: 10000 // 10 second timeout
    });
    
    // Interceptor for adding auth header and handling token refresh
    this.client.interceptors.request.use(async (req: InternalAxiosRequestConfig) => {
      if (!this.accessToken) {
        return req;
      }        // Check if token is expired and refresh if needed
        try {
          const decoded = jwtDecode<JwtPayload>(this.accessToken);
          const currentTime = Math.floor(Date.now() / 1000);
        
        // If token expires in less than 60 seconds, refresh it
        if (decoded.exp - currentTime < 60) {
          await this.refreshTokens();
        }
      } catch (error) {
        // If token can't be decoded, continue with request and let server handle it
        console.warn('Error decoding JWT token', error);
      }
      
      req.headers = req.headers || {};
      req.headers.Authorization = `Bearer ${this.accessToken}`;
      return req;
    });
    
    // Response interceptor for handling errors
    this.client.interceptors.response.use(
      response => response,
      async (error: AxiosError) => {
        const originalRequest = error.config;
        
        // If the error is due to an expired token and we haven't tried refreshing yet
        if (
          error.response?.status === 401 &&
          this.refreshToken &&
          originalRequest && 
          !originalRequest.headers?.['X-Retry-After-Refresh']
        ) {
          try {
            await this.refreshTokens();
            
            // Retry the original request with new token
            const newRequest = { ...originalRequest };
            if (newRequest.headers) {
              newRequest.headers.Authorization = `Bearer ${this.accessToken}`;
              newRequest.headers['X-Retry-After-Refresh'] = 'true';
            }
            return this.client(newRequest);
          } catch (refreshError) {
            // If refresh fails, force user to login again
            this.accessToken = null;
            this.refreshToken = null;
            return Promise.reject(refreshError);
          }
        }
        
        // Format error response
        const apiError: ApiError = {
          message: (error.response?.data as any)?.message || 'An unknown error occurred',
          code: (error.response?.data as any)?.code || 'UNKNOWN_ERROR',
          status: error.response?.status || 500,
          details: error.response?.data
        };
        
        return Promise.reject(apiError);
      }
    );
  }

  /**
   * Gets the currently authenticated user ID from the token
   * @returns The user ID or null if not authenticated
   */
  public getCurrentUserId(): string | null {
    if (!this.accessToken) return null;
    
    try {
      const decoded = jwtDecode<JwtPayload>(this.accessToken);
      return decoded.userId;
    } catch {
      return null;
    }
  }
  
  /**
   * Checks if the user is currently authenticated
   * @returns Boolean indicating authentication status
   */
  public isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Sets authentication tokens directly (useful for initializing from storage)
   * @param accessToken - JWT access token
   * @param refreshToken - Refresh token for getting new access tokens
   */
  public setTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }
  
  /**
   * Clears all authentication tokens
   */
  public clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Sign up a new user
   * @param username - Desired username
   * @param email - User's email address
   * @param password - User's password
   * @returns Object containing the message, token and user data
   */
  async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
    try {
      const res = await this.client.post('/auth/signup', { username, email, password });
      const { message, token, user } = res.data;
      this.accessToken = token;
      return { message, token, user };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Log in and store tokens
   * @param username - User's username or email
   * @param password - User's password
   * @returns Login response containing tokens and user data
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    try {
      const res = await this.client.post('/auth/login', { username, password });
      const { accessToken, refreshToken, user } = res.data;
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      return { accessToken, refreshToken, user };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Log out user
   */
  async logout(): Promise<void> {
    if (!this.refreshToken) return;
    
    try {
      await this.client.post('/auth/logout', { refreshToken: this.refreshToken });
    } catch (error) {
      console.warn('Error during logout', error);
    } finally {
      this.accessToken = null;
      this.refreshToken = null;
    }
  }

  /**
   * Refresh access and refresh tokens
   * @returns New tokens
   */
  async refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }
    
    // If a refresh is already in progress, return that promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    
    // Create a new refresh promise
    this.refreshPromise = (async () => {
      try {
        const res = await this.client.post('/auth/refresh', { refreshToken: this.refreshToken });
        const { accessToken, refreshToken } = res.data;
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        return { accessToken, refreshToken };
      } catch (error) {
        this.accessToken = null;
        this.refreshToken = null;
        throw this.handleError(error);
      } finally {
        this.refreshPromise = null;
      }
    })();
    
    return this.refreshPromise;
  }

  /**
   * Validate current access token
   * @returns Boolean indicating if the token is valid
   */
  async validate(): Promise<boolean> {
    try {
      const res = await this.client.get('/auth/validate');
      return res.data.valid;
    } catch (error) {
      return false;
    }
  }

  /* Session Management Methods */

  /**
   * Get active sessions for the authenticated user
   * @returns Array of active session objects
   */
  async getUserSessions(): Promise<any[]> {
    try {
      const res = await this.client.get('/sessions');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from a specific session
   * @param sessionId - The session ID to logout from
   * @returns Success status
   */
  async logoutSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.delete(`/sessions/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all other sessions (keep current session active)
   * @returns Success status
   */
  async logoutOtherSessions(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post('/sessions/logout-others');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all sessions
   * @returns Success status
   */
  async logoutAllSessions(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post('/sessions/logout-all');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* Profile Methods */

  /**
   * Fetch profile by username
   * @param username - The username to look up
   * @returns User profile data
   */
  async getProfileByUsername(username: string): Promise<User> {
    try {
      const res = await this.client.get(`/profiles/username/${username}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Search profiles
   * @param query - Search query string
   * @param limit - Maximum number of results to return
   * @param offset - Number of results to skip for pagination
   * @returns Array of matching user profiles
   */
  async searchProfiles(query: string, limit?: number, offset?: number): Promise<User[]> {
    try {
      const params: Record<string, any> = { query };
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;
      const res = await this.client.get('/profiles/search', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get recommended profiles for the authenticated user
   * @returns Array of recommended profiles
   */
  async getProfileRecommendations(): Promise<Array<{
    id: string;
    username: string;
    name?: { first?: string; last?: string; full?: string };
    description?: string;
    _count?: { followers: number; following: number };
    [key: string]: any;
  }>> {
    try {
      const res = await this.client.get('/profiles/recommendations');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* User Methods */

  /**
   * Get general user by ID
   * @param userId - The user ID to look up
   * @returns User data
   */
  async getUserById(userId: string): Promise<User> {
    try {
      const res = await this.client.get(`/users/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update user profile (requires auth)
   * @param userId - User ID to update (must match authenticated user or have admin rights)
   * @param updates - Object containing fields to update
   * @returns Updated user data
   */
  async updateUser(userId: string, updates: Record<string, any>): Promise<User> {
    try {
      const res = await this.client.put(`/users/${userId}`, updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Follow a user
   * @param userId - User ID to follow
   * @returns Status of the follow operation
   */
  async followUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post(`/users/${userId}/follow`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unfollow a user
   * @param userId - User ID to unfollow
   * @returns Status of the unfollow operation
   */
  async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.delete(`/users/${userId}/follow`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get all followers of a user
   * @param userId - User ID to get followers for
   * @param limit - Maximum number of followers to return
   * @param offset - Number of followers to skip for pagination
   * @returns Array of users who follow the specified user and pagination info
   */
  async getUserFollowers(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ followers: User[]; total: number; hasMore: boolean }> {
    try {
      const params: Record<string, any> = {};
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;
      const res = await this.client.get(`/users/${userId}/followers`, { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get all users that a user is following
   * @param userId - User ID to get following list for
   * @param limit - Maximum number of users to return
   * @param offset - Number of users to skip for pagination
   * @returns Array of users the specified user follows and pagination info
   */
  async getUserFollowing(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ following: User[]; total: number; hasMore: boolean }> {
    try {
      const params: Record<string, any> = {};
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;
      const res = await this.client.get(`/users/${userId}/following`, { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* Notification Methods */

  /**
   * Fetch all notifications for the authenticated user
   * @returns Array of notifications
   */
  async getNotifications(): Promise<Notification[]> {
    try {
      const res = await this.client.get('/notifications');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get count of unread notifications
   * @returns Number of unread notifications
   */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await this.client.get('/notifications/unread-count');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create a new notification (admin use)
   * @param data - Notification data
   * @returns Created notification
   */
  async createNotification(data: Partial<Notification>): Promise<Notification> {
    try {
      const res = await this.client.post('/notifications', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark a single notification as read
   * @param notificationId - ID of notification to mark as read
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      await this.client.put(`/notifications/${notificationId}/read`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(): Promise<void> {
    try {
      await this.client.put('/notifications/read-all');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a notification
   * @param notificationId - ID of notification to delete
   */
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await this.client.delete(`/notifications/${notificationId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* Payment Methods */

  /**
   * Process a payment
   * @param data - Payment data including user ID, plan, and payment method
   * @returns Payment result with transaction ID
   */
  async processPayment(data: PaymentRequest): Promise<PaymentResponse> {
    try {
      const res = await this.client.post('/payments/process', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validate a payment method
   * @param paymentMethod - Payment method to validate
   * @returns Object indicating if the payment method is valid
   */
  async validatePaymentMethod(paymentMethod: any): Promise<{ valid: boolean }> {
    try {
      const res = await this.client.post('/payments/validate', { paymentMethod });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get saved payment methods for a user
   * @param userId - User ID to get payment methods for
   * @returns Array of payment methods
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    try {
      const res = await this.client.get(`/payments/methods/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* Analytics Methods */

  /**
   * Get analytics data
   * @param userId - User ID to get analytics for
   * @param period - Time period for analytics (e.g., "day", "week", "month")
   * @returns Analytics data
   */
  async getAnalytics(userId: string, period?: string): Promise<AnalyticsData> {
    try {
      const params: Record<string, any> = { userID: userId };
      if (period) params.period = period;
      const res = await this.client.get('/analytics', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update analytics (internal use)
   * @param userId - User ID to update analytics for
   * @param type - Type of analytics to update
   * @param data - Analytics data to update
   * @returns Message indicating success
   */
  async updateAnalytics(userId: string, type: string, data: Record<string, any>): Promise<{ message: string }> {
    try {
      const res = await this.client.post('/analytics/update', { userID: userId, type, data });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get content viewers analytics
   * @param userId - User ID to get viewer data for
   * @param period - Time period for analytics
   * @returns Array of content viewer data
   */
  async getContentViewers(userId: string, period?: string): Promise<ContentViewer[]> {
    try {
      const params: Record<string, any> = { userID: userId };
      if (period) params.period = period;
      const res = await this.client.get('/analytics/viewers', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get follower analytics details
   * @param userId - User ID to get follower data for
   * @param period - Time period for follower data
   * @returns Follower details
   */
  async getFollowerDetails(userId: string, period?: string): Promise<FollowerDetails> {
    try {
      const params: Record<string, any> = { userID: userId };
      if (period) params.period = period;
      const res = await this.client.get('/analytics/followers', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* Wallet Methods */

  /**
   * Get wallet info
   * @param userId - User ID to get wallet for
   * @returns Wallet data
   */
  async getWallet(userId: string): Promise<Wallet> {
    try {
      const res = await this.client.get(`/wallet/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get transaction history
   * @param userId - User ID to get transactions for
   * @param limit - Maximum number of transactions to return
   * @param offset - Number of transactions to skip for pagination
   * @returns Array of transactions and pagination info
   */
  async getTransactionHistory(
    userId: string, 
    limit?: number, 
    offset?: number
  ): Promise<{ transactions: Transaction[]; total: number; hasMore: boolean }> {
    try {
      const params: Record<string, any> = {};
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;
      const res = await this.client.get(`/wallet/transactions/${userId}`, { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a specific transaction
   * @param transactionId - ID of transaction to retrieve
   * @returns Transaction data
   */
  async getTransaction(transactionId: string): Promise<Transaction> {
    try {
      const res = await this.client.get(`/wallet/transaction/${transactionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Transfer funds between users
   * @param data - Transfer details including source, destination, and amount
   * @returns Transaction response
   */
  async transferFunds(data: TransferFundsRequest): Promise<TransactionResponse> {
    try {
      const res = await this.client.post('/wallet/transfer', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Process a purchase
   * @param data - Purchase details including user, item, and amount
   * @returns Transaction response
   */
  async processPurchase(data: PurchaseRequest): Promise<TransactionResponse> {
    try {
      const res = await this.client.post('/wallet/purchase', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Request a withdrawal
   * @param data - Withdrawal details including user, amount, and address
   * @returns Transaction response
   */
  async requestWithdrawal(data: WithdrawalRequest): Promise<TransactionResponse> {
    try {
      const res = await this.client.post('/wallet/withdraw', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* Karma Methods */

  /**
   * Get karma leaderboard
   * @returns Array of karma leaderboard entries
   */
  async getKarmaLeaderboard(): Promise<KarmaLeaderboardEntry[]> {
    try {
      const res = await this.client.get('/karma/leaderboard');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma rules
   * @returns Array of karma rules
   */
  async getKarmaRules(): Promise<KarmaRule[]> {
    try {
      const res = await this.client.get('/karma/rules');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get total karma for a user
   * @param userId - User ID to get karma for
   * @returns Object with total karma points
   */
  async getUserKarmaTotal(userId: string): Promise<{ total: number }> {
    try {
      const res = await this.client.get(`/karma/${userId}/total`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma history for a user
   * @param userId - User ID to get karma history for
   * @param limit - Maximum number of history entries to return
   * @param offset - Number of entries to skip for pagination
   * @returns Karma history entries and pagination info
   */
  async getUserKarmaHistory(
    userId: string, 
    limit?: number, 
    offset?: number
  ): Promise<{ history: KarmaHistory[]; total: number; hasMore: boolean }> {
    try {
      const params: Record<string, any> = {};
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;
      const res = await this.client.get(`/karma/${userId}/history`, { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Award karma points to a user
   * @param data - Karma award details
   * @returns Karma award response
   */
  async awardKarma(data: KarmaAwardRequest): Promise<{ success: boolean; message: string; history: KarmaHistory }> {
    try {
      const res = await this.client.post('/karma/award', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Deduct karma points from a user
   * @param data - Karma deduction details
   * @returns Karma deduction response
   */
  async deductKarma(data: KarmaAwardRequest): Promise<{ success: boolean; message: string; history: KarmaHistory }> {
    try {
      const res = await this.client.post('/karma/deduct', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create or update karma rule (admin)
   * @param data - Karma rule data
   * @returns Created or updated karma rule
   */
  async createOrUpdateKarmaRule(data: Partial<KarmaRule>): Promise<KarmaRule> {
    try {
      const res = await this.client.post('/karma/rules', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /* File Management Methods */

  /**
   * Upload a file using GridFS
   * @param file - The file to upload (File or Blob in browser, Buffer in Node.js)
   * @param filename - The name of the file
   * @param metadata - Optional metadata to associate with the file
   * @returns File metadata including ID and download URL
   */
  async uploadFile(
    file: File | Blob | Buffer, 
    filename: string, 
    metadata?: Record<string, any>
  ): Promise<FileUploadResponse> {
    try {
      // Create form data to handle the file upload
      const formData = typeof window === 'undefined' && NodeFormData ? new NodeFormData() : new FormData();
      
      // Handle different file types (Browser vs Node.js)
      if (typeof Buffer !== 'undefined' && file instanceof Buffer) {
        // Node.js environment with Buffer
        if (!NodeFormData) {
          throw new Error('form-data module is required for file uploads from Buffer in Node.js but not found.');
        }
        // No need to convert to Blob; form-data handles Buffers directly.
        formData.append('file', file, { filename }); // Pass filename in options for form-data
      } else {
        // Browser environment with File or Blob
        formData.append('file', file as Blob, filename);
      }
      
      // Add metadata as JSON string if provided
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
      }
      
      const res = await this.client.post('/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file metadata by ID
   * @param fileId - ID of the file to retrieve metadata for
   * @returns File metadata
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata> {
    try {
      const res = await this.client.get(`/files/${fileId}/metadata`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update file metadata
   * @param fileId - ID of the file to update
   * @param updates - Metadata updates to apply
   * @returns Updated file metadata
   */
  async updateFileMetadata(fileId: string, updates: FileUpdateRequest): Promise<FileMetadata> {
    try {
      const res = await this.client.put(`/files/${fileId}/metadata`, updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a file by ID
   * @param fileId - ID of the file to delete
   * @returns Status of the delete operation
   */
  async deleteFile(fileId: string): Promise<FileDeleteResponse> {
    try {
      const res = await this.client.delete(`/files/${fileId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get download URL for a file
   * @param fileId - ID of the file to get download URL for
   * @returns Full URL to download the file
   */
  getFileDownloadUrl(fileId: string): string {
    return `${this.client.defaults.baseURL}/files/${fileId}/download`;
  }

  /**
   * Stream a file (useful for playing audio/video without full download)
   * @param fileId - ID of the file to stream
   * @returns Full URL to stream the file
   */
  getFileStreamUrl(fileId: string): string {
    return `${this.client.defaults.baseURL}/files/${fileId}/stream`;
  }

  /**
   * List files for a specific user
   * @param userId - User ID to list files for
   * @param limit - Maximum number of files to return
   * @param offset - Number of files to skip for pagination
   * @param filters - Optional filters for the file list (e.g., contentType)
   * @returns Array of file metadata and pagination info
   */
  async listUserFiles(
    userId: string,
    limit?: number,
    offset?: number,
    filters?: Record<string, any>
  ): Promise<FileListResponse> {
    try {
      const params: Record<string, any> = { userId };
      if (limit !== undefined) params.limit = limit;
      if (offset !== undefined) params.offset = offset;
      if (filters) Object.assign(params, filters);
      
      const res = await this.client.get('/files', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Secure login that returns only session data (no tokens stored locally)
   * @param username - User's username or email
   * @param password - User's password
   * @param deviceName - Optional device name for session tracking
   * @returns Secure login response with session data
   */
  async secureLogin(username: string, password: string, deviceName?: string): Promise<SecureLoginResponse> {
    try {
      const res = await this.client.post('/secure-session/login', { 
        username, 
        password, 
        deviceName 
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get full user data by session ID
   * @param sessionId - The session ID
   * @returns Full user data
   */
  async getUserBySession(sessionId: string): Promise<User> {
    try {
      const res = await this.client.get(`/secure-session/user/${sessionId}`);
      return res.data.user;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get access token by session ID (for API calls)
   * @param sessionId - The session ID
   * @returns Access token and expiry info
   */
  async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
    try {
      const res = await this.client.get(`/secure-session/token/${sessionId}`);
      // Set the token for subsequent API calls
      this.accessToken = res.data.accessToken;
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get all active sessions for current user
   * @param sessionId - Current session ID
   * @returns Array of user sessions
   */
  async getSessionsBySessionId(sessionId: string): Promise<any[]> {
    try {
      const res = await this.client.get(`/secure-session/sessions/${sessionId}`);
      return res.data.sessions;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout specific session
   * @param sessionId - Current session ID
   * @param targetSessionId - Optional target session to logout (defaults to current)
   */
  async logoutSecureSession(sessionId: string, targetSessionId?: string): Promise<void> {
    try {
      await this.client.post(`/secure-session/logout/${sessionId}`, { 
        targetSessionId 
      });
      
      // If we're logging out the current session, clear the access token
      if (!targetSessionId || targetSessionId === sessionId) {
        this.accessToken = null;
        this.refreshToken = null;
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout all sessions for current user
   * @param sessionId - Current session ID
   */
  async logoutAllSecureSessions(sessionId: string): Promise<void> {
    try {
      await this.client.post(`/secure-session/logout-all/${sessionId}`);
      // Clear tokens since all sessions are logged out
      this.accessToken = null;
      this.refreshToken = null;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validate session
   * @param sessionId - The session ID to validate
   * @returns Session validation status
   */
  async validateSession(sessionId: string): Promise<{ valid: boolean; expiresAt: string; lastActivity: string }> {
    try {
      const res = await this.client.get(`/secure-session/validate/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Utility method to help implement authentication middleware in Express.js applications
   * This creates a function that can be used as Express middleware to validate tokens
   * @param options - Configuration options for the middleware
   * @returns Express middleware function
   */
  public createAuthenticateTokenMiddleware(options: {
    loadFullUser?: boolean; // Whether to load full user object or just user ID
    onError?: (error: ApiError) => any; // Custom error handler
  } = {}) {
    const { loadFullUser = true, onError } = options;
    
    return async (req: any, res: any, next: any) => {
      try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
          const error = {
            message: 'Access token required',
            code: 'MISSING_TOKEN',
            status: 401
          };
          
          if (onError) {
            return onError(error);
          }
          
          return res.status(401).json({ 
            message: 'Access token required',
            code: 'MISSING_TOKEN'
          });
        }
        
        // Create a temporary OxyServices instance with the token to validate it
        const tempOxyServices = new OxyServices({
          baseURL: this.client.defaults.baseURL || ''
        });
        tempOxyServices.setTokens(token, ''); // Set access token
        
        // Validate token using the validate method
        const isValid = await tempOxyServices.validate();
        
        if (!isValid) {
          const error = {
            message: 'Invalid or expired token',
            code: 'INVALID_TOKEN',
            status: 403
          };
          
          if (onError) {
            return onError(error);
          }
          
          return res.status(403).json({ 
            message: 'Invalid or expired token',
            code: 'INVALID_TOKEN'
          });
        }
        
        // Get user ID from token
        const userId = tempOxyServices.getCurrentUserId();
        if (!userId) {
          const error = {
            message: 'Invalid token payload',
            code: 'INVALID_PAYLOAD',
            status: 403
          };
          
          if (onError) {
            return onError(error);
          }
          
          return res.status(403).json({ 
            message: 'Invalid token payload',
            code: 'INVALID_PAYLOAD'
          });
        }
        
        // Set user information on request object
        req.userId = userId;
        req.accessToken = token;
        
        // Optionally load full user data
        if (loadFullUser) {
          try {
            const userProfile = await tempOxyServices.getUserById(userId);
            req.user = userProfile;
          } catch (userError) {
            // If we can't load user, continue with just ID
            req.user = { id: userId };
          }
        } else {
          req.user = { id: userId };
        }
        
        next();
      } catch (error) {
        const apiError = this.handleError(error);
        
        if (onError) {
          return onError(apiError);
        }
        
        return res.status(apiError.status || 500).json({ 
          message: apiError.message,
          code: apiError.code
        });
      }
    };
  }

  /**
   * Helper method for validating tokens without Express middleware
   * Useful for standalone token validation in various contexts
   * @param token - The access token to validate
   * @returns Object with validation result and user information
   */
  public async authenticateToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    user?: any;
    error?: string;
  }> {
    try {
      if (!token) {
        return {
          valid: false,
          error: 'Token is required'
        };
      }
      
      // Create a temporary OxyServices instance with the token
      const tempOxyServices = new OxyServices({
        baseURL: this.client.defaults.baseURL || ''
      });
      tempOxyServices.setTokens(token, '');
      
      // Validate token
      const isValid = await tempOxyServices.validate();
      
      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid or expired token'
        };
      }
      
      // Get user ID from token
      const userId = tempOxyServices.getCurrentUserId();
      if (!userId) {
        return {
          valid: false,
          error: 'Invalid token payload'
        };
      }
      
      // Try to get user profile
      let user;
      try {
        user = await tempOxyServices.getUserById(userId);
      } catch (error) {
        // Continue without full user data
        user = { id: userId };
      }
      
      return {
        valid: true,
        userId,
        user
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Token validation failed'
      };
    }
  }

  /**
   * Centralized error handling
   * @private
   * @param error - Error object from API call
   * @returns Formatted API error
   */
  private handleError(error: any): ApiError {
    if (error && error.code && error.status) {
      // Already formatted as ApiError
      return error as ApiError;
    }
    
    const apiError: ApiError = {
      message: error?.message || (error?.response?.data as any)?.message || 'Unknown error occurred',
      code: (error?.response?.data as any)?.code || 'UNKNOWN_ERROR',
      status: error?.response?.status || 500,
      details: error?.response?.data
    };
    
    return apiError;
  }
}

export default OxyServices;