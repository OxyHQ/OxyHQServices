import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';
import { OxyConfig, ApiError, User, Notification } from '../models/interfaces';
import { SessionLoginResponse } from '../models/session';
import { handleHttpError } from '../utils/errorUtils';
import { buildSearchParams, buildPaginationParams, PaginationParams } from '../utils/apiUtils';

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  [key: string]: any;
}

/**
 * Custom error types for better error handling
 */
export class OxyAuthenticationError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string = 'AUTH_ERROR', status: number = 401) {
    super(message);
    this.name = 'OxyAuthenticationError';
    this.code = code;
    this.status = status;
  }
}

export class OxyAuthenticationTimeoutError extends OxyAuthenticationError {
  constructor(operationName: string, timeoutMs: number) {
    super(
      `Authentication timeout (${timeoutMs}ms): ${operationName} requires user authentication. Please ensure the user is logged in before calling this method.`,
      'AUTH_TIMEOUT',
      408
    );
    this.name = 'OxyAuthenticationTimeoutError';
  }
}

/**
 * OxyServices - Unified client library for interacting with the Oxy API
 * 
 * This class provides all API functionality in one simple, easy-to-use interface.
 * No need to manage multiple service instances - everything is available directly.
 */
// Centralized token store
class TokenStore {
  private static instance: TokenStore;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  private constructor() {}

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }

  setTokens(accessToken: string, refreshToken: string = ''): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
  }

  hasAccessToken(): boolean {
    return !!this.accessToken;
  }
}

export class OxyServices {
  protected client: AxiosInstance;
  private tokenStore: TokenStore;

  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   */
  constructor(config: OxyConfig) {
    this.client = axios.create({ 
      baseURL: config.baseURL,
      timeout: 10000 // 10 second timeout
    });
    
    this.tokenStore = TokenStore.getInstance();
    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for authentication and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor for adding auth header and handling token refresh
    this.client.interceptors.request.use(
      async (req: InternalAxiosRequestConfig) => {
        console.log('🔍 Interceptor - URL:', req.url);
        console.log('🔍 Interceptor - Has token:', this.tokenStore.hasAccessToken());
        
        const accessToken = this.tokenStore.getAccessToken();
        if (!accessToken) {
          console.log('❌ Interceptor - No token available');
          return req;
        }
        
        try {
          console.log('✅ Interceptor - Adding Authorization header');
          
          const decoded = jwtDecode<JwtPayload>(accessToken);
          const currentTime = Math.floor(Date.now() / 1000);
        
          // If token expires in less than 60 seconds, refresh it
          if (decoded.exp && decoded.exp - currentTime < 60) {
            // For session-based tokens, get a new token from the session
            if (decoded.sessionId) {
              try {
                // Create a new axios instance to avoid interceptor recursion
                const refreshClient = axios.create({ 
                  baseURL: this.client.defaults.baseURL,
                  timeout: this.client.defaults.timeout
                });
                const res = await refreshClient.get(`/api/session/token/${decoded.sessionId}`);
                this.tokenStore.setTokens(res.data.accessToken);
                req.headers.Authorization = `Bearer ${res.data.accessToken}`;
                console.log('✅ Interceptor - Token refreshed and Authorization header set');
              } catch (refreshError) {
                // If refresh fails, use current token anyway
                req.headers.Authorization = `Bearer ${accessToken}`;
                console.log('❌ Interceptor - Token refresh failed, using current token');
              }
            } else {
              // No session ID, use current token
              req.headers.Authorization = `Bearer ${accessToken}`;
              console.log('✅ Interceptor - No session ID, using current token');
            }
          } else {
            // Add authorization header with current token
            req.headers.Authorization = `Bearer ${accessToken}`;
            console.log('✅ Interceptor - Authorization header set with current token');
          }
        } catch (error) {
          console.log('❌ Interceptor - Error processing token:', error);
          // Even if there's an error, still try to use the token
          req.headers.Authorization = `Bearer ${accessToken}`;
          console.log('⚠️ Interceptor - Using token despite error');
        }
        
        return req;
      },
      (error) => {
        console.log('❌ Interceptor - Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for handling auth errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          console.log('❌ Response interceptor - 401 Unauthorized, clearing tokens');
          this.clearTokens();
        }
        return Promise.reject(error);
      }
    );
  }

