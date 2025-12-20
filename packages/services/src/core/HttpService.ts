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
import type { OxyConfig } from '../models/interfaces';

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

// Token management moved to TokenService - import it instead
import { tokenService } from './services/TokenService';

/**
 * Unified HTTP Service
 * 
 * Consolidates HttpClient + RequestManager into a single efficient class.
 * Uses native fetch instead of axios for smaller bundle size.
 */
export class HttpService {
  private baseURL: string;
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
    
    // Initialize TokenService with baseURL
    tokenService.initialize(this.baseURL);
    
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
        });

        if (timeoutId) clearTimeout(timeoutId);

        // Handle response
        if (!response.ok) {
          if (response.status === 401) {
            tokenService.clearTokens();
          }
          
          // Try to parse error response (handle empty/malformed JSON)
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = await response.json() as { message?: string } | null;
              if (errorData?.message) {
                errorMessage = errorData.message;
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
   * Get auth header with automatic token refresh
   * Uses TokenService for all token operations
   */
  private async getAuthHeader(): Promise<string | null> {
    return await tokenService.getAuthHeader();
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

  // Token management - delegates to TokenService
  setTokens(accessToken: string, refreshToken = ''): void {
    tokenService.setTokens(accessToken, refreshToken);
  }

  clearTokens(): void {
    tokenService.clearTokens();
  }

  getAccessToken(): string | null {
    return tokenService.getAccessToken();
  }

  hasAccessToken(): boolean {
    return tokenService.hasAccessToken();
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
      tokenService.clearTokens();
    } catch (error) {
      // Silently fail in test cleanup - this is expected behavior
      // TokenService might not be initialized in some test scenarios
    }
  }
}

