import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';
import { getFormDataConstructor } from '../utils/polyfills';

let NodeFormData: any = null;

// Check if we're in Node.js environment
if (typeof window === 'undefined') {
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
  FileDeleteResponse,
  // Device session interfaces
  DeviceSession,
  DeviceSessionsResponse,
  DeviceSessionLogoutResponse,
  UpdateDeviceNameResponse
} from '../models/interfaces';

// Import secure session types
import { SecureLoginResponse, SecureClientSession } from '../models/secureSession';

/**
 * Default cloud URL for Oxy services, cloud is where the user files are. (e.g. images, videos, etc.). Not the API.
 */
export const OXY_CLOUD_URL = 'https://cloud.oxy.so';

/**
 * Default API URL for Oxy services - this is where the authentication and API endpoints are.
 */
export const OXY_API_URL = 'http://localhost:3001';

// Export device management utilities
export { DeviceManager, DeviceFingerprint, StoredDeviceInfo } from '../utils/deviceManager';

interface JwtPayload {
  exp: number;
  userId: string;
  [key: string]: any;
}

/**
 * Standard API response format from the updated API
 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * OxyServices - Client library for interacting with the Oxy API
 * 
 * Updated to work with the improved API structure with standardized responses
 * and better error handling.
 * 
 * Note: For authentication status in UI components, use `isAuthenticated` from useOxy() context
 * instead of checking token status directly on this service.
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
      }
      
      // Check if token is expired and refresh if needed
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
    
    // Response interceptor for handling errors and standardized responses
    this.client.interceptors.response.use(
      response => {
        // Handle standardized API responses
        if (response.data && typeof response.data === 'object' && 'success' in response.data) {
          const apiResponse = response.data as ApiResponse;
          
          if (!apiResponse.success) {
            // Convert API error to ApiError format
            const apiError: ApiError = {
              message: apiResponse.error?.message || 'API request failed',
              code: apiResponse.error?.code || 'API_ERROR',
              status: response.status,
              details: apiResponse.error?.details
            };
            return Promise.reject(apiError);
          }
          
          // Return the data portion of successful responses
          response.data = apiResponse.data;
        }
        
        return response;
      },
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
            this.clearTokens();
            return Promise.reject(refreshError);
          }
        }

        // Format error response for standardized API errors
        let apiError: ApiError;
        
        if (error.response?.data && typeof error.response.data === 'object' && 'error' in error.response.data) {
          const errorData = error.response.data as any;
          apiError = {
            message: errorData.error?.message || 'An unknown error occurred',
            code: errorData.error?.code || 'UNKNOWN_ERROR',
            status: error.response?.status || 500,
            details: errorData.error?.details
          };
        } else {
          // Fallback for non-standardized errors
          apiError = {
            message: (error.response?.data as any)?.message || error.message || 'An unknown error occurred',
            code: (error.response?.data as any)?.code || 'UNKNOWN_ERROR',
            status: error.response?.status || 500,
            details: error.response?.data
          };
        }

        // If the error is an invalid session, clear tokens
        if (apiError.code === 'INVALID_SESSION' || apiError.message === 'Invalid session') {
          this.clearTokens();
        }

        return Promise.reject(apiError);
      }
    );
  }

  /**
   * Gets the base URL configured for this OxyServices instance
   * @returns The base URL
   */
  public getBaseURL(): string {
    return this.client.defaults.baseURL || '';
  }

  /**
   * Gets the currently authenticated user ID from the token
   * @returns The user ID or null if not authenticated
   */
  public getCurrentUserId(): string | null {
    if (!this.accessToken) return null;
    
    try {
      const decoded = jwtDecode<JwtPayload>(this.accessToken);
      
      // Check for both userId (preferred) and id (fallback) for compatibility
      return decoded.userId || (decoded as any).id || null;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Internal method to check if we have an access token
   * @private
   * @returns Boolean indicating if access token exists
   * @internal - Use `isAuthenticated` from useOxy() context in UI components instead
   */
  private hasAccessToken(): boolean {
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
   * Clears authentication tokens
   */
  public clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  /**
   * Registers a new user account
   * @param username - Username for the new account
   * @param email - Email address for the new account
   * @param password - Password for the new account
   * @returns Promise with registration result
   */
  async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
    try {
      const res = await this.client.post('/auth/signup', { username, email, password });
      
      // Handle both old and new response formats for backward compatibility
      if (res.data.user && res.data.tokens) {
        // New API format
        this.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
        return {
          message: res.data.message || 'User registered successfully',
          token: res.data.tokens.accessToken,
          user: res.data.user
        };
      } else {
        // Legacy format
        this.setTokens(res.data.token, res.data.refreshToken || '');
        return {
          message: res.data.message || 'User registered successfully',
          token: res.data.token,
          user: res.data.user
        };
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Authenticates a user and returns tokens
   * @param username - Username or email for authentication
   * @param password - Password for authentication
   * @returns Promise with login response
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    try {
      const res = await this.client.post('/auth/login', { username, password });
      
      // Handle both old and new response formats for backward compatibility
      if (res.data.user && res.data.tokens) {
        // New API format
        this.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
        return {
          user: res.data.user,
          accessToken: res.data.tokens.accessToken,
          refreshToken: res.data.tokens.refreshToken,
          token: res.data.tokens.accessToken, // For backward compatibility
          message: res.data.message || 'Login successful'
        };
      } else {
        // Legacy format
        this.setTokens(res.data.token, res.data.refreshToken || '');
        return {
          user: res.data.user,
          token: res.data.token,
          accessToken: res.data.token,
          refreshToken: res.data.refreshToken,
          message: res.data.message || 'Login successful'
        };
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out the current user and invalidates tokens
   * @returns Promise that resolves when logout is complete
   */
  async logout(): Promise<void> {
    try {
      if (this.refreshToken) {
        await this.client.post('/auth/logout', { refreshToken: this.refreshToken });
      }
    } catch (error) {
      // Log error but don't throw - we want to clear tokens regardless
      console.warn('Logout request failed, but clearing tokens:', error);
    } finally {
      this.clearTokens();
    }
  }

  /**
   * Refreshes the access token using the refresh token
   * @returns Promise with new tokens
   */
  async refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    // Prevent multiple simultaneous refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const res = await this.client.post('/auth/refresh', { refreshToken: this.refreshToken });
        
        // Handle both old and new response formats
        let newAccessToken: string;
        let newRefreshToken: string;
        
        if (res.data.accessToken && res.data.refreshToken) {
          // New API format
          newAccessToken = res.data.accessToken;
          newRefreshToken = res.data.refreshToken;
        } else {
          // Legacy format
          newAccessToken = res.data.token || res.data.accessToken;
          newRefreshToken = res.data.refreshToken || this.refreshToken;
        }
        
        this.setTokens(newAccessToken, newRefreshToken);
        
        return {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken
        };
      } catch (error) {
        // Clear tokens on refresh failure
        this.clearTokens();
        throw this.handleError(error);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Validates the current authentication token
   * @returns Promise that resolves to true if token is valid
   */
  async validate(): Promise<boolean> {
    try {
      await this.client.get('/auth/validate');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets user sessions
   * @returns Promise with user sessions
   */
  async getUserSessions(): Promise<any[]> {
    try {
      const res = await this.client.get('/sessions');
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out a specific session
   * @param sessionId - ID of the session to logout
   * @returns Promise with logout result
   */
  async logoutSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.delete(`/sessions/${sessionId}`);
      return {
        success: true,
        message: res.data?.message || 'Session logged out successfully'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out all other sessions except the current one
   * @returns Promise with logout result
   */
  async logoutOtherSessions(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post('/sessions/logout-others');
      return {
        success: true,
        message: res.data?.message || 'Other sessions logged out successfully'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out all sessions including the current one
   * @returns Promise with logout result
   */
  async logoutAllSessions(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post('/sessions/logout-all');
      this.clearTokens();
      return {
        success: true,
        message: res.data?.message || 'All sessions logged out successfully'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets device sessions for a specific session
   * @param sessionId - Session ID
   * @param deviceId - Optional device ID filter
   * @returns Promise with device sessions
   */
  async getDeviceSessions(sessionId: string, deviceId?: string): Promise<DeviceSession[]> {
    try {
      const params: any = {};
      if (deviceId) {
        params.deviceId = deviceId;
      }
      
      const res = await this.client.get(`/secure-session/device/sessions/${sessionId}`, { params });
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out all device sessions
   * @param sessionId - Session ID
   * @param deviceId - Optional device ID
   * @param excludeCurrent - Whether to exclude current session
   * @returns Promise with logout result
   */
  async logoutAllDeviceSessions(sessionId: string, deviceId?: string, excludeCurrent?: boolean): Promise<DeviceSessionLogoutResponse> {
    try {
      const data: any = {};
      if (deviceId) data.deviceId = deviceId;
      if (excludeCurrent !== undefined) data.excludeCurrent = excludeCurrent;
      
      const res = await this.client.post(`/secure-session/device/logout-all/${sessionId}`, data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Updates device name
   * @param sessionId - Session ID
   * @param deviceName - New device name
   * @returns Promise with update result
   */
  async updateDeviceName(sessionId: string, deviceName: string): Promise<UpdateDeviceNameResponse> {
    try {
      const res = await this.client.put(`/secure-session/device/name/${sessionId}`, { deviceName });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets user profile by username
   * @param username - Username to search for
   * @returns Promise with user profile
   */
  async getProfileByUsername(username: string): Promise<User> {
    try {
      // Use the search endpoint with POST request
      const res = await this.client.post('/users/search', { query: username });
      
      const users = res.data?.data || [];
      if (users.length === 0) {
        throw new Error('User not found');
      }
      
      // Find exact username match
      const user = users.find((u: User) => u.username === username);
      if (!user) {
        throw new Error('User not found');
      }
      
      return user;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Searches for user profiles
   * @param query - Search query
   * @param limit - Maximum number of results
   * @param offset - Number of results to skip
   * @returns Promise with search results
   */
  async searchProfiles(query: string, limit?: number, offset?: number): Promise<User[]> {
    try {
      // Use the search endpoint with POST request
      const res = await this.client.post('/users/search', { query });
      return res.data?.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets profile recommendations
   * @returns Promise with recommended profiles
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
      const res = await this.client.get('/users/recommendations');
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets user by ID
   * @param userId - User ID
   * @returns Promise with user data
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
   * Gets current user profile
   * @returns Promise with current user data
   */
  async getCurrentUser(): Promise<User> {
    try {
      const res = await this.client.get('/users/me');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Updates current user profile
   * @param updates - Profile updates
   * @returns Promise with updated user data
   */
  async updateProfile(updates: Record<string, any>): Promise<User> {
    try {
      const res = await this.client.put('/users/me', updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Updates user by ID (admin function)
   * @param userId - User ID
   * @param updates - User updates
   * @returns Promise with updated user data
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
   * Follows a user
   * @param userId - User ID to follow
   * @returns Promise with follow result
   */
  async followUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post(`/users/${userId}/follow`);
      return {
        success: true,
        message: res.data?.message || 'User followed successfully'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unfollows a user
   * @param userId - User ID to unfollow
   * @returns Promise with unfollow result
   */
  async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.delete(`/users/${userId}/follow`);
      return {
        success: true,
        message: res.data?.message || 'User unfollowed successfully'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets follow status for a user
   * @param userId - User ID to check
   * @returns Promise with follow status
   */
  async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
    try {
      // Since there's no direct status endpoint, we'll use the follow endpoint
      // which returns the current status in the response
      const res = await this.client.post(`/users/${userId}/follow`);
      return {
        isFollowing: res.data?.action === 'follow'
      };
    } catch (error: any) {
      // If it's a 400 error with "already following", then we are following
      if (error.status === 400 && error.message?.includes('already following')) {
        return { isFollowing: true };
      }
      throw this.handleError(error);
    }
  }

  /**
   * Gets all followers of a user
   * @param userId - User ID to get followers for
   * @param limit - Maximum number of followers to return
   * @param offset - Number of followers to skip for pagination
   * @returns Promise with followers and pagination info
   */
  async getUserFollowers(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ followers: User[]; total: number; hasMore: boolean }> {
    try {
      const params: any = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      
      const res = await this.client.get(`/users/${userId}/followers`, { params });
      return {
        followers: res.data?.followers || [],
        total: res.data?.total || 0,
        hasMore: res.data?.hasMore || false
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets all users that a user is following
   * @param userId - User ID to get following list for
   * @param limit - Maximum number of users to return
   * @param offset - Number of users to skip for pagination
   * @returns Promise with following users and pagination info
   */
  async getUserFollowing(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<{ following: User[]; total: number; hasMore: boolean }> {
    try {
      const params: any = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      
      const res = await this.client.get(`/users/${userId}/following`, { params });
      return {
        following: res.data?.following || [],
        total: res.data?.total || 0,
        hasMore: res.data?.hasMore || false
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets user notifications
   * @returns Promise with notifications
   */
  async getNotifications(): Promise<Notification[]> {
    try {
      const res = await this.client.get('/notifications');
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets unread notification count
   * @returns Promise with unread count
   */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await this.client.get('/notifications/unread-count');
      return res.data?.unreadCount || 0;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Creates a new notification
   * @param data - Notification data
   * @returns Promise with created notification
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
   * Marks a notification as read
   * @param notificationId - Notification ID
   * @returns Promise that resolves when marked as read
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      await this.client.put(`/notifications/${notificationId}/read`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Marks all notifications as read
   * @returns Promise that resolves when all marked as read
   */
  async markAllNotificationsAsRead(): Promise<void> {
    try {
      await this.client.put('/notifications/read-all');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Deletes a notification
   * @param notificationId - Notification ID
   * @returns Promise that resolves when deleted
   */
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await this.client.delete(`/notifications/${notificationId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Processes a payment
   * @param data - Payment request data
   * @returns Promise with payment response
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
   * Validates a payment method
   * @param paymentMethod - Payment method to validate
   * @returns Promise with validation result
   */
  async validatePaymentMethod(paymentMethod: any): Promise<{ valid: boolean }> {
    try {
      const res = await this.client.post('/payments/validate', { paymentMethod });
      return { valid: res.data?.valid || false };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets payment methods for a user
   * @param userId - User ID
   * @returns Promise with payment methods
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    try {
      const res = await this.client.get(`/payments/methods/${userId}`);
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets analytics data for a user
   * @param userId - User ID
   * @param period - Analytics period
   * @returns Promise with analytics data
   */
  async getAnalytics(userId: string, period?: string): Promise<AnalyticsData> {
    try {
      const params: any = { userID: userId };
      if (period) params.period = period;
      
      const res = await this.client.get('/analytics', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Updates analytics data
   * @param userId - User ID
   * @param type - Analytics type
   * @param data - Analytics data
   * @returns Promise with update result
   */
  async updateAnalytics(userId: string, type: string, data: Record<string, any>): Promise<{ message: string }> {
    try {
      const res = await this.client.post('/analytics/update', { userID: userId, type, data });
      return { message: res.data?.message || 'Analytics updated successfully' };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets content viewers for a user
   * @param userId - User ID
   * @param period - Analytics period
   * @returns Promise with content viewers
   */
  async getContentViewers(userId: string, period?: string): Promise<ContentViewer[]> {
    try {
      const params: any = { userID: userId };
      if (period) params.period = period;
      
      const res = await this.client.get('/analytics/viewers', { params });
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets follower details for a user
   * @param userId - User ID
   * @param period - Analytics period
   * @returns Promise with follower details
   */
  async getFollowerDetails(userId: string, period?: string): Promise<FollowerDetails> {
    try {
      const params: any = { userID: userId };
      if (period) params.period = period;
      
      const res = await this.client.get('/analytics/followers', { params });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets user wallet
   * @param userId - User ID
   * @returns Promise with wallet data
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
   * Gets transaction history for a user
   * @param userId - User ID
   * @param limit - Maximum number of transactions
   * @param offset - Number of transactions to skip
   * @returns Promise with transaction history and pagination info
   */
  async getTransactionHistory(
    userId: string, 
    limit?: number, 
    offset?: number
  ): Promise<{ transactions: Transaction[]; total: number; hasMore: boolean }> {
    try {
      const params: any = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      
      const res = await this.client.get(`/wallet/transactions/${userId}`, { params });
      return {
        transactions: res.data?.transactions || [],
        total: res.data?.total || 0,
        hasMore: res.data?.hasMore || false
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets a specific transaction
   * @param transactionId - Transaction ID
   * @returns Promise with transaction data
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
   * Transfers funds between users
   * @param data - Transfer request data
   * @returns Promise with transaction response
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
   * Processes a purchase
   * @param data - Purchase request data
   * @returns Promise with transaction response
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
   * Requests a withdrawal
   * @param data - Withdrawal request data
   * @returns Promise with transaction response
   */
  async requestWithdrawal(data: WithdrawalRequest): Promise<TransactionResponse> {
    try {
      const res = await this.client.post('/wallet/withdraw', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets karma leaderboard
   * @returns Promise with leaderboard entries
   */
  async getKarmaLeaderboard(): Promise<KarmaLeaderboardEntry[]> {
    try {
      const res = await this.client.get('/karma/leaderboard');
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets karma rules
   * @returns Promise with karma rules
   */
  async getKarmaRules(): Promise<KarmaRule[]> {
    try {
      const res = await this.client.get('/karma/rules');
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets total karma for a user
   * @param userId - User ID
   * @returns Promise with total karma
   */
  async getUserKarmaTotal(userId: string): Promise<{ total: number }> {
    try {
      const res = await this.client.get(`/karma/${userId}/total`);
      return { total: res.data?.total || 0 };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets karma history for a user
   * @param userId - User ID
   * @param limit - Maximum number of history entries
   * @param offset - Number of entries to skip
   * @returns Promise with karma history and pagination info
   */
  async getUserKarmaHistory(
    userId: string, 
    limit?: number, 
    offset?: number
  ): Promise<{ history: KarmaHistory[]; total: number; hasMore: boolean }> {
    try {
      const params: any = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      
      const res = await this.client.get(`/karma/${userId}/history`, { params });
      return {
        history: res.data?.history || [],
        total: res.data?.total || 0,
        hasMore: res.data?.hasMore || false
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Awards karma to a user
   * @param data - Karma award request data
   * @returns Promise with award result
   */
  async awardKarma(data: KarmaAwardRequest): Promise<{ success: boolean; message: string; history: KarmaHistory }> {
    try {
      const res = await this.client.post('/karma/award', data);
      return {
        success: true,
        message: res.data?.message || 'Karma awarded successfully',
        history: res.data?.history
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Deducts karma from a user
   * @param data - Karma deduction request data
   * @returns Promise with deduction result
   */
  async deductKarma(data: KarmaAwardRequest): Promise<{ success: boolean; message: string; history: KarmaHistory }> {
    try {
      const res = await this.client.post('/karma/deduct', data);
      return {
        success: true,
        message: res.data?.message || 'Karma deducted successfully',
        history: res.data?.history
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Creates or updates a karma rule
   * @param data - Karma rule data
   * @returns Promise with karma rule
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
   * Uploads a single file
   * @param file - File to upload (File, Blob, or Buffer)
   * @param filename - Name for the uploaded file
   * @param metadata - Optional metadata for the file
   * @returns Promise with file metadata
   */
  async uploadFile(
    file: File | Blob | any, // Use 'any' to handle Buffer type in cross-platform scenarios
    filename: string, 
    metadata?: Record<string, any>
  ): Promise<FileMetadata> {
    try {
      const FormData = getFormDataConstructor();
      const formData = new FormData();
      
      // Handle different file types
      if (file instanceof File || file instanceof Blob) {
        formData.append('file', file, filename);
      } else if (NodeFormData && Buffer.isBuffer(file)) {
        // Node.js environment with Buffer
        formData.append('file', file, { filename });
      } else {
        throw new Error('Unsupported file type');
      }
      
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
   * Uploads multiple files
   * @param files - Array of files to upload
   * @param filenames - Array of filenames
   * @param metadata - Optional metadata for the files
   * @returns Promise with upload response
   */
  async uploadFiles(
    files: (File | Blob | any)[], 
    filenames: string[], 
    metadata?: Record<string, any>
  ): Promise<FileUploadResponse> {
    try {
      const FormData = getFormDataConstructor();
      const formData = new FormData();
      
      files.forEach((file, index) => {
        const filename = filenames[index] || `file-${index}`;
        
        if (file instanceof File || file instanceof Blob) {
          formData.append('files', file, filename);
        } else if (NodeFormData && Buffer.isBuffer(file)) {
          formData.append('files', file, { filename });
        } else {
          throw new Error(`Unsupported file type at index ${index}`);
        }
      });
      
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
   * Gets file metadata
   * @param fileId - File ID
   * @returns Promise with file metadata
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
   * Updates file metadata
   * @param fileId - File ID
   * @param updates - Metadata updates
   * @returns Promise with updated file metadata
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
   * Deletes a file
   * @param fileId - File ID
   * @returns Promise with delete response
   */
  async deleteFile(fileId: string): Promise<FileDeleteResponse> {
    try {
      const res = await this.client.delete(`/files/${fileId}`);
      return {
        success: true,
        message: res.data?.message || 'File deleted successfully',
        fileId
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets file download URL
   * @param fileId - File ID
   * @returns File download URL
   */
  getFileDownloadUrl(fileId: string): string {
    return `${this.client.defaults.baseURL}/files/${fileId}`;
  }

  /**
   * Gets file stream URL
   * @param fileId - File ID
   * @returns File stream URL
   */
  getFileStreamUrl(fileId: string): string {
    return `${this.client.defaults.baseURL}/files/${fileId}`;
  }

  /**
   * Lists user files
   * @param userId - User ID
   * @param limit - Maximum number of files
   * @param offset - Number of files to skip
   * @param filters - Optional filters
   * @returns Promise with file list and pagination info
   */
  async listUserFiles(
    userId: string,
    limit?: number,
    offset?: number,
    filters?: Record<string, any>
  ): Promise<FileListResponse> {
    try {
      const params: any = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      if (filters) {
        Object.assign(params, filters);
      }
      
      const res = await this.client.get(`/files/list/${userId}`, { params });
      return {
        files: res.data?.files || [],
        total: res.data?.total || 0,
        hasMore: res.data?.hasMore || false
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Performs secure login with device fingerprinting
   * @param username - Username or email
   * @param password - Password
   * @param deviceName - Optional device name
   * @param deviceFingerprint - Optional device fingerprint
   * @returns Promise with secure login response
   */
  async secureLogin(username: string, password: string, deviceName?: string, deviceFingerprint?: any): Promise<SecureLoginResponse> {
    try {
      const payload: any = { username, password };
      if (deviceName) payload.deviceName = deviceName;
      if (deviceFingerprint) payload.deviceFingerprint = deviceFingerprint;
      
      const res = await this.client.post('/secure-session/login', payload);
      
      // Handle both old and new response formats
      if (res.data.sessionId && res.data.tokens) {
        // New API format
        this.setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
        return {
          sessionId: res.data.sessionId,
          accessToken: res.data.tokens.accessToken,
          refreshToken: res.data.tokens.refreshToken,
          user: res.data.user,
          message: res.data.message || 'Secure login successful'
        };
      } else {
        // Legacy format
        this.setTokens(res.data.accessToken, res.data.refreshToken);
        return {
          sessionId: res.data.sessionId,
          accessToken: res.data.accessToken,
          refreshToken: res.data.refreshToken,
          user: res.data.user,
          message: res.data.message || 'Secure login successful'
        };
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets user by session ID
   * @param sessionId - Session ID
   * @returns Promise with user data
   */
  async getUserBySession(sessionId: string): Promise<User> {
    try {
      const res = await this.client.get(`/secure-session/user/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets token by session ID
   * @param sessionId - Session ID
   * @returns Promise with token data
   */
  async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
    try {
      const res = await this.client.get(`/secure-session/token/${sessionId}`);
      return {
        accessToken: res.data.accessToken,
        expiresAt: res.data.expiresAt
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets sessions by session ID
   * @param sessionId - Session ID
   * @returns Promise with sessions
   */
  async getSessionsBySessionId(sessionId: string): Promise<any[]> {
    try {
      const res = await this.client.get(`/secure-session/sessions/${sessionId}`);
      return res.data || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out a secure session
   * @param sessionId - Session ID
   * @param targetSessionId - Optional target session ID
   * @returns Promise that resolves when logged out
   */
  async logoutSecureSession(sessionId: string, targetSessionId?: string): Promise<void> {
    try {
      await this.client.post(`/secure-session/logout/${sessionId}`, {
        targetSessionId
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logs out all secure sessions
   * @param sessionId - Session ID
   * @returns Promise that resolves when all logged out
   */
  async logoutAllSecureSessions(sessionId: string): Promise<void> {
    try {
      const response = await this.client.post(`/secure-session/logout-all/${sessionId}`);
      
      // Clear tokens if this was the current session
      if (response.data?.currentSessionLoggedOut) {
        this.clearTokens();
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validates a session
   * @param sessionId - Session ID
   * @returns Promise with validation result
   */
  async validateSession(sessionId: string): Promise<{ valid: boolean; expiresAt: string; lastActivity: string; user: User }> {
    try {
      const res = await this.client.get(`/secure-session/validate/${sessionId}`);
      return {
        valid: res.data.valid,
        expiresAt: res.data.expiresAt,
        lastActivity: res.data.lastActivity,
        user: res.data.user
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validates session from header
   * @param sessionId - Session ID
   * @param deviceFingerprint - Optional device fingerprint
   * @returns Promise with validation result
   */
  async validateSessionFromHeader(sessionId: string, deviceFingerprint?: string): Promise<{ valid: boolean; expiresAt: string; lastActivity: string; user: User; sessionId?: string }> {
    try {
      const headers: any = {};
      if (deviceFingerprint) {
        headers['X-Device-Fingerprint'] = deviceFingerprint;
      }
      
      const res = await this.client.get('/secure-session/validate-header', { headers });
      return {
        valid: res.data.valid,
        expiresAt: res.data.expiresAt,
        lastActivity: res.data.lastActivity,
        user: res.data.user,
        sessionId: res.data.sessionId
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Auto-validates session
   * @param sessionId - Session ID
   * @param deviceFingerprint - Optional device fingerprint
   * @returns Promise with validation result
   */
  async validateSessionAuto(sessionId: string, deviceFingerprint?: string): Promise<{ valid: boolean; expiresAt: string; lastActivity: string; user: User; source?: string }> {
    try {
      const headers: any = {};
      if (deviceFingerprint) {
        headers['X-Device-Fingerprint'] = deviceFingerprint;
      }
      
      const res = await this.client.get('/secure-session/validate/auto', { headers });
      return {
        valid: res.data.valid,
        expiresAt: res.data.expiresAt,
        lastActivity: res.data.lastActivity,
        user: res.data.user,
        source: res.data.source
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Creates authentication middleware for Express.js
   * @param options - Middleware options
   * @returns Express middleware function
   */
  public createAuthenticateTokenMiddleware(options: {
    loadFullUser?: boolean; // Whether to load full user object or just user ID
    onError?: (error: ApiError) => any; // Custom error handler
  } = {}) {
    return async (req: any, res: any, next: any) => {
      try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          const error: ApiError = {
            message: 'No valid authorization header found',
            code: 'MISSING_AUTH_HEADER',
            status: 401
          };
          
          if (options.onError) {
            return options.onError(error);
          }
          
          return res.status(401).json({
            success: false,
            error: {
              code: error.code,
              message: error.message
            }
          });
        }
        
        const token = authHeader.substring(7);
        const result = await this.authenticateToken(token);
        
        if (!result.valid) {
          const error: ApiError = {
            message: result.error || 'Invalid token',
            code: 'INVALID_TOKEN',
            status: 401
          };
          
          if (options.onError) {
            return options.onError(error);
          }
          
          return res.status(401).json({
            success: false,
            error: {
              code: error.code,
              message: error.message
            }
          });
        }
        
        // Add user info to request
        req.userId = result.userId;
        if (options.loadFullUser && result.user) {
          req.user = result.user;
        }
        
        next();
      } catch (error) {
        const apiError = this.handleError(error);
        
        if (options.onError) {
          return options.onError(apiError);
        }
        
        return res.status(apiError.status).json({
          success: false,
          error: {
            code: apiError.code,
            message: apiError.message
          }
        });
      }
    };
  }

  /**
   * Authenticates a token and returns validation result
   * @param token - JWT token to validate
   * @returns Promise with authentication result
   */
  public async authenticateToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    user?: any;
    error?: string;
  }> {
    try {
      // First try to decode the token to get basic info
      const decoded = jwtDecode<JwtPayload>(token);
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Check if token is expired
      if (decoded.exp && decoded.exp < currentTime) {
        return {
          valid: false,
          error: 'Token has expired'
        };
      }
      
      // Get user ID from token
      const userId = decoded.userId || (decoded as any).id;
      if (!userId) {
        return {
          valid: false,
          error: 'Token does not contain user ID'
        };
      }
      
      // Validate token with server
      try {
        const res = await this.client.get('/auth/validate', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        return {
          valid: true,
          userId,
          user: res.data?.user
        };
      } catch (validationError) {
        return {
          valid: false,
          error: 'Token validation failed'
        };
      }
    } catch (decodeError) {
      return {
        valid: false,
        error: 'Invalid token format'
      };
    }
  }

  /**
   * Handles errors and converts them to ApiError format
   * @param error - Error to handle
   * @returns ApiError object
   */
  private handleError(error: any): ApiError {
    if (error.response) {
      // Axios error with response
      const status = error.response.status;
      const data = error.response.data;
      
      return {
        message: data?.error?.message || data?.message || 'Request failed',
        code: data?.error?.code || data?.code || 'REQUEST_FAILED',
        status,
        details: data?.error?.details || data
      };
    } else if (error.request) {
      // Axios error without response (network error)
      return {
        message: 'Network error - no response received',
        code: 'NETWORK_ERROR',
        status: 0,
        details: error.request
      };
    } else {
      // Other error
      return {
        message: error.message || 'An unknown error occurred',
        code: 'UNKNOWN_ERROR',
        status: 500,
        details: error
      };
    }
  }

  /**
   * Checks if a username is available
   * @param username - Username to check
   * @returns Promise with availability result
   */
  async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
    try {
      const res = await this.client.get(`/auth/check-username/${username}`);
      return {
        available: res.data?.available || false,
        message: res.data?.message || 'Username availability checked'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Checks if an email is available
   * @param email - Email to check
   * @returns Promise with availability result
   */
  async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
    try {
      const res = await this.client.post('/auth/check-email', { email });
      return {
        available: res.data?.available || false,
        message: res.data?.message || 'Email availability checked'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Gets user profile by username (legacy method for backward compatibility)
   * @param username - Username to search for
   * @returns Promise with user profile
   */
  async getUserProfileByUsername(username: string): Promise<User> {
    // Use the updated method
    return this.getProfileByUsername(username);
  }

  /**
   * Returns the current access token
   */
  public getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Returns the current refresh token
   */
  public getRefreshToken(): string | null {
    return this.refreshToken;
  }
}

// Create default instance for backward compatibility
const defaultOxyServices = new OxyServices({ 
  baseURL: process.env.OXY_API_URL || OXY_API_URL
});

// Export default instance
export default defaultOxyServices;