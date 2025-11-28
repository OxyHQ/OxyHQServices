/**
 * Request Manager
 * 
 * Handles request-level optimizations: caching, deduplication, queuing, and retry.
 * Works on top of HttpClient to add performance features.
 */

import type { AxiosInstance } from 'axios';
import { TTLCache, registerCacheForCleanup } from '../utils/cache';
import { RequestDeduplicator, RequestQueue, SimpleLogger } from '../utils/requestUtils';
import { retryAsync } from '../utils/asyncUtils';
import type { OxyConfig } from '../models/interfaces';

export interface RequestOptions {
  cache?: boolean;
  cacheTTL?: number;
  deduplicate?: boolean;
  retry?: boolean;
  maxRetries?: number;
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * Request Manager
 * 
 * Manages request-level optimizations while delegating actual HTTP calls to HttpClient.
 */
export class RequestManager {
  private cache: TTLCache<any>;
  private deduplicator: RequestDeduplicator;
  private requestQueue: RequestQueue;
  private logger: SimpleLogger;
  private config: OxyConfig;
  private httpClient: { request: (config: any) => Promise<any> };

  // Performance monitoring
  private requestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageResponseTime: 0,
  };

  constructor(
    httpClient: { request: (config: any) => Promise<any> },
    config: OxyConfig
  ) {
    this.httpClient = httpClient;
    this.config = config;

    // Initialize performance infrastructure
    this.cache = new TTLCache<any>(config.cacheTTL || 5 * 60 * 1000);
    registerCacheForCleanup(this.cache);
    this.deduplicator = new RequestDeduplicator();
    this.requestQueue = new RequestQueue(
      config.maxConcurrentRequests || 10,
      config.requestQueueSize || 100
    );
    this.logger = new SimpleLogger(
      config.enableLogging || false,
      config.logLevel || 'error',
      'RequestManager'
    );
  }

  /**
   * Make a request with all performance optimizations
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    data?: any,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      cache = method === 'GET', // Cache GET requests by default
      cacheTTL,
      deduplicate = true,
      retry = this.config.enableRetry !== false,
      maxRetries = this.config.maxRetries || 3,
      timeout,
      signal,
    } = options;

    // Generate cache key
    const cacheKey = cache ? `${method}:${url}:${JSON.stringify(data || {})}` : null;

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

    // Request function that uses HttpClient
    const requestFn = async (): Promise<T> => {
      const startTime = Date.now();
      try {
        const result = await this.httpClient.request({
          method,
          url,
          data: method !== 'GET' ? data : undefined,
          params: method === 'GET' ? data : undefined,
          timeout: timeout || this.config.requestTimeout || 5000,
          signal,
        });

        const duration = Date.now() - startTime;
        this.updateMetrics(true, duration);
        this.config.onRequestEnd?.(url, method, duration, true);

        return result as T;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.updateMetrics(false, duration);
        this.config.onRequestEnd?.(url, method, duration, false);
        this.config.onRequestError?.(url, method, error);
        throw error;
      }
    };

    // Wrap with retry if enabled
    const requestWithRetry = retry
      ? () => retryAsync(requestFn, maxRetries, this.config.retryDelay || 1000)
      : requestFn;

    // Wrap with deduplication if enabled
    const dedupeKey = deduplicate ? `${method}:${url}:${JSON.stringify(data || {})}` : null;
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
   * Update request metrics
   */
  private updateMetrics(success: boolean, duration: number): void {
    this.requestMetrics.totalRequests++;
    if (success) {
      this.requestMetrics.successfulRequests++;
    } else {
      this.requestMetrics.failedRequests++;
    }

    // Update average response time (exponential moving average)
    const alpha = 0.1; // Smoothing factor
    this.requestMetrics.averageResponseTime =
      this.requestMetrics.averageResponseTime * (1 - alpha) + duration * alpha;
  }

  /**
   * Get performance metrics
   */
  getMetrics(): typeof this.requestMetrics {
    return { ...this.requestMetrics };
  }

  /**
   * Clear request cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Cache cleared');
  }

  /**
   * Clear specific cache entry
   */
  clearCacheEntry(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const cacheStats = this.cache.getStats();
    const total = this.requestMetrics.cacheHits + this.requestMetrics.cacheMisses;
    return {
      size: cacheStats.size,
      hits: this.requestMetrics.cacheHits,
      misses: this.requestMetrics.cacheMisses,
      hitRate: total > 0 ? this.requestMetrics.cacheHits / total : 0,
    };
  }
}

