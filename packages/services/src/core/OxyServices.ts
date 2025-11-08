/**
 * OxyServices - Unified client for Oxy API and Oxy Cloud
 *
 * # Usage Examples
 *
 * ## Browser (ESM/TypeScript)
 *
 * ```typescript
 * import { OxyServices } from './core/OxyServices';
 *
 * const oxy = new OxyServices({
 *   baseURL: 'https://api.oxy.so',
 *   cloudURL: 'https://cloud.oxy.so',
 * });
 *
 * // Authenticate and fetch user
 * await oxy.setTokens('ACCESS_TOKEN');
 * const user = await oxy.getCurrentUser();
 *
 * // Upload a file (browser File API)
 * const fileInput = document.querySelector('input[type=file]');
 * const file = fileInput.files[0];
 * await oxy.uploadFile(file);
 *
 * // Get a file stream URL for <img src>
 * const url = oxy.getFileStreamUrl('fileId');
 * ```
 *
 * ## Node.js (CommonJS/TypeScript)
 *
 * ```typescript
 * import { OxyServices } from './core/OxyServices';
 * import fs from 'fs';
 *
 * const oxy = new OxyServices({
 *   baseURL: 'https://api.oxy.so',
 *   cloudURL: 'https://cloud.oxy.so',
 * });
 *
 * // Authenticate and fetch user
 * await oxy.setTokens('ACCESS_TOKEN');
 * const user = await oxy.getCurrentUser();
 *
 * // Upload a file (Node.js Buffer)
 * const buffer = fs.readFileSync('myfile.png');
 * const blob = new Blob([buffer]);
 * await oxy.uploadRawFile(blob, { filename: 'myfile.png' });
 *
 * // Get a file download URL
 * const url = oxy.getFileDownloadUrl('fileId');
 * ```
 *
 * ## Configuration
 * - `baseURL`: Oxy API endpoint (e.g., https://api.oxy.so)
 * - `cloudURL`: Oxy Cloud/CDN endpoint (e.g., https://cloud.oxy.so)
 *
 * See method JSDoc for more details and options.
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';
import type { 
  OxyConfig as OxyConfigBase, 
  ApiError, 
  User, 
  Notification, 
  AssetInitResponse, 
  AssetUrlResponse, 
  AssetVariant 
} from '../models/interfaces';
/**
 * OxyConfig - Configuration for OxyServices
 * @property baseURL - The Oxy API base URL (e.g., https://api.oxy.so)
 * @property cloudURL - The Oxy Cloud (file storage/CDN) URL (e.g., https://cloud.oxy.so)
 */