  // ============================================================================
  // CORE METHODS (HTTP Client, Token Management, Error Handling)
  // ============================================================================

  /**
   * Get the configured base URL
   */
  public getBaseURL(): string {
    return this.client.defaults.baseURL || '';
  }

  /**
   * Set authentication tokens
   */
  public setTokens(accessToken: string, refreshToken: string = ''): void {
    this.tokenStore.setTokens(accessToken, refreshToken);
  }

  /**
   * Clear stored authentication tokens
   */
  public clearTokens(): void {
    this.tokenStore.clearTokens();
  }

  /**
   * Get the current user ID from the access token
   */
  public getCurrentUserId(): string | null {
    const accessToken = this.tokenStore.getAccessToken();
    if (!accessToken) {
      return null;
    }
    
    try {
      const decoded = jwtDecode<JwtPayload>(accessToken);
      return decoded.userId || decoded.id || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if the client has a valid access token
   */
  private hasAccessToken(): boolean {
    return this.tokenStore.hasAccessToken();
  }

  /**
   * Check if the client has a valid access token (public method)
   */
  public hasValidToken(): boolean {
    return this.tokenStore.hasAccessToken();
  }

  /**
   * Wait for authentication to be ready (public method)
   * Useful for apps that want to ensure authentication is complete before proceeding
   */
  public async waitForAuth(timeoutMs: number = 5000): Promise<boolean> {
    return this.waitForAuthentication(timeoutMs);
  }

  /**
   * Wait for authentication to be ready with timeout
   */
  private async waitForAuthentication(timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    while (Date.now() - startTime < timeoutMs) {
      if (this.tokenStore.hasAccessToken()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    return false;
  }

  /**
   * Execute a function with automatic authentication retry logic
   * This handles the common case where API calls are made before authentication completes
   */
  private async withAuthRetry<T>(
    operation: () => Promise<T>, 
    operationName: string,
    options: {
      maxRetries?: number;
      retryDelay?: number;
      authTimeoutMs?: number;
    } = {}
  ): Promise<T> {
    const { 
      maxRetries = 2, 
      retryDelay = 1000,
      authTimeoutMs = 5000 
    } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // First attempt: check if we have a token
        if (!this.tokenStore.hasAccessToken()) {
          if (attempt === 0) {
            // On first attempt, wait briefly for authentication to complete
            console.log(`🔄 ${operationName} - Waiting for authentication...`);
            const authReady = await this.waitForAuthentication(authTimeoutMs);
            
            if (!authReady) {
              throw new OxyAuthenticationTimeoutError(operationName, authTimeoutMs);
            }
            
            console.log(`✅ ${operationName} - Authentication ready, proceeding...`);
          } else {
            // On retry attempts, fail immediately if no token
            throw new OxyAuthenticationError(
              `Authentication required: ${operationName} requires a valid access token.`,
              'AUTH_REQUIRED'
            );
          }
        }

        // Execute the operation
        return await operation();

      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isAuthError = error?.response?.status === 401 || 
                           error?.code === 'MISSING_TOKEN' ||
                           error?.message?.includes('Authentication') ||
                           error instanceof OxyAuthenticationError;

        if (isAuthError && !isLastAttempt && !(error instanceof OxyAuthenticationTimeoutError)) {
          console.log(`🔄 ${operationName} - Auth error on attempt ${attempt + 1}, retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }

        // If it's not an auth error, or it's the last attempt, throw the error
        if (error instanceof OxyAuthenticationError) {
          throw error;
        }
        throw this.handleError(error);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new OxyAuthenticationError(`${operationName} failed after ${maxRetries + 1} attempts`);
  }

  /**
   * Validate the current access token with the server
   */
  async validate(): Promise<boolean> {
    if (!this.hasAccessToken()) {
      return false;
    }

    try {
      const res = await this.client.get('/api/auth/validate');
      return res.data.valid === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get the HTTP client instance (public for external use)
   */
  public getClient(): AxiosInstance {
    return this.client;
  }

  /**
   * Centralized error handling
   */
  protected handleError(error: any): ApiError {
    return handleHttpError(error);
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ 
    status: string; 
    users?: number; 
    timestamp?: string; 
    [key: string]: any 
  }> {
    try {
      const res = await this.client.get('/health');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // AUTHENTICATION METHODS
  // ============================================================================

  /**
   * Sign up a new user
   */
  async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
    try {
      const res = await this.client.post('/api/auth/signup', {
        username,
        email,
        password
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Sign in with device management
   */
  async signIn(username: string, password: string, deviceName?: string, deviceFingerprint?: any): Promise<SessionLoginResponse> {
    try {
      const res = await this.client.post('/api/auth/login', {
        username,
        password,
        deviceName,
        deviceFingerprint
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user by session ID
   */
  async getUserBySession(sessionId: string): Promise<User> {
    try {
      const res = await this.client.get(`/api/session/user/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get access token by session ID and set it in the token store
   */
  async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
    try {
      console.log('🔑 getTokenBySession - Fetching token for session:', sessionId);
      const res = await this.client.get(`/api/session/token/${sessionId}`);
      const { accessToken } = res.data;
      
      console.log('🔑 getTokenBySession - Token received:', !!accessToken);
      
      // Set the token in the centralized token store
      this.setTokens(accessToken);
      console.log('🔑 getTokenBySession - Token set in store');
      
      return res.data;
    } catch (error) {
      console.log('❌ getTokenBySession - Error:', error);
      throw this.handleError(error);
    }
  }

  /**
   * Get sessions by session ID
   */
  async getSessionsBySessionId(sessionId: string): Promise<any[]> {
    try {
      const res = await this.client.get(`/api/session/sessions/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from a specific session
   */
  async logoutSession(sessionId: string, targetSessionId?: string): Promise<void> {
    try {
      const url = targetSessionId 
        ? `/api/session/logout/${sessionId}/${targetSessionId}`
        : `/api/session/logout/${sessionId}`;
      
      await this.client.post(url);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all sessions
   */
  async logoutAllSessions(sessionId: string): Promise<void> {
    try {
      await this.client.post(`/api/session/logout-all/${sessionId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Validate session
   */
  async validateSession(
    sessionId: string, 
    options: {
      deviceFingerprint?: string;
      useHeaderValidation?: boolean;
    } = {}
  ): Promise<{ 
    valid: boolean; 
    expiresAt: string; 
    lastActivity: string; 
    user: User;
    sessionId?: string;
    source?: string;
  }> {
    try {
      const params = new URLSearchParams();
      if (options.deviceFingerprint) {
        params.append('deviceFingerprint', options.deviceFingerprint);
      }
      if (options.useHeaderValidation) {
        params.append('useHeaderValidation', 'true');
      }

      const url = `/api/session/validate/${sessionId}?${params.toString()}`;
      const res = await this.client.get(url);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Check username availability
   */
  async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
    try {
      const res = await this.client.get(`/api/auth/check-username/${username}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Check email availability
   */
  async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
    try {
      const res = await this.client.get(`/api/auth/check-email/${email}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // USER METHODS
  // ============================================================================

  /**
   * Get profile by username
   */
  async getProfileByUsername(username: string): Promise<User> {
    try {
      const res = await this.client.get(`/api/profiles/username/${username}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Search user profiles
   */
  async searchProfiles(query: string, pagination?: PaginationParams): Promise<User[]> {
    try {
      const params = { query, ...pagination };
      const searchParams = buildSearchParams(params);
      
      const res = await this.client.get(`/api/profiles/search?${searchParams.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get profile recommendations
   */
  async getProfileRecommendations(): Promise<Array<{
    id: string;
    username: string;
    name?: { first?: string; last?: string; full?: string };
    description?: string;
    _count?: { followers: number; following: number };
    [key: string]: any;
  }>> {
    return this.withAuthRetry(async () => {
      const res = await this.client.get('/api/profiles/recommendations');
      return res.data;
    }, 'getProfileRecommendations');
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User> {
    try {
      const res = await this.client.get(`/api/users/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User> {
    return this.withAuthRetry(async () => {
      const res = await this.client.get('/api/users/me');
      return res.data;
    }, 'getCurrentUser');
  }

  /**
   * Update user profile
   */
  async updateProfile(updates: Record<string, any>): Promise<User> {
    try {
      const res = await this.client.put('/api/users/me', updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update user by ID (admin function)
   */
  async updateUser(userId: string, updates: Record<string, any>): Promise<User> {
    try {
      const res = await this.client.put(`/api/users/${userId}`, updates);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Follow a user
   */
  async followUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.post(`/api/users/${userId}/follow`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.client.delete(`/api/users/${userId}/follow`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get follow status
   */
  async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
    try {
      const res = await this.client.get(`/api/users/${userId}/follow-status`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user followers
   */
  async getUserFollowers(
    userId: string,
    pagination?: PaginationParams
  ): Promise<{ followers: User[]; total: number; hasMore: boolean }> {
    try {
      const params = buildPaginationParams(pagination || {});
      const res = await this.client.get(`/api/users/${userId}/followers?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user following
   */
  async getUserFollowing(
    userId: string,
    pagination?: PaginationParams
  ): Promise<{ following: User[]; total: number; hasMore: boolean }> {
    try {
      const params = buildPaginationParams(pagination || {});
      const res = await this.client.get(`/api/users/${userId}/following?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get notifications
   */
  async getNotifications(): Promise<Notification[]> {
    return this.withAuthRetry(async () => {
      const res = await this.client.get('/api/notifications');
      return res.data;
    }, 'getNotifications');
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await this.client.get('/api/notifications/unread-count');
      return res.data.count;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create notification
   */
  async createNotification(data: Partial<Notification>): Promise<Notification> {
    try {
      const res = await this.client.post('/api/notifications', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      await this.client.put(`/api/notifications/${notificationId}/read`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(): Promise<void> {
    try {
      await this.client.put('/api/notifications/read-all');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await this.client.delete(`/api/notifications/${notificationId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // PAYMENT METHODS
  // ============================================================================

  /**
   * Create a payment
   */
  async createPayment(data: any): Promise<any> {
    try {
      const res = await this.client.post('/api/payments', data);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<any> {
    try {
      const res = await this.client.get(`/api/payments/${paymentId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user payments
   */
  async getUserPayments(): Promise<any[]> {
    try {
      const res = await this.client.get('/api/payments/user');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // KARMA METHODS
  // ============================================================================

  /**
   * Get user karma
   */
  async getUserKarma(userId: string): Promise<any> {
    try {
      const res = await this.client.get(`/api/karma/${userId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Give karma to user
   */
  async giveKarma(userId: string, amount: number, reason?: string): Promise<any> {
    try {
      const res = await this.client.post(`/api/karma/${userId}/give`, {
        amount,
        reason
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user karma total
   */
  async getUserKarmaTotal(userId: string): Promise<any> {
    try {
      const res = await this.client.get(`/api/karma/${userId}/total`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user karma history
   */
  async getUserKarmaHistory(userId: string, limit?: number, offset?: number): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const res = await this.client.get(`/api/karma/${userId}/history?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma leaderboard
   */
  async getKarmaLeaderboard(): Promise<any> {
    try {
      const res = await this.client.get('/api/karma/leaderboard');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma rules
   */
  async getKarmaRules(): Promise<any> {
    try {
      const res = await this.client.get('/api/karma/rules');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // FILE METHODS
  // ============================================================================

  /**
   * Upload file
   */
  async uploadFile(file: File | FormData, options?: any): Promise<any> {
    try {
      const formData = file instanceof FormData ? file : new FormData();
      if (file instanceof File) {
        formData.append('file', file);
      }
      
      const res = await this.client.post('/api/files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        ...options
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file by ID
   */
  async getFile(fileId: string): Promise<any> {
    try {
      const res = await this.client.get(`/api/files/${fileId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileId: string): Promise<any> {
    try {
      const res = await this.client.delete(`/api/files/${fileId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file download URL
   */
  getFileDownloadUrl(fileId: string): string {
    return `${OXY_CLOUD_URL}/files/${fileId}/download`;
  }

  /**
   * Get file stream URL
   */
  getFileStreamUrl(fileId: string): string {
    return `${OXY_CLOUD_URL}/files/${fileId}/stream`;
  }

  /**
   * List user files
   */
  async listUserFiles(
    userId: string,
    limit?: number,
    offset?: number,
    filters?: Record<string, any>
  ): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          params.append(key, value.toString());
        });
      }
      
      const res = await this.client.get(`/api/files/list/${userId}?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Download file content
   */
  async downloadFileContent(fileId: string): Promise<Response> {
    try {
      const res = await this.client.get(`/api/files/${fileId}`, {
        responseType: 'blob'
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file content as text
   */
  async getFileContentAsText(fileId: string): Promise<string> {
    try {
      const res = await this.client.get(`/api/files/${fileId}`, {
        headers: {
          'Accept': 'text/plain'
        }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file content as blob
   */
  async getFileContentAsBlob(fileId: string): Promise<Blob> {
    try {
      const res = await this.client.get(`/api/files/${fileId}`, {
        responseType: 'blob'
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // LOCATION METHODS
  // ============================================================================

  /**
   * Update user location
   */
  async updateLocation(latitude: number, longitude: number): Promise<any> {
    try {
      const res = await this.client.post('/api/location', {
        latitude,
        longitude
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get nearby users
   */
  async getNearbyUsers(radius?: number): Promise<any[]> {
    try {
      const params = radius ? `?radius=${radius}` : '';
      const res = await this.client.get(`/api/location/nearby${params}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // ANALYTICS METHODS
  // ============================================================================

  /**
   * Track event
   */
  async trackEvent(eventName: string, properties?: Record<string, any>): Promise<void> {
    try {
      await this.client.post('/api/analytics/events', {
        event: eventName,
        properties
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get analytics data
   */
  async getAnalytics(startDate?: string, endDate?: string): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const res = await this.client.get(`/api/analytics?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // DEVICE METHODS
  // ============================================================================

  /**
   * Register device
   */
  async registerDevice(deviceData: any): Promise<any> {
    try {
      const res = await this.client.post('/api/devices', deviceData);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user devices
   */
  async getUserDevices(): Promise<any[]> {
    try {
      const res = await this.client.get('/api/devices');
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Remove device
   */
  async removeDevice(deviceId: string): Promise<void> {
    try {
      await this.client.delete(`/api/devices/${deviceId}`);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get device sessions
   */
  async getDeviceSessions(sessionId: string): Promise<any[]> {
    try {
      const res = await this.client.get(`/api/devices/sessions/${sessionId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout all device sessions
   */
  async logoutAllDeviceSessions(sessionId: string, deviceId?: string, excludeCurrent?: boolean): Promise<any> {
    try {
      const params = new URLSearchParams();
      if (deviceId) params.append('deviceId', deviceId);
      if (excludeCurrent) params.append('excludeCurrent', 'true');
      
      const res = await this.client.post(`/api/devices/logout-all/${sessionId}?${params.toString()}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update device name
   */
  async updateDeviceName(sessionId: string, deviceName: string): Promise<any> {
    try {
      const res = await this.client.put(`/api/devices/name/${sessionId}`, { deviceName });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Fetch link metadata
   */
  async fetchLinkMetadata(url: string): Promise<{
    url: string;
    title: string;
    description: string;
    image?: string;
  }> {
    try {
      const res = await this.client.get(`/api/link-metadata?url=${encodeURIComponent(url)}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Simple Express.js authentication middleware
   * 
   * Built-in authentication middleware that validates JWT tokens and adds user data to requests.
   * 
   * @example
   * ```typescript
   * // Basic usage - just add it to your routes
   * app.use('/api/protected', oxyServices.auth());
   * 
   * // With debug logging
   * app.use('/api/protected', oxyServices.auth({ debug: true }));
   * 
   * // With custom error handling
   * app.use('/api/protected', oxyServices.auth({
   *   onError: (error) => console.error('Auth failed:', error)
   * }));
   * 
   * // Load full user data
   * app.use('/api/protected', oxyServices.auth({ loadUser: true }));
   * ```
   * 
   * @param options Optional configuration
   * @param options.debug Enable debug logging (default: false)
   * @param options.onError Custom error handler
   * @param options.loadUser Load full user data (default: false for performance)
   * @param options.session Use session-based validation (default: false)
   * @returns Express middleware function
   */
  auth(options: {
    debug?: boolean;
    onError?: (error: ApiError) => any;
    loadUser?: boolean;
    session?: boolean;
  } = {}) {
    const { debug = false, onError, loadUser = false, session = false } = options;
    
    // Return a synchronous middleware function
    return (req: any, res: any, next: any) => {
      try {
        // Extract token from Authorization header
        const authHeader = req.headers['authorization'];
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
        
        if (debug) {
          console.log(`🔐 Auth: Processing ${req.method} ${req.path}`);
          console.log(`🔐 Auth: Token present: ${!!token}`);
        }
        
        if (!token) {
          const error = {
            message: 'Access token required',
            code: 'MISSING_TOKEN',
            status: 401
          };
          
          if (debug) console.log(`❌ Auth: Missing token`);
          
          if (onError) return onError(error);
          return res.status(401).json(error);
        }
        
        // Decode and validate token
        let decoded: JwtPayload;
        try {
          decoded = jwtDecode<JwtPayload>(token);
          
          if (debug) {
            console.log(`🔐 Auth: Token decoded, User ID: ${decoded.userId || decoded.id}`);
          }
        } catch (decodeError) {
          const error = {
            message: 'Invalid token format',
            code: 'INVALID_TOKEN_FORMAT',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth: Token decode failed`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        const userId = decoded.userId || decoded.id;
        if (!userId) {
          const error = {
            message: 'Token missing user ID',
            code: 'INVALID_TOKEN_PAYLOAD',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth: Token missing user ID`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        // Check token expiration
        if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
          const error = {
            message: 'Token expired',
            code: 'TOKEN_EXPIRED',
            status: 403
          };
          
          if (debug) console.log(`❌ Auth: Token expired`);
          
          if (onError) return onError(error);
          return res.status(403).json(error);
        }
        
        // For now, skip session validation to keep it simple
        // Session validation can be added later if needed
        
        // Set request properties immediately
        req.userId = userId;
        req.accessToken = token;
        req.user = { id: userId } as User;
        
        if (debug) {
          console.log(`✅ Auth: Authentication successful for user ${userId}`);
        }
        
        next();
      } catch (error) {
        const apiError = this.handleError(error);
        
        if (debug) {
          console.log(`❌ Auth: Unexpected error:`, apiError);
        }
        
        if (onError) return onError(apiError);
        return res.status(apiError.status || 500).json(apiError);
      }
    };
  }
}

// Export the cloud URL constant
export const OXY_CLOUD_URL = 'https://cloud.oxyhq.com';