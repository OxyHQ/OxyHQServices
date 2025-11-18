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
import { normalizeLanguageCode, getLanguageMetadata, getLanguageName, getNativeLanguageName } from '../utils/languageUtils';
import type { LanguageMetadata } from '../utils/languageUtils';
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
import { HttpClient } from './HttpClient';
import { RequestManager, type RequestOptions } from './RequestManager';

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
 * Architecture:
 * - HttpClient: Handles HTTP communication and authentication
 * - RequestManager: Handles caching, deduplication, queuing, and retry
 * - OxyServices: Provides high-level API methods
 */
export class OxyServices {
  private httpClient: HttpClient;
  private requestManager: RequestManager;
  private cloudURL: string;
  private config: OxyConfig;
  

  /**
   * Creates a new instance of the OxyServices client
   * @param config - Configuration for the client
   *   config.baseURL: Oxy API URL (e.g., https://api.oxy.so)
   *   config.cloudURL: Oxy Cloud URL (e.g., https://cloud.oxy.so)
   */
  constructor(config: OxyConfig) {
    this.config = config;
    this.cloudURL = config.cloudURL || OXY_CLOUD_URL;

    // Initialize HTTP client (handles authentication and interceptors)
    this.httpClient = new HttpClient(config);

    // Initialize request manager (handles caching, deduplication, queuing, retry)
    this.requestManager = new RequestManager(this.httpClient, config);
  }

  // Test-only utility to reset global tokens between jest tests
  static __resetTokensForTests(): void {
    HttpClient.__resetTokensForTests();
  }


