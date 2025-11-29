/**
 * OxyServices Base Class
 * 
 * Contains core infrastructure, HTTP client, request management, and error handling
 */
import { jwtDecode } from 'jwt-decode';
import type { OxyConfig as OxyConfigBase, ApiError, User } from '../models/interfaces';
import { handleHttpError } from '../utils/errorUtils';
import { HttpService, type RequestOptions } from './HttpService';
import { OxyAuthenticationError, OxyAuthenticationTimeoutError } from './OxyServices.errors';

export interface OxyConfig extends OxyConfigBase {
  cloudURL?: string;
}

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  [key: string]: any;
}

/**
 * Base class for OxyServices with core infrastructure
 */
export class OxyServicesBase {
  public httpService: HttpService;
  public cloudURL: string;
  public config: OxyConfig;

  constructor(...args: any[]) {
    const config = args[0] as OxyConfig;
    if (!config || typeof config !== 'object') {
      throw new Error('OxyConfig is required');
    }
    this.config = config;
    this.cloudURL = config.cloudURL || 'https://cloud.oxy.so';

    // Initialize unified HTTP service (handles auth, caching, deduplication, queuing, retry)
    this.httpService = new HttpService(config);
  }

  // Test-only utility to reset global tokens between jest tests
  static __resetTokensForTests(): void {
    HttpService.__resetTokensForTests();
  }

  /**
   * Make a request with all performance optimizations
   * This is the main method for all API calls - ensures authentication and performance features
   */
  public async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.httpService.request<T>({
      method,
      url,
      data: method !== 'GET' ? data : undefined,
      params: method === 'GET' ? data : undefined,
      ...options,
    });
  }

  // ============================================================================
  // CORE METHODS (HTTP Client, Token Management, Error Handling)
  // ============================================================================

  /**
   * Get the configured Oxy API base URL
   */
  public getBaseURL(): string {
    return this.httpService.getBaseURL();
  }

  /**
   * Get the HTTP service instance
   * Useful for advanced use cases where direct access to the HTTP service is needed
   */
  public getClient(): HttpService {
    return this.httpService;
  }

  /**
   * Get performance metrics
   */
  public getMetrics() {
    return this.httpService.getMetrics();
  }

  /**
   * Clear request cache
   */
  public clearCache(): void {
    this.httpService.clearCache();
  }

  /**
   * Clear specific cache entry
   */
  public clearCacheEntry(key: string): void {
    this.httpService.clearCacheEntry(key);
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return this.httpService.getCacheStats();
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
    this.httpService.setTokens(accessToken, refreshToken);
  }

  /**
   * Clear stored authentication tokens
   */
  public clearTokens(): void {
    this.httpService.clearTokens();
  }

  /**
   * Get the current user ID from the access token
   */
  public getCurrentUserId(): string | null {
    const accessToken = this.httpService.getAccessToken();
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
   * Check if the client has a valid access token (public method)
   */
  public hasValidToken(): boolean {
    return this.httpService.hasAccessToken();
  }

  /**
   * Get the raw access token (for constructing anchor URLs when needed)
   */
  public getAccessToken(): string | null {
    return this.httpService.getAccessToken();
  }

  /**
   * Wait for authentication to be ready
   * 
   * Optimized for high-scale usage with immediate synchronous check and adaptive polling.
   * Returns immediately if token is already available (0ms delay), otherwise uses
   * adaptive polling that starts fast (50ms) and gradually increases to reduce CPU usage.
   * 
   * @param timeoutMs Maximum time to wait in milliseconds (default: 5000ms)
   * @returns Promise that resolves to true if authentication is ready, false if timeout
   * 
   * @example
   * ```typescript
   * const isReady = await oxyServices.waitForAuth(3000);
   * if (isReady) {
   *   // Proceed with authenticated operations
   * }
   * ```
   */
  public async waitForAuth(timeoutMs = 5000): Promise<boolean> {
    // Immediate synchronous check - no delay if token is ready
    if (this.httpService.hasAccessToken()) {
      return true;
    }

    const startTime = performance.now();
    const maxTime = startTime + timeoutMs;
    
    // Adaptive polling: start fast, then slow down to reduce CPU usage
    let pollInterval = 50; // Start with 50ms
    
    while (performance.now() < maxTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      if (this.httpService.hasAccessToken()) {
        return true;
      }
      
      // Increase interval after first few checks (adaptive polling)
      // This reduces CPU usage for long waits while maintaining responsiveness
      if (pollInterval < 200) {
        pollInterval = Math.min(pollInterval * 1.5, 200);
      }
    }
    
    return false;
  }

  /**
   * Execute a function with automatic authentication retry logic
   * This handles the common case where API calls are made before authentication completes
   */
  public async withAuthRetry<T>(
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
        if (!this.httpService.hasAccessToken()) {
          if (attempt === 0) {
            // On first attempt, wait briefly for authentication to complete
            const authReady = await this.waitForAuth(authTimeoutMs);
            
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

      } catch (error: unknown) {
        const isLastAttempt = attempt === maxRetries;
        const errorObj = error && typeof error === 'object' ? error as { response?: { status?: number }; code?: string; message?: string } : null;
        const isAuthError = errorObj?.response?.status === 401 || 
                           errorObj?.code === 'MISSING_TOKEN' ||
                           errorObj?.message?.includes('Authentication') ||
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
    if (!this.hasValidToken()) {
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
  public handleError(error: unknown): Error {
    const api = handleHttpError(error);
    const err = new Error(api.message) as Error & { code?: string; status?: number; details?: Record<string, unknown> };
    err.code = api.code;
    err.status = api.status;
    err.details = api.details;
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
}

