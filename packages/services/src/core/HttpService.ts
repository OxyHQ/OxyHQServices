/**
 * Unified HTTP Service
 * 
 * Consolidates HttpClient + RequestManager into a single efficient class.
 * Uses native fetch instead of axios for smaller bundle size.
 * 
 * Handles:
 * - Authentication (token management, auto-refresh)
 * - Caching (TTL-based)
 * - Deduplication (concurrent requests)
 * - Retry logic
 * - Error handling
 * - Request queuing
 */

import { TTLCache, registerCacheForCleanup } from '../utils/cache';
import { RequestDeduplicator, RequestQueue, SimpleLogger } from '../utils/requestUtils';
import { retryAsync } from '../utils/asyncUtils';
import { handleHttpError } from '../utils/errorUtils';
import { jwtDecode } from 'jwt-decode';
import { isNative, getPlatformOS } from '../utils/platform';
import type { OxyConfig } from '../models/interfaces';

/**
 * Check if we're running in a native app environment (React Native, not web)
 * This is used to determine CSRF handling mode
 */
const isNativeApp = isNative();

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  [key: string]: any;
}

export interface RequestOptions {
  cache?: boolean;
  cacheTTL?: number;
  deduplicate?: boolean;
  retry?: boolean;
  maxRetries?: number;
  timeout?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface RequestConfig extends RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  data?: unknown;
  params?: Record<string, unknown>;
}

/**
 * Token store for authentication (singleton)
 */
class TokenStore {
  private static instance: TokenStore;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private csrfToken: string | null = null;
  private csrfTokenFetchPromise: Promise<string | null> | null = null;

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

  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  getCsrfToken(): string | null {
    return this.csrfToken;
  }

  setCsrfTokenFetchPromise(promise: Promise<string | null> | null): void {
    this.csrfTokenFetchPromise = promise;
  }

  getCsrfTokenFetchPromise(): Promise<string | null> | null {
    return this.csrfTokenFetchPromise;
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
    this.csrfTokenFetchPromise = null;
  }
}

/**
 * Unified HTTP Service
 * 
 * Consolidates HttpClient + RequestManager into a single efficient class.
 * Uses native fetch instead of axios for smaller bundle size.
 */
export class HttpService {
  private baseURL: string;
  private tokenStore: TokenStore;
  private cache: TTLCache<any>;
  private deduplicator: RequestDeduplicator;
  private requestQueue: RequestQueue;
  private logger: SimpleLogger;
  private config: OxyConfig;