  /**
   * Make a request with all performance optimizations
   * This is the main method for all API calls - ensures authentication and performance features
   */
  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.requestManager.request<T>(method, url, data, options);
  }

  // ============================================================================
  // CORE METHODS (HTTP Client, Token Management, Error Handling)
  // ============================================================================

  /**
   * Get the configured Oxy API base URL
   */
  public getBaseURL(): string {
    return this.httpClient.getBaseURL();
  }

  /**
   * Get the HTTP client instance
   * Useful for advanced use cases where direct access to the HTTP client is needed
   */
  public getClient(): HttpClient {
    return this.httpClient;
  }

  /**
   * Get performance metrics
   */
  public getMetrics() {
    return this.requestManager.getMetrics();
  }

  /**
   * Clear request cache
   */
  public clearCache(): void {
    this.requestManager.clearCache();
  }

  /**
   * Clear specific cache entry
   */
  public clearCacheEntry(key: string): void {
    this.requestManager.clearCacheEntry(key);
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return this.requestManager.getCacheStats();
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
    this.httpClient.setTokens(accessToken, refreshToken);
  }

  /**
   * Clear stored authentication tokens
   */
  public clearTokens(): void {
    this.httpClient.clearTokens();
  }

  /**
   * Get the current user ID from the access token
   */
  public getCurrentUserId(): string | null {
    const accessToken = this.httpClient.getAccessToken();
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
    return this.httpClient.hasAccessToken();
  }

  /**
   * Check if the client has a valid access token (public method)
   */
  public hasValidToken(): boolean {
    return this.httpClient.hasAccessToken();
  }

  /**
   * Get the raw access token (for constructing anchor URLs when needed)
   */
  public getAccessToken(): string | null {
    return this.httpClient.getAccessToken();
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
      if (this.httpClient.hasAccessToken()) {
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
        if (!this.httpClient.hasAccessToken()) {
          if (attempt === 0) {
            // On first attempt, wait briefly for authentication to complete
            const authReady = await this.waitForAuthentication(authTimeoutMs);
            
            if (!authReady) {
              throw new OxyAuthenticationTimeoutError(operationName, authTimeoutMs);
            }
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
      const res = await this.makeRequest<{ valid: boolean }>('GET', '/api/auth/validate', undefined, {
        cache: false,
        retry: false,
      });
      return res.valid === true;
    } catch (error) {
      return false;
    }
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
      return await this.makeRequest('GET', '/health', undefined, { cache: false });
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
      const res = await this.makeRequest<{ message: string; token: string; user: User }>('POST', '/api/auth/signup', {
        username,
        email,
        password
      }, { cache: false });
      if (!res || (typeof res === 'object' && Object.keys(res).length === 0)) {
        throw new OxyAuthenticationError('Sign up failed', 'SIGNUP_FAILED', 400);
      }
      return res;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Request account recovery (send verification code)
   */
  async requestRecovery(identifier: string): Promise<{ delivery?: string; destination?: string }> {
    try {
      return await this.makeRequest('POST', '/api/auth/recover/request', { identifier }, { cache: false });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Verify recovery code
   */
  async verifyRecoveryCode(identifier: string, code: string): Promise<{ verified: boolean }> {
    try {
      return await this.makeRequest('POST', '/api/auth/recover/verify', { identifier, code }, { cache: false });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Reset password using verified code
   */
  async resetPassword(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
    try {
      return await this.makeRequest('POST', '/api/auth/recover/reset', { identifier, code, newPassword }, { cache: false });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Reset password using TOTP code (recommended recovery)
   */
  async resetPasswordWithTotp(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
    try {
      return await this.makeRequest('POST', '/api/auth/recover/totp/reset', { identifier, code, newPassword }, { cache: false });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async resetPasswordWithBackupCode(identifier: string, backupCode: string, newPassword: string): Promise<{ success: boolean }> {
    try {
      return await this.makeRequest('POST', '/api/auth/recover/backup/reset', { identifier, backupCode, newPassword }, { cache: false });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async resetPasswordWithRecoveryKey(identifier: string, recoveryKey: string, newPassword: string): Promise<{ success: boolean; nextRecoveryKey?: string }> {
    try {
      return await this.makeRequest('POST', '/api/auth/recover/recovery-key/reset', { identifier, recoveryKey, newPassword }, { cache: false });
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
      return await this.makeRequest<SessionLoginResponse | { mfaRequired: true; mfaToken: string; expiresAt: string }>('POST', '/api/auth/login', {
        username,
        password,
        deviceName,
        deviceFingerprint
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Complete login by verifying TOTP with MFA token
   */
  async verifyTotpLogin(mfaToken: string, code: string): Promise<SessionLoginResponse> {
    try {
      return await this.makeRequest<SessionLoginResponse>('POST', '/api/auth/totp/verify-login', { mfaToken, code }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user by session ID
   */
  async getUserBySession(sessionId: string): Promise<User> {
    try {
      return await this.makeRequest<User>('GET', `/api/session/user/${sessionId}`, undefined, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache for user data
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Batch get multiple user profiles by session IDs (optimized for account switching)
   * Returns array of { sessionId, user } objects
   */
  async getUsersBySessions(sessionIds: string[]): Promise<Array<{ sessionId: string; user: User | null }>> {
    try {
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return [];
      }
      
      // Deduplicate and sort sessionIds for consistent cache keys
      const uniqueSessionIds = Array.from(new Set(sessionIds)).sort();
      
      return await this.makeRequest<Array<{ sessionId: string; user: User | null }>>(
        'POST',
        '/api/session/users/batch',
        { sessionIds: uniqueSessionIds },
        {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache
          deduplicate: true, // Important for batch requests
        }
      );
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get access token by session ID and set it in the token store
   */
  async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
    try {
      const res = await this.makeRequest<{ accessToken: string; expiresAt: string }>('GET', `/api/session/token/${sessionId}`, undefined, {
        cache: false,
        retry: false,
      });
      
      // Set the token in the centralized token store
      this.setTokens(res.accessToken);
      
      return res;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get sessions by session ID
   */
  async getSessionsBySessionId(sessionId: string): Promise<any[]> {
    try {
      return await this.makeRequest('GET', `/api/session/sessions/${sessionId}`, undefined, {
        cache: false,
      });
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
      
      await this.makeRequest('POST', url, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Logout from all sessions
   */
  async logoutAllSessions(sessionId: string): Promise<void> {
    try {
      await this.makeRequest('POST', `/api/session/logout-all/${sessionId}`, undefined, { cache: false });
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

      const url = `/api/session/validate/${sessionId}`;
      const urlParams: any = {};
      if (options.deviceFingerprint) urlParams.deviceFingerprint = options.deviceFingerprint;
      if (options.useHeaderValidation) urlParams.useHeaderValidation = 'true';
      return await this.makeRequest('GET', url, urlParams, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Check username availability
   */
  async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
    try {
      return await this.makeRequest('GET', `/api/auth/check-username/${username}`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Check email availability
   */
  async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
    try {
      return await this.makeRequest('GET', `/api/auth/check-email/${email}`, undefined, { cache: false });
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
      return await this.makeRequest<User>('GET', `/api/profiles/username/${username}`, undefined, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache for profiles
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // TOTP ENROLLMENT
  // ============================================================================

  async startTotpEnrollment(sessionId: string): Promise<{ secret: string; otpauthUrl: string; issuer: string; label: string }> {
    try {
      // Note: x-session-id header is handled by HttpClient interceptors if needed
      return await this.makeRequest('POST', '/api/auth/totp/enroll/start', { sessionId }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async verifyTotpEnrollment(sessionId: string, code: string): Promise<{ enabled: boolean; backupCodes?: string[]; recoveryKey?: string }> {
    try {
      return await this.makeRequest('POST', '/api/auth/totp/enroll/verify', { sessionId, code }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async disableTotp(sessionId: string, code: string): Promise<{ disabled: boolean }> {
    try {
      return await this.makeRequest('POST', '/api/auth/totp/disable', { sessionId, code }, { cache: false });
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
      const paramsObj: any = {};
      searchParams.forEach((value, key) => {
        paramsObj[key] = value;
      });
      return await this.makeRequest<User[]>('GET', '/api/profiles/search', paramsObj, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
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
      return await this.makeRequest('GET', '/api/profiles/recommendations', undefined, { cache: true });
    }, 'getProfileRecommendations');
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User> {
    try {
      return await this.makeRequest<User>('GET', `/api/users/${userId}`, undefined, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<User> {
    return this.withAuthRetry(async () => {
      return await this.makeRequest<User>('GET', '/api/users/me', undefined, {
        cache: true,
        cacheTTL: 1 * 60 * 1000, // 1 minute cache for current user
      });
    }, 'getCurrentUser');
  }

  /**
   * Update user profile
   */
  async updateProfile(updates: Record<string, any>): Promise<User> {
    try {
      return await this.makeRequest<User>('PUT', '/api/users/me', updates, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get privacy settings for a user
   * @param userId - The user ID (defaults to current user)
   */
  async getPrivacySettings(userId?: string): Promise<any> {
    try {
      const id = userId || (await this.getCurrentUser()).id;
      return await this.makeRequest<any>('GET', `/api/privacy/${id}/privacy`, undefined, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update privacy settings
   * @param settings - Partial privacy settings object
   * @param userId - The user ID (defaults to current user)
   */
  async updatePrivacySettings(settings: Record<string, any>, userId?: string): Promise<any> {
    try {
      const id = userId || (await this.getCurrentUser()).id;
      return await this.makeRequest<any>('PATCH', `/api/privacy/${id}/privacy`, settings, {
        cache: false,
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Request account verification
   */
  async requestAccountVerification(reason: string, evidence?: string): Promise<{ message: string; requestId: string }> {
    try {
      return await this.makeRequest<{ message: string; requestId: string }>('POST', '/api/users/verify/request', {
        reason,
        evidence,
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Download account data export
   */
  async downloadAccountData(format: 'json' | 'csv' = 'json'): Promise<Blob> {
    try {
      // Use axios instance directly for blob responses since RequestManager doesn't handle blobs
      const axiosInstance = this.httpClient.getAxiosInstance();
      
      const response = await axiosInstance.get(`/api/users/me/data?format=${format}`, {
        responseType: 'blob',
      });
      
      return response.data as Blob;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete account permanently
   * @param password - User password for confirmation
   * @param confirmText - Confirmation text (usually username)
   */
  async deleteAccount(password: string, confirmText: string): Promise<{ message: string }> {
    try {
      return await this.makeRequest<{ message: string }>('DELETE', '/api/users/me', {
        password,
        confirmText,
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // ============================================================================
  // LANGUAGE METHODS
  // ============================================================================

  /**
   * Get the current language from storage or user profile
   * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
   * @returns The current language code (e.g., 'en-US') or null if not set
   */
  async getCurrentLanguage(storageKeyPrefix: string = 'oxy_session'): Promise<string | null> {
    try {
      // First try to get from user profile if authenticated
      try {
        const user = await this.getCurrentUser();
        const userLanguage = (user as Record<string, unknown>)?.language as string | undefined;
        if (userLanguage) {
          return normalizeLanguageCode(userLanguage) || userLanguage;
        }
      } catch (e) {
        // User not authenticated or error, continue to storage
      }

      // Fall back to storage
      const storage = await this.getStorage();
      const storageKey = `${storageKeyPrefix}_language`;
      const storedLanguage = await storage.getItem(storageKey);
      if (storedLanguage) {
        return normalizeLanguageCode(storedLanguage) || storedLanguage;
      }

      return null;
    } catch (error) {
      if (__DEV__) {
        console.warn('Failed to get current language:', error);
      }
      return null;
    }
  }

  /**
   * Get the current language with metadata (name, nativeName, etc.)
   * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
   * @returns Language metadata object or null if not set
   */
  async getCurrentLanguageMetadata(storageKeyPrefix: string = 'oxy_session'): Promise<LanguageMetadata | null> {
    const languageCode = await this.getCurrentLanguage(storageKeyPrefix);
    return getLanguageMetadata(languageCode);
  }

  /**
   * Get the current language name (e.g., 'English')
   * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
   * @returns Language name or null if not set
   */
  async getCurrentLanguageName(storageKeyPrefix: string = 'oxy_session'): Promise<string | null> {
    const languageCode = await this.getCurrentLanguage(storageKeyPrefix);
    if (!languageCode) return null;
    return getLanguageName(languageCode);
  }

  /**
   * Get the current native language name (e.g., 'Español')
   * @param storageKeyPrefix - Optional prefix for storage key (default: 'oxy_session')
   * @returns Native language name or null if not set
   */
  async getCurrentNativeLanguageName(storageKeyPrefix: string = 'oxy_session'): Promise<string | null> {
    const languageCode = await this.getCurrentLanguage(storageKeyPrefix);
    if (!languageCode) return null;
    return getNativeLanguageName(languageCode);
  }

  /**
   * Get appropriate storage for the platform (similar to DeviceManager)
   * @private
   */
  private async getStorage(): Promise<{
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
  }> {
    const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
    
    if (isReactNative) {
      try {
        const asyncStorageModule = await import('@react-native-async-storage/async-storage');
        const storage = (asyncStorageModule.default as unknown) as import('@react-native-async-storage/async-storage').AsyncStorageStatic;
        return {
          getItem: storage.getItem.bind(storage),
          setItem: storage.setItem.bind(storage),
          removeItem: storage.removeItem.bind(storage),
        };
      } catch (error) {
        console.error('AsyncStorage not available in React Native:', error);
        throw new Error('AsyncStorage is required in React Native environment');
      }
    } else {
      // Use localStorage for web
      return {
        getItem: async (key: string) => {
          if (typeof window !== 'undefined' && window.localStorage) {
            return localStorage.getItem(key);
          }
          return null;
        },
        setItem: async (key: string, value: string) => {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem(key, value);
          }
        },
        removeItem: async (key: string) => {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.removeItem(key);
          }
        }
      };
    }
  }

  /**
   * Update user by ID (admin function)
   */
  async updateUser(userId: string, updates: Record<string, any>): Promise<User> {
    try {
      return await this.makeRequest<User>('PUT', `/api/users/${userId}`, updates, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Follow a user
   */
  async followUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      return await this.makeRequest('POST', `/api/users/${userId}/follow`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      return await this.makeRequest('DELETE', `/api/users/${userId}/follow`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get follow status
   */
  async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
    try {
      return await this.makeRequest('GET', `/api/users/${userId}/follow-status`, undefined, {
        cache: true,
        cacheTTL: 1 * 60 * 1000, // 1 minute cache
      });
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
      const response = await this.makeRequest<{ data: User[]; pagination: { total: number; hasMore: boolean } }>('GET', `/api/users/${userId}/followers`, params, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
      return {
        followers: response.data || [],
        total: response.pagination.total,
        hasMore: response.pagination.hasMore,
      };
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
      const response = await this.makeRequest<{ data: User[]; pagination: { total: number; hasMore: boolean } }>('GET', `/api/users/${userId}/following`, params, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
      return {
        following: response.data || [],
        total: response.pagination.total,
        hasMore: response.pagination.hasMore,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get notifications
   */
  async getNotifications(): Promise<Notification[]> {
    return this.withAuthRetry(async () => {
      return await this.makeRequest<Notification[]>('GET', '/api/notifications', undefined, {
        cache: false, // Don't cache notifications - always get fresh data
      });
    }, 'getNotifications');
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await this.makeRequest<{ count: number }>('GET', '/api/notifications/unread-count', undefined, {
        cache: false, // Don't cache unread count - always get fresh data
      });
      return res.count;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Create notification
   */
  async createNotification(data: Partial<Notification>): Promise<Notification> {
    try {
      return await this.makeRequest<Notification>('POST', '/api/notifications', data, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(notificationId: string): Promise<void> {
    try {
      await this.makeRequest('PUT', `/api/notifications/${notificationId}/read`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(): Promise<void> {
    try {
      await this.makeRequest('PUT', '/api/notifications/read-all', undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await this.makeRequest('DELETE', `/api/notifications/${notificationId}`, undefined, { cache: false });
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
      return await this.makeRequest('POST', '/api/payments', data, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<any> {
    try {
      return await this.makeRequest('GET', `/api/payments/${paymentId}`, undefined, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user payments
   */
  async getUserPayments(): Promise<any[]> {
    try {
      return await this.makeRequest('GET', '/api/payments/user', undefined, {
        cache: false, // Don't cache user payments - always get fresh data
      });
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
      return await this.makeRequest('GET', `/api/karma/${userId}`, undefined, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Give karma to user
   */
  async giveKarma(userId: string, amount: number, reason?: string): Promise<any> {
    try {
      return await this.makeRequest('POST', `/api/karma/${userId}/give`, {
        amount,
        reason
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user karma total
   */
  async getUserKarmaTotal(userId: string): Promise<any> {
    try {
      return await this.makeRequest('GET', `/api/karma/${userId}/total`, undefined, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user karma history
   */
  async getUserKarmaHistory(userId: string, limit?: number, offset?: number): Promise<any> {
    try {
      const params: any = {};
      if (limit) params.limit = limit;
      if (offset) params.offset = offset;
      
      return await this.makeRequest('GET', `/api/karma/${userId}/history`, params, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma leaderboard
   */
  async getKarmaLeaderboard(): Promise<any> {
    try {
      return await this.makeRequest('GET', '/api/karma/leaderboard', undefined, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get karma rules
   */
  async getKarmaRules(): Promise<any> {
    try {
      return await this.makeRequest('GET', '/api/karma/rules', undefined, {
        cache: true,
        cacheTTL: 30 * 60 * 1000, // 30 minutes cache (rules don't change often)
      });
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
      return await this.makeRequest('DELETE', `/api/assets/${encodeURIComponent(fileId)}`, undefined, { cache: false });
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
  const token = this.httpClient.getAccessToken();
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
      const paramsObj: any = {};
      if (limit) paramsObj.limit = limit;
      if (offset) paramsObj.offset = offset;
      return await this.makeRequest('GET', '/api/assets', paramsObj, {
        cache: false, // Don't cache file lists - always get fresh data
      });
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
      const params: any = variant ? { variant } : undefined;
      const urlRes = await this.makeRequest<{ url: string }>('GET', `/api/assets/${encodeURIComponent(fileId)}/url`, params, {
        cache: true,
        cacheTTL: 10 * 60 * 1000, // 10 minutes cache for URLs
      });
      const downloadUrl = urlRes?.url;
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
      const params: any = variant ? { variant } : undefined;
      const urlRes = await this.makeRequest<{ url: string }>('GET', `/api/assets/${encodeURIComponent(fileId)}/url`, params, {
        cache: true,
        cacheTTL: 10 * 60 * 1000, // 10 minutes cache for URLs
      });
      const downloadUrl = urlRes?.url;
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
      return await this.makeRequest<AssetInitResponse>('POST', '/api/assets/init', {
        sha256,
        size,
        mime
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Complete asset upload - commit metadata and trigger variant generation
   */
  async assetComplete(fileId: string, originalName: string, size: number, mime: string, visibility?: 'private' | 'public' | 'unlisted', metadata?: Record<string, any>): Promise<any> {
    try {
      return await this.makeRequest('POST', '/api/assets/complete', {
        fileId,
        originalName,
        size,
        mime,
        visibility,
        metadata
      }, { cache: false });
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
        // Use httpClient directly for FormData uploads (bypasses RequestManager for special handling)
        await this.httpClient.request({
          method: 'POST',
          url: `/api/assets/${encodeURIComponent(initResponse.fileId)}/upload-direct`,
          data: fd,
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
      return await this.makeRequest('POST', `/api/assets/${fileId}/links`, body, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Unlink asset from an entity
   */
  async assetUnlink(fileId: string, app: string, entityType: string, entityId: string): Promise<any> {
    try {
      return await this.makeRequest('DELETE', `/api/assets/${fileId}/links`, {
        app,
        entityType,
        entityId
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get asset metadata
   */
  async assetGet(fileId: string): Promise<any> {
    try {
      return await this.makeRequest('GET', `/api/assets/${fileId}`, undefined, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get asset URL (CDN or signed URL)
   */
  async assetGetUrl(fileId: string, variant?: string, expiresIn?: number): Promise<AssetUrlResponse> {
    try {
      const params: any = {};
      if (variant) params.variant = variant;
      if (expiresIn) params.expiresIn = expiresIn;
      
      return await this.makeRequest<AssetUrlResponse>('GET', `/api/assets/${fileId}/url`, params, {
        cache: true,
        cacheTTL: 10 * 60 * 1000, // 10 minutes cache for URLs
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Restore asset from trash
   */
  async assetRestore(fileId: string): Promise<any> {
    try {
      return await this.makeRequest('POST', `/api/assets/${fileId}/restore`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete asset with optional force
   */
  async assetDelete(fileId: string, force: boolean = false): Promise<any> {
    try {
      const params: any = force ? { force: 'true' } : undefined;
      return await this.makeRequest('DELETE', `/api/assets/${fileId}`, params, { cache: false });
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
      return await this.makeRequest('PATCH', `/api/assets/${fileId}/visibility`, {
        visibility
      }, { cache: false });
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
      const res = await this.makeRequest<{ apps?: any[] }>('GET', '/api/developer/apps', undefined, {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      });
      return res.apps || [];
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
      const res = await this.makeRequest<{ app: any }>('POST', '/api/developer/apps', data, { cache: false });
      return res.app;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get a specific developer app
   */
  async getDeveloperApp(appId: string): Promise<any> {
    try {
      const res = await this.makeRequest<{ app: any }>('GET', `/api/developer/apps/${appId}`, undefined, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      });
      return res.app;
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
      const res = await this.makeRequest<{ app: any }>('PATCH', `/api/developer/apps/${appId}`, data, { cache: false });
      return res.app;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Regenerate API secret for a developer app
   */
  async regenerateDeveloperAppSecret(appId: string): Promise<any> {
    try {
      return await this.makeRequest('POST', `/api/developer/apps/${appId}/regenerate-secret`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Delete a developer app
   */
  async deleteDeveloperApp(appId: string): Promise<any> {
    try {
      return await this.makeRequest('DELETE', `/api/developer/apps/${appId}`, undefined, { cache: false });
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
      return await this.makeRequest('POST', '/api/location', {
        latitude,
        longitude
      }, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get nearby users
   */
  async getNearbyUsers(radius?: number): Promise<any[]> {
    try {
      const params: any = radius ? { radius } : undefined;
      return await this.makeRequest('GET', '/api/location/nearby', params, {
        cache: false, // Don't cache location data - always get fresh data
      });
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
      await this.makeRequest('POST', '/api/analytics/events', {
        event: eventName,
        properties
      }, { cache: false, retry: false }); // Don't retry analytics events
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get analytics data
   */
  async getAnalytics(startDate?: string, endDate?: string): Promise<any> {
    try {
      const params: any = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      
      return await this.makeRequest('GET', '/api/analytics', params, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 minutes cache
      });
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
      return await this.makeRequest('POST', '/api/devices', deviceData, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get user devices
   */
  async getUserDevices(): Promise<any[]> {
    try {
      return await this.makeRequest('GET', '/api/devices', undefined, {
        cache: false, // Don't cache device list - always get fresh data
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Remove device
   */
  async removeDevice(deviceId: string): Promise<void> {
    try {
      await this.makeRequest('DELETE', `/api/devices/${deviceId}`, undefined, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get device sessions
   * Note: Not cached by default to ensure fresh data, but can be cached via makeRequest if needed
   */
  async getDeviceSessions(sessionId: string): Promise<any[]> {
    try {
      // Use makeRequest for consistent error handling and optional caching
      // Cache disabled by default to ensure fresh session data
      return await this.makeRequest<any[]>('GET', `/api/session/device/sessions/${sessionId}`, undefined, {
        cache: false, // Don't cache sessions - always get fresh data
        deduplicate: true, // Deduplicate concurrent requests for same sessionId
      });
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
      
      const urlParams: any = {};
      params.forEach((value, key) => {
        urlParams[key] = value;
      });
      return await this.makeRequest('POST', `/api/session/device/logout-all/${sessionId}`, urlParams, { cache: false });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Update device name
   */
  async updateDeviceName(sessionId: string, deviceName: string): Promise<any> {
    try {
      return await this.makeRequest('PUT', `/api/session/device/name/${sessionId}`, { deviceName }, { cache: false });
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
      return await this.makeRequest<{
        url: string;
        title: string;
        description: string;
        image?: string;
      }>('GET', '/api/link-metadata', { url }, {
        cache: true,
        cacheTTL: 30 * 60 * 1000, // 30 minutes cache for link metadata
      });
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