export interface OxyConfig extends OxyConfigBase {
  cloudURL?: string;
}
import type { SessionLoginResponse } from '../models/session';
import { handleHttpError } from '../utils/errorUtils';
import { buildSearchParams, buildPaginationParams, type PaginationParams } from '../utils/apiUtils';

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

  constructor(message: string, code = 'AUTH_ERROR', status = 401) {
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

  setTokens(accessToken: string, refreshToken = ''): void {
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
  private cloudURL: string;

  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   */
  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   *   config.baseURL: Oxy API URL (e.g., https://api.oxy.so)
   *   config.cloudURL: Oxy Cloud URL (e.g., https://cloud.oxy.so)
   */
  constructor(config: OxyConfig) {
    this.client = axios.create({ 
      baseURL: config.baseURL,
      timeout: 5000 // 5 second timeout
    });
    this.cloudURL = config.cloudURL || OXY_CLOUD_URL;
    this.tokenStore = TokenStore.getInstance();
    this.setupInterceptors();
  }

  // Test-only utility to reset global tokens between jest tests
  static __resetTokensForTests(): void {
    try {
      TokenStore.getInstance().clearTokens();
    } catch {}
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
   * Get the configured Oxy API base URL
   */
  public getBaseURL(): string {
    return this.client.defaults.baseURL || '';
  }

  /**
   * Get the configured Oxy Cloud (file storage/CDN) URL
   */
  public getCloudURL(): string {
    return this.cloudURL;
  }

  /**
   * Set authentication tokens
   */
  public setTokens(accessToken: string, refreshToken = ''): void {
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
   * Get the raw access token (for constructing anchor URLs when needed)
   */
  public getAccessToken(): string | null {
    return this.tokenStore.getAccessToken();
  }

  /**
   * Wait for authentication to be ready (public method)
   * Useful for apps that want to ensure authentication is complete before proceeding
   */
  public async waitForAuth(timeoutMs = 5000): Promise<boolean> {
    return this.waitForAuthentication(timeoutMs);
  }

  /**
   * Wait for authentication to be ready with timeout
   */
  private async waitForAuthentication(timeoutMs = 5000): Promise<boolean> {
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
  protected handleError(error: any): Error {
    const api = handleHttpError(error);
    const err = new Error(api.message) as Error & { code?: string; status?: number; details?: Record<string, unknown> };
    err.code = api.code;
    err.status = api.status;
    err.details = api.details as any;
    return err;
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
      if (!res || !res.data || (typeof res.data === 'object' && Object.keys(res.data).length === 0)) {
        throw new OxyAuthenticationError('Sign up failed', 'SIGNUP_FAILED', 400);
      }
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Request account recovery (send verification code)
   */
  async requestRecovery(identifier: string): Promise<{ delivery?: string; destination?: string }> {
    try {
      const res = await this.client.post('/api/auth/recover/request', { identifier });
      return res.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Verify recovery code
   */
  async verifyRecoveryCode(identifier: string, code: string): Promise<{ verified: boolean }> {
    try {
      const res = await this.client.post('/api/auth/recover/verify', { identifier, code });
      return res.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Reset password using verified code
   */
  async resetPassword(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
    try {
      const res = await this.client.post('/api/auth/recover/reset', { identifier, code, newPassword });
      return res.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Reset password using TOTP code (recommended recovery)
   */
  async resetPasswordWithTotp(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
    try {
      const res = await this.client.post('/api/auth/recover/totp/reset', { identifier, code, newPassword });
      return res.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async resetPasswordWithBackupCode(identifier: string, backupCode: string, newPassword: string): Promise<{ success: boolean }> {
    try {
      const res = await this.client.post('/api/auth/recover/backup/reset', { identifier, backupCode, newPassword });
      return res.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async resetPasswordWithRecoveryKey(identifier: string, recoveryKey: string, newPassword: string): Promise<{ success: boolean; nextRecoveryKey?: string }> {
    try {
      const res = await this.client.post('/api/auth/recover/recovery-key/reset', { identifier, recoveryKey, newPassword });
      return res.data;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Sign in with device management
   */
  async signIn(
    username: string,
    password: string,
    deviceName?: string,
    deviceFingerprint?: any
  ): Promise<SessionLoginResponse | { mfaRequired: true; mfaToken: string; expiresAt: string }> {
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
   * Complete login by verifying TOTP with MFA token
   */
  async verifyTotpLogin(mfaToken: string, code: string): Promise<SessionLoginResponse> {
    try {
      const res = await this.client.post('/api/auth/totp/verify-login', { mfaToken, code });
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

  // ============================================================================
  // TOTP ENROLLMENT
  // ============================================================================

  async startTotpEnrollment(sessionId: string): Promise<{ secret: string; otpauthUrl: string; issuer: string; label: string }> {
    try {
      const res = await this.client.post('/api/auth/totp/enroll/start', { sessionId }, {
        headers: { 'x-session-id': sessionId }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async verifyTotpEnrollment(sessionId: string, code: string): Promise<{ enabled: boolean; backupCodes?: string[]; recoveryKey?: string }> {
    try {
      const res = await this.client.post('/api/auth/totp/enroll/verify', { sessionId, code }, {
        headers: { 'x-session-id': sessionId }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async disableTotp(sessionId: string, code: string): Promise<{ disabled: boolean }> {
    try {
      const res = await this.client.post('/api/auth/totp/disable', { sessionId, code }, {
        headers: { 'x-session-id': sessionId }
      });
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
  // FILE METHODS (LEGACY - Using Asset Service)
  // ============================================================================

  /**
   * Delete file
   */
  async deleteFile(fileId: string): Promise<any> {
    try {
      // Central Asset Service delete with force=true behavior controlled by caller via assetDelete
      const res = await this.client.delete(`/api/assets/${encodeURIComponent(fileId)}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file download URL (API streaming proxy, attaches token for <img src>)
   */
  getFileDownloadUrl(fileId: string, variant?: string, expiresIn?: number): string {
  const base = this.getBaseURL();
  const params = new URLSearchParams();
  if (variant) params.set('variant', variant);
  if (expiresIn) params.set('expiresIn', String(expiresIn));
  params.set('fallback', 'placeholderVisible');
  const token = this.tokenStore.getAccessToken();
  if (token) params.set('token', token);

  // Use params.toString() to detect whether there are query params.
  // URLSearchParams.size is not a standard property across all JS runtimes
  // (some environments like React Native may not implement it), which
  // caused the query string to be omitted on native. Checking the
  // serialized string is reliable everywhere.
  const qs = params.toString();
  return `${base}/api/assets/${encodeURIComponent(fileId)}/stream${qs ? `?${qs}` : ''}`;
  }

  /**
   * Get file stream URL (direct Oxy Cloud/CDN URL, no token)
   */
  getFileStreamUrl(fileId: string): string {
    return `${this.getCloudURL()}/files/${fileId}/stream`;
  }

  // ...existing code...

  /**
   * List user files
   */
  async listUserFiles(limit?: number, offset?: number): Promise<{ files: any[]; total: number; hasMore: boolean }> {
    try {
      const params = new URLSearchParams();
      if (limit) params.append('limit', String(limit));
      if (offset) params.append('offset', String(offset));
  const qs = params.toString();
  const res = await this.client.get(`/api/assets${qs ? `?${qs}` : ''}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // (removed legacy downloadFileContent; use getFileContentAsBlob/Text which resolve CAS URL first)

  /**
   * Get file content as text
   */
  async getFileContentAsText(fileId: string, variant?: string): Promise<string> {
    try {
      const urlRes = await this.client.get(`/api/assets/${encodeURIComponent(fileId)}/url${variant ? `?variant=${encodeURIComponent(variant)}` : ''}`);
      const downloadUrl = urlRes.data?.url;
      const response = await fetch(downloadUrl);
      return await response.text();
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get file content as blob
   */
  async getFileContentAsBlob(fileId: string, variant?: string): Promise<Blob> {
    try {
      const urlRes = await this.client.get(`/api/assets/${encodeURIComponent(fileId)}/url${variant ? `?variant=${encodeURIComponent(variant)}` : ''}`);
      const downloadUrl = urlRes.data?.url;
      const response = await fetch(downloadUrl);
      return await response.blob();
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Upload raw file data
   */
  async uploadRawFile(file: File | Blob, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>): Promise<any> {
    // Switch to Central Asset Service upload flow
    return this.assetUpload(file as File, visibility, metadata);
  }

  // ============================================================================
  // CENTRAL ASSET SERVICE METHODS
  // ============================================================================

  /**
   * Calculate SHA256 hash of file content
   */
  async calculateSHA256(file: File | Blob): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Initialize asset upload - returns pre-signed URL and file ID
   */
  async assetInit(sha256: string, size: number, mime: string): Promise<AssetInitResponse> {
    try {
      const res = await this.client.post('/api/assets/init', {
        sha256,
        size,
        mime
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Complete asset upload - commit metadata and trigger variant generation
   */
  async assetComplete(fileId: string, originalName: string, size: number, mime: string, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>): Promise<any> {
    try {
      const res = await this.client.post('/api/assets/complete', {
        fileId,
        originalName,
        size,
        mime,
        visibility,
        metadata
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Upload file using Central Asset Service
   */
  async assetUpload(file: File, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>, onProgress?: (progress: number) => void): Promise<any> {
    try {
      // Calculate SHA256
      const sha256 = await this.calculateSHA256(file);
      
      // Initialize upload
      const initResponse = await this.assetInit(sha256, file.size, file.type);

      // Try presigned URL first
      try {
        await this.uploadToPresignedUrl(initResponse.uploadUrl, file, onProgress);
      } catch (e) {
        // Fallback: direct upload via API to avoid CORS issues
        const fd = new FormData();
        fd.append('file', file);
        await this.client.post(`/api/assets/${encodeURIComponent(initResponse.fileId)}/upload-direct`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }

      // Complete upload
      return await this.assetComplete(
        initResponse.fileId,
        file.name,
        file.size,
        file.type,
        visibility,
        metadata
      );
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Upload file to pre-signed URL
   */
  private async uploadToPresignedUrl(url: string, file: File, onProgress?: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = (event.loaded / event.total) * 100;
          onProgress(progress);
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });
      
      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });
      
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    });
  }

  /**
   * Link asset to an entity
   */
  async assetLink(fileId: string, app: string, entityType: string, entityId: string, visibility?: 'private' | 'public' | 'unlisted', webhookUrl?: string): Promise<any> {
    try {
      const body: any = { app, entityType, entityId };
      if (visibility) body.visibility = visibility;
      if (webhookUrl) body.webhookUrl = webhookUrl;
      const res = await this.client.post(`/api/assets/${fileId}/links`, body);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unlink asset from an entity
   */
  async assetUnlink(fileId: string, app: string, entityType: string, entityId: string): Promise<any> {
    try {
      const res = await this.client.delete(`/api/assets/${fileId}/links`, {
        data: {
          app,
          entityType,
          entityId
        }
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get asset metadata
   */
  async assetGet(fileId: string): Promise<any> {
    try {
      const res = await this.client.get(`/api/assets/${fileId}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get asset URL (CDN or signed URL)
   */
  async assetGetUrl(fileId: string, variant?: string, expiresIn?: number): Promise<AssetUrlResponse> {
    try {
      const params = new URLSearchParams();
      if (variant) params.set('variant', variant);
      if (expiresIn) params.set('expiresIn', expiresIn.toString());
      
      const queryString = params.toString();
      const url = `/api/assets/${fileId}/url${queryString ? `?${queryString}` : ''}`;
      
      const res = await this.client.get(url);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Restore asset from trash
   */
  async assetRestore(fileId: string): Promise<any> {
    try {
      const res = await this.client.post(`/api/assets/${fileId}/restore`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete asset with optional force
   */
  async assetDelete(fileId: string, force: boolean = false): Promise<any> {
    try {
      const params = force ? '?force=true' : '';
      const res = await this.client.delete(`/api/assets/${fileId}${params}`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get list of available variants for an asset
   */
  async assetGetVariants(fileId: string): Promise<AssetVariant[]> {
    try {
      const assetData = await this.assetGet(fileId);
      return assetData.file?.variants || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update asset visibility
   * @param fileId - The file ID
   * @param visibility - New visibility level ('private', 'public', or 'unlisted')
   * @returns Updated asset information
   */
  async assetUpdateVisibility(fileId: string, visibility: 'private' | 'public' | 'unlisted'): Promise<any> {
    try {
      const res = await this.client.patch(`/api/assets/${fileId}/visibility`, {
        visibility
      });
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Helper: Upload and link avatar with automatic public visibility
   * @param file - The avatar file
   * @param userId - User ID to link to
   * @param app - App name (defaults to 'profiles')
   * @returns The uploaded and linked asset
   */
  async uploadAvatar(file: File, userId: string, app: string = 'profiles'): Promise<any> {
    try {
      // Upload as public
      const asset = await this.assetUpload(file, 'public');
      
      // Link to user profile as avatar
      await this.assetLink(asset.file.id, app, 'avatar', userId, 'public');
      
      return asset;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Helper: Upload and link profile banner with automatic public visibility
   * @param file - The banner file
   * @param userId - User ID to link to
   * @param app - App name (defaults to 'profiles')
   * @returns The uploaded and linked asset
   */
  async uploadProfileBanner(file: File, userId: string, app: string = 'profiles'): Promise<any> {
    try {
      // Upload as public
      const asset = await this.assetUpload(file, 'public');
      
      // Link to user profile as banner
      await this.assetLink(asset.file.id, app, 'profile-banner', userId, 'public');
      
      return asset;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // DEVELOPER API METHODS
  // ============================================================================

  /**
   * Get developer apps for the current user
   */
  async getDeveloperApps(): Promise<any[]> {
    try {
      const res = await this.client.get('/api/developer/apps');
      return res.data.apps || [];
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create a new developer app
   */
  async createDeveloperApp(data: {
    name: string;
    description?: string;
    webhookUrl: string;
    devWebhookUrl?: string;
    scopes?: string[];
  }): Promise<any> {
    try {
      const res = await this.client.post('/api/developer/apps', data);
      return res.data.app;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a specific developer app
   */
  async getDeveloperApp(appId: string): Promise<any> {
    try {
      const res = await this.client.get(`/api/developer/apps/${appId}`);
      return res.data.app;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update a developer app
   */
  async updateDeveloperApp(appId: string, data: {
    name?: string;
    description?: string;
    webhookUrl?: string;
    devWebhookUrl?: string;
    scopes?: string[];
  }): Promise<any> {
    try {
      const res = await this.client.patch(`/api/developer/apps/${appId}`, data);
      return res.data.app;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Regenerate API secret for a developer app
   */
  async regenerateDeveloperAppSecret(appId: string): Promise<any> {
    try {
      const res = await this.client.post(`/api/developer/apps/${appId}/regenerate-secret`);
      return res.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a developer app
   */
  async deleteDeveloperApp(appId: string): Promise<any> {
    try {
      const res = await this.client.delete(`/api/developer/apps/${appId}`);
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
        const apiError = this.handleError(error) as any;
        
        if (debug) {
          console.log(`❌ Auth: Unexpected error:`, apiError);
        }
        
        if (onError) return onError(apiError);
        return res.status((apiError && apiError.status) || 500).json(apiError);
      }
    };
  }
}

/**
 * Export the default Oxy Cloud URL (for backward compatibility)
 */
export const OXY_CLOUD_URL = 'https://cloud.oxy.so';

/**
 * Export the default Oxy API URL (for documentation)
 */
export const OXY_API_URL = (typeof process !== 'undefined' && process.env && process.env.OXY_API_URL) || 'https://api.oxy.so';

/**
 * Pre-configured client instance for easy import
 * Uses OXY_API_URL as baseURL and OXY_CLOUD_URL as cloudURL
 */
export const oxyClient = new OxyServices({ baseURL: OXY_API_URL, cloudURL: OXY_CLOUD_URL });