  // Performance monitoring
  private requestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageResponseTime: 0,
  };

  constructor(config: OxyConfig) {
    this.config = config;
    this.baseURL = config.baseURL;
    this.tokenStore = TokenStore.getInstance();
    
    this.logger = new SimpleLogger(
      config.enableLogging || false,
      config.logLevel || 'error',
      'HttpService'
    );

    // Initialize performance infrastructure
    this.cache = new TTLCache<any>(config.cacheTTL || 5 * 60 * 1000);
    registerCacheForCleanup(this.cache);
    this.deduplicator = new RequestDeduplicator();
    this.requestQueue = new RequestQueue(
      config.maxConcurrentRequests || 10,
      config.requestQueueSize || 100
    );
  }

  /**
   * Robust FormData detection that works in browser and Node.js environments
   * Checks multiple conditions to handle different FormData implementations
   */
  private isFormData(data: unknown): boolean {
    if (!data) {
      return false;
    }

    // Primary check: instanceof FormData (works in browser and Node.js with proper polyfills)
    if (data instanceof FormData) {
      return true;
    }

    // Fallback: Check constructor name (handles Node.js polyfills like form-data)
    if (typeof data === 'object' && data !== null) {
      const constructorName = data.constructor?.name;
      if (constructorName === 'FormData' || constructorName === 'FormDataImpl') {
        return true;
      }

      // Additional check: Look for FormData-like methods
      if (typeof (data as any).append === 'function' && 
          typeof (data as any).get === 'function' &&
          typeof (data as any).has === 'function') {
        return true;
      }
    }

    return false;
  }

  /**
   * Main request method - handles everything in one place
   */
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    const {
      method,
      url,
      data,
      params,
      timeout = this.config.requestTimeout || 5000,
      signal,
      cache = method === 'GET',
      cacheTTL,
      deduplicate = true,
      retry = this.config.enableRetry !== false,
      maxRetries = this.config.maxRetries || 3,
    } = config;

    // Generate cache key (optimized for large objects)
    const cacheKey = cache ? this.generateCacheKey(method, url, data || params) : null;

    // Check cache first
    if (cache && cacheKey) {
      const cached = this.cache.get(cacheKey) as T | null;
      if (cached !== null) {
        this.requestMetrics.cacheHits++;
        this.logger.debug('Cache hit:', url);
        return cached;
      }
      this.requestMetrics.cacheMisses++;
    }

    // Request function
    const requestFn = async (): Promise<T> => {
      const startTime = Date.now();
      try {
        // Build URL with params
        const fullUrl = this.buildURL(url, params);
        
        // Get auth token (with auto-refresh)
        const authHeader = await this.getAuthHeader();

        // Get CSRF token for state-changing requests
        const isStateChangingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
        const csrfToken = isStateChangingMethod ? await this.fetchCsrfToken() : null;

        // Determine if data is FormData using robust detection
        const isFormData = this.isFormData(data);

        // Make fetch request
        const controller = new AbortController();
        const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
        
        if (signal) {
          signal.addEventListener('abort', () => controller.abort());
        }

        // Build headers - start with defaults
        const headers: Record<string, string> = {
          'Accept': 'application/json',
        };

        // Only set Content-Type for non-FormData requests (FormData sets it automatically with boundary)
        if (!isFormData) {
          headers['Content-Type'] = 'application/json';
        }

        // Add authorization header if available
        if (authHeader) {
          headers['Authorization'] = authHeader;
        }

        // Add CSRF token header for state-changing requests
        if (csrfToken) {
          headers['X-CSRF-Token'] = csrfToken;
        }

        // Add native app header for React Native (required for CSRF validation)
        // Native apps can't persist cookies like browsers, so the server uses
        // header-only CSRF validation when this header is present
        if (isNativeApp && isStateChangingMethod) {
          headers['X-Native-App'] = 'true';
        }

        // Debug logging for CSRF issues
        if (isStateChangingMethod && __DEV__) {
          console.log('[HttpService] CSRF Debug:', {
            url,
            method,
            isNativeApp,
            platformOS: getPlatformOS(),
            hasCsrfToken: !!csrfToken,
            csrfTokenLength: csrfToken?.length,
            hasNativeAppHeader: headers['X-Native-App'] === 'true',
          });
        }

        // Merge custom headers if provided
        if (config.headers) {
          Object.entries(config.headers).forEach(([key, value]) => {
            // For FormData, explicitly remove Content-Type if user tries to set it
            // The browser/fetch API will set it automatically with the boundary
            if (isFormData && key.toLowerCase() === 'content-type') {
              this.logger.debug('Ignoring Content-Type header for FormData - will be set automatically');
              return;
            }
            headers[key] = value;
          });
        }

        const bodyValue = method !== 'GET' && data 
            ? (isFormData ? data : JSON.stringify(data)) 
            : undefined;
        
        const response = await fetch(fullUrl, {
          method,
          headers,
          body: bodyValue as BodyInit | null | undefined,
          signal: controller.signal,
          credentials: 'include', // Include cookies for cross-origin requests (CSRF, session)
        });

        if (timeoutId) clearTimeout(timeoutId);

        // Handle response
        if (!response.ok) {
          if (response.status === 401) {
            this.tokenStore.clearTokens();
          }
          
          // Try to parse error response (handle empty/malformed JSON)
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = await response.json() as { message?: string; error?: string } | null;
              // Check both 'message' and 'error' fields for backwards compatibility
              if (errorData?.message) {
                errorMessage = errorData.message;
              } else if (errorData?.error) {
                errorMessage = errorData.error;
              }
            } catch (parseError) {
              // Malformed JSON or empty response - use status text
              this.logger.warn('Failed to parse error response JSON:', parseError);
            }
          }
          
          const error = new Error(errorMessage) as Error & { 
            status?: number; 
            response?: { status: number; statusText: string } 
          };
          error.status = response.status;
          error.response = { status: response.status, statusText: response.statusText };
          throw error;
        }

        // Handle different response types (optimized - read response once)
        const contentType = response.headers.get('content-type');
        let responseData: unknown;
        
        if (contentType && contentType.includes('application/json')) {
          // Use response.json() directly for better performance
          try {
            responseData = await response.json();
            // Handle null/undefined responses
            if (responseData === null || responseData === undefined) {
              responseData = null;
            } else {
              // Unwrap standardized API response format for JSON
              responseData = this.unwrapResponse(responseData);
            }
          } catch (parseError) {
            // Handle malformed JSON or empty responses gracefully
            // Note: Once response.json() is called, the body is consumed and cannot be read again
            // So we check the error type to determine if it's empty or malformed
            if (parseError instanceof SyntaxError) {
              this.logger.warn('Failed to parse JSON response (malformed or empty):', parseError);
              // SyntaxError typically means empty or malformed JSON
              // For empty responses, return null; for malformed JSON, throw descriptive error
              responseData = null; // Treat as empty response for safety
            } else {
              this.logger.warn('Failed to read response:', parseError);
              throw new Error('Failed to read response from server');
            }
          }
        } else if (contentType && (contentType.includes('application/octet-stream') || contentType.includes('image/') || contentType.includes('video/') || contentType.includes('audio/'))) {
          // For binary responses (blobs), return the blob directly without unwrapping
          responseData = await response.blob();
        } else {
          // For other responses, return as text
          const text = await response.text();
          responseData = text || null;
        }

        const duration = Date.now() - startTime;
        this.updateMetrics(true, duration);
        this.config.onRequestEnd?.(url, method, duration, true);

        return responseData as T;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        this.updateMetrics(false, duration);
        this.config.onRequestEnd?.(url, method, duration, false);
        this.config.onRequestError?.(url, method, error instanceof Error ? error : new Error(String(error)));
        
        // Handle AbortError specifically for better error messages
        if (error instanceof Error && error.name === 'AbortError') {
          throw handleHttpError(error);
        }
        
        throw handleHttpError(error);
      }
    };

    // Wrap with retry if enabled
    const requestWithRetry = retry
      ? () => retryAsync(requestFn, maxRetries, this.config.retryDelay || 1000)
      : requestFn;

    // Wrap with deduplication if enabled (use optimized key generation)
    const dedupeKey = deduplicate ? this.generateCacheKey(method, url, data || params) : null;
    const finalRequest = dedupeKey
      ? () => this.deduplicator.deduplicate(dedupeKey, requestWithRetry)
      : requestWithRetry;

    // Execute request (with queue if needed)
    const result = await this.requestQueue.enqueue(finalRequest);

    // Cache the result if caching is enabled
    if (cache && cacheKey && result) {
      this.cache.set(cacheKey, result, cacheTTL);
    }

    return result;
  }

  /**
   * Generate cache key efficiently
   * Uses simple hash for large objects to avoid expensive JSON.stringify
   */
  private generateCacheKey(method: string, url: string, data?: unknown): string {
    if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
      return `${method}:${url}`;
    }

    // For small objects, use JSON.stringify
    const dataStr = JSON.stringify(data);
    if (dataStr.length < 1000) {
      return `${method}:${url}:${dataStr}`;
    }

    // For large objects, use a simple hash based on keys and values length
    // This avoids expensive serialization while still being unique enough
    const hash = typeof data === 'object' && data !== null
      ? Object.keys(data).sort().join(',') + ':' + dataStr.length
      : String(data).substring(0, 100);
    
    return `${method}:${url}:${hash}`;
  }

  /**
   * Build full URL with query params
   */
  private buildURL(url: string, params?: Record<string, unknown>): string {
    const base = url.startsWith('http') ? url : `${this.baseURL}${url}`;
    
    if (!params || Object.keys(params).length === 0) {
      return base;
    }

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `${base}${base.includes('?') ? '&' : '?'}${queryString}` : base;
  }

  /**
   * Fetch CSRF token from server (with deduplication)
   * Required for state-changing requests (POST, PUT, PATCH, DELETE)
   */
  private async fetchCsrfToken(): Promise<string | null> {
    // Return cached token if available
    const cachedToken = this.tokenStore.getCsrfToken();
    if (cachedToken) {
      if (__DEV__) console.log('[HttpService] Using cached CSRF token');
      return cachedToken;
    }

    // Deduplicate concurrent CSRF token fetches
    const existingPromise = this.tokenStore.getCsrfTokenFetchPromise();
    if (existingPromise) {
      if (__DEV__) console.log('[HttpService] Waiting for existing CSRF fetch');
      return existingPromise;
    }

    const fetchPromise = (async () => {
      try {
        if (__DEV__) console.log('[HttpService] Fetching CSRF token from:', `${this.baseURL}/api/csrf-token`);

        // Use AbortController for timeout (more compatible than AbortSignal.timeout)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${this.baseURL}/api/csrf-token`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          credentials: 'include', // Required to receive and send cookies
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (__DEV__) console.log('[HttpService] CSRF fetch response:', response.status, response.ok);

        if (response.ok) {
          const data = await response.json() as { csrfToken?: string };
          if (__DEV__) console.log('[HttpService] CSRF response data:', data);
          const token = data.csrfToken || null;
          this.tokenStore.setCsrfToken(token);
          this.logger.debug('CSRF token fetched');
          return token;
        }

        // Also check response header for CSRF token
        const headerToken = response.headers.get('X-CSRF-Token');
        if (headerToken) {
          this.tokenStore.setCsrfToken(headerToken);
          this.logger.debug('CSRF token from header');
          return headerToken;
        }

        if (__DEV__) console.log('[HttpService] CSRF fetch failed with status:', response.status);
        this.logger.warn('Failed to fetch CSRF token:', response.status);
        return null;
      } catch (error) {
        if (__DEV__) console.log('[HttpService] CSRF fetch error:', error);
        this.logger.warn('CSRF token fetch error:', error);
        return null;
      } finally {
        this.tokenStore.setCsrfTokenFetchPromise(null);
      }
    })();

    this.tokenStore.setCsrfTokenFetchPromise(fetchPromise);
    return fetchPromise;
  }

  /**
   * Get auth header with automatic token refresh
   */
  private async getAuthHeader(): Promise<string | null> {
    const accessToken = this.tokenStore.getAccessToken();
    if (!accessToken) {
      return null;
    }

    try {
      const decoded = jwtDecode<JwtPayload>(accessToken);
      const currentTime = Math.floor(Date.now() / 1000);

      // If token expires in less than 60 seconds, refresh it
      if (decoded.exp && decoded.exp - currentTime < 60 && decoded.sessionId) {
        try {
          const refreshUrl = `${this.baseURL}/api/session/token/${decoded.sessionId}`;
          
          // Use AbortSignal.timeout for consistent timeout handling
          const response = await fetch(refreshUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(5000),
            credentials: 'include', // Include cookies for cross-origin requests
          });

          if (response.ok) {
            const { accessToken: newToken } = await response.json();
            this.tokenStore.setTokens(newToken);
            this.logger.debug('Token refreshed');
            return `Bearer ${newToken}`;
          }
        } catch (refreshError) {
          this.logger.warn('Token refresh failed, using current token');
        }
      }

      return `Bearer ${accessToken}`;
    } catch (error) {
      this.logger.error('Error processing token:', error);
      return `Bearer ${accessToken}`;
    }
  }

  /**
   * Unwrap standardized API response format
   */
  private unwrapResponse(responseData: unknown): unknown {
    // Handle paginated responses: { data: [...], pagination: {...} }
    if (responseData && typeof responseData === 'object' && 'data' in responseData && 'pagination' in responseData) {
      return responseData;
    }
    
    // Handle regular success responses: { data: ... }
    if (responseData && typeof responseData === 'object' && 'data' in responseData && !Array.isArray(responseData)) {
      return responseData.data;
    }
    
    // Return as-is for responses that don't use sendSuccess wrapper
    return responseData;
  }

  /**
   * Update request metrics
   */
  private updateMetrics(success: boolean, duration: number): void {
    this.requestMetrics.totalRequests++;
    if (success) {
      this.requestMetrics.successfulRequests++;
    } else {
      this.requestMetrics.failedRequests++;
    }

    const alpha = 0.1;
    this.requestMetrics.averageResponseTime =
      this.requestMetrics.averageResponseTime * (1 - alpha) + duration * alpha;
  }

  // Convenience methods (for backward compatibility)
  /**
   * GET request convenience method
   */
  async get<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'url'>): Promise<{ data: T }> {
    const result = await this.request<T>({ method: 'GET', url, ...config });
    return { data: result as T };
  }

  /**
   * POST request convenience method
   * Supports FormData uploads - Content-Type will be set automatically for FormData
   * @param url - Request URL
   * @param data - Request body (can be FormData for file uploads)
   * @param config - Request configuration including optional headers
   * @example
   * ```typescript
   * const formData = new FormData();
   * formData.append('file', file);
   * await api.post('/upload', formData, { headers: { 'X-Custom-Header': 'value' } });
   * ```
   */
  async post<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'url' | 'data'>): Promise<{ data: T }> {
    const result = await this.request<T>({ method: 'POST', url, data, ...config });
    return { data: result as T };
  }

  /**
   * PUT request convenience method
   * Supports FormData uploads - Content-Type will be set automatically for FormData
   * @param url - Request URL
   * @param data - Request body (can be FormData for file uploads)
   * @param config - Request configuration including optional headers
   * @example
   * ```typescript
   * const formData = new FormData();
   * formData.append('file', file);
   * await api.put('/upload', formData, { headers: { 'X-Custom-Header': 'value' } });
   * ```
   */
  async put<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'url' | 'data'>): Promise<{ data: T }> {
    const result = await this.request<T>({ method: 'PUT', url, data, ...config });
    return { data: result as T };
  }

  /**
   * PATCH request convenience method
   * Supports FormData uploads - Content-Type will be set automatically for FormData
   * @param url - Request URL
   * @param data - Request body (can be FormData for file uploads)
   * @param config - Request configuration including optional headers
   * @example
   * ```typescript
   * const formData = new FormData();
   * formData.append('file', file);
   * await api.patch('/upload', formData, { headers: { 'X-Custom-Header': 'value' } });
   * ```
   */
  async patch<T = unknown>(url: string, data?: unknown, config?: Omit<RequestConfig, 'method' | 'url' | 'data'>): Promise<{ data: T }> {
    const result = await this.request<T>({ method: 'PATCH', url, data, ...config });
    return { data: result as T };
  }

  async delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'url'>): Promise<{ data: T }> {
    const result = await this.request<T>({ method: 'DELETE', url, ...config });
    return { data: result as T };
  }

  // Token management
  setTokens(accessToken: string, refreshToken = ''): void {
    this.tokenStore.setTokens(accessToken, refreshToken);
  }

  clearTokens(): void {
    this.tokenStore.clearTokens();
    this.tokenStore.clearCsrfToken();
  }

  getAccessToken(): string | null {
    return this.tokenStore.getAccessToken();
  }

  hasAccessToken(): boolean {
    return this.tokenStore.hasAccessToken();
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  // Cache management
  clearCache(): void {
    this.cache.clear();
  }

  clearCacheEntry(key: string): void {
    this.cache.delete(key);
  }

  getCacheStats() {
    const cacheStats = this.cache.getStats();
    const total = this.requestMetrics.cacheHits + this.requestMetrics.cacheMisses;
    return {
      size: cacheStats.size,
      hits: this.requestMetrics.cacheHits,
      misses: this.requestMetrics.cacheMisses,
      hitRate: total > 0 ? this.requestMetrics.cacheHits / total : 0,
    };
  }

  getMetrics() {
    return { ...this.requestMetrics };
  }

  // Test-only utility
  static __resetTokensForTests(): void {
    try {
      TokenStore.getInstance().clearTokens();
    } catch (error) {
      // Silently fail in test cleanup - this is expected behavior
      // TokenStore might not be initialized in some test scenarios
    }
  }
}

