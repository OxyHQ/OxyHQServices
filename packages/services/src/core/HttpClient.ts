/**
 * HTTP Client Service
 * 
 * Handles all HTTP communication with authentication, interceptors, and error handling.
 * This is the single source of truth for making authenticated HTTP requests.
 */

import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios';
import { jwtDecode } from 'jwt-decode';
import type { OxyConfig } from '../models/interfaces';
import { handleHttpError } from '../utils/errorUtils';
import { SimpleLogger } from '../utils/requestUtils';

interface JwtPayload {
  exp?: number;
  userId?: string;
  id?: string;
  sessionId?: string;
  [key: string]: any;
}

/**
 * Token store for authentication
 */
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

/**
 * HTTP Client Service
 * 
 * Manages Axios instance with authentication interceptors.
 * All HTTP requests should go through this service to ensure authentication.
 */
export class HttpClient {
  private client: AxiosInstance;
  private tokenStore: TokenStore;
  private logger: SimpleLogger;
  private baseURL: string;

  constructor(config: OxyConfig) {
    this.baseURL = config.baseURL;
    this.tokenStore = TokenStore.getInstance();
    this.logger = new SimpleLogger(
      config.enableLogging || false,
      config.logLevel || 'error',
      'HttpClient'
    );

    const timeout = config.requestTimeout || 5000;

    // Create Axios instance with optimized configuration
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout,
      headers: {
        'Accept': 'application/json',
      },
      // Enable HTTP keep-alive for connection reuse (Node.js only)
      ...(typeof process !== 'undefined' && 
          process.env && 
          typeof window === 'undefined' && 
          typeof require !== 'undefined' ? {
        httpAgent: new (require('http').Agent)({ 
          keepAlive: true, 
          keepAliveMsecs: 1000, 
          maxSockets: 50 
        }),
        httpsAgent: new (require('https').Agent)({ 
          keepAlive: true, 
          keepAliveMsecs: 1000, 
          maxSockets: 50 
        }),
      } : {}),
    });

    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for authentication and error handling
   */
  private setupInterceptors(): void {
    // Request interceptor: Add authentication header
    this.client.interceptors.request.use(
      async (req: InternalAxiosRequestConfig) => {
        const accessToken = this.tokenStore.getAccessToken();
        if (!accessToken) {
          return req;
        }

        try {
          const decoded = jwtDecode<JwtPayload>(accessToken);
          const currentTime = Math.floor(Date.now() / 1000);

          // If token expires in less than 60 seconds, refresh it
          if (decoded.exp && decoded.exp - currentTime < 60) {
            if (decoded.sessionId) {
              try {
                // Create a new axios instance to avoid interceptor recursion
                const refreshClient = axios.create({
                  baseURL: this.client.defaults.baseURL,
                  timeout: this.client.defaults.timeout,
                });
                const res = await refreshClient.get(`/api/session/token/${decoded.sessionId}`);
                this.tokenStore.setTokens(res.data.accessToken);
                req.headers.Authorization = `Bearer ${res.data.accessToken}`;
                this.logger.debug('Token refreshed');
              } catch (refreshError) {
                // If refresh fails, use current token anyway
                req.headers.Authorization = `Bearer ${accessToken}`;
                this.logger.warn('Token refresh failed, using current token');
              }
            } else {
              req.headers.Authorization = `Bearer ${accessToken}`;
            }
          } else {
            req.headers.Authorization = `Bearer ${accessToken}`;
          }
        } catch (error) {
          this.logger.error('Error processing token:', error);
          // Even if there's an error, still try to use the token
          req.headers.Authorization = `Bearer ${accessToken}`;
        }

        return req;
      },
      (error) => {
        this.logger.error('Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor: Handle auth errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.logger.warn('401 Unauthorized, clearing tokens');
          this.tokenStore.clearTokens();
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get the underlying Axios instance
   * Use this only when you need direct access to Axios features
   */
  getAxiosInstance(): AxiosInstance {
    return this.client;
  }

  /**
   * Make a raw HTTP request (no caching, deduplication, etc.)
   * Use this for requests that need to bypass performance features
   */
  async request<T = any>(config: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    data?: any;
    params?: any;
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    try {
      const response = await this.client.request<T>({
        method: config.method,
        url: config.url,
        data: config.data,
        params: config.params,
        timeout: config.timeout,
        signal: config.signal,
      });
      
      // Unwrap standardized API response format: { data: ... }
      // This handles responses from sendSuccess() and sendPaginated() helpers
      const responseData = response.data as any;
      
      // Handle paginated responses: { data: [...], pagination: {...} }
      // Return the data array directly - the calling method will wrap it appropriately
      if (responseData && typeof responseData === 'object' && 'data' in responseData && 'pagination' in responseData) {
        // For paginated responses, return the data array directly
        // The calling methods like getUserFollowers/getUserFollowing will handle wrapping
        // We return the whole response so methods can access both data and pagination
        return responseData as T;
      }
      
      // Handle regular success responses: { data: ... }
      if (responseData && typeof responseData === 'object' && 'data' in responseData && !Array.isArray(responseData)) {
        return responseData.data as T;
      }
      
      // Return as-is for responses that don't use sendSuccess wrapper
      return responseData as T;
    } catch (error) {
      throw handleHttpError(error);
    }
  }

  /**
   * Get base URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * Set authentication tokens
   */
  setTokens(accessToken: string, refreshToken = ''): void {
    this.tokenStore.setTokens(accessToken, refreshToken);
  }

  /**
   * Clear authentication tokens
   */
  clearTokens(): void {
    this.tokenStore.clearTokens();
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    return this.tokenStore.getAccessToken();
  }

  /**
   * Check if has access token
   */
  hasAccessToken(): boolean {
    return this.tokenStore.hasAccessToken();
  }

  // Test-only utility to reset global tokens between jest tests
  static __resetTokensForTests(): void {
    try {
      TokenStore.getInstance().clearTokens();
    } catch {}
  }
}

