/**
 * Zero-Config Authentication Manager
 * 
 * This module provides automatic token management, session handling,
 * and seamless authentication for Oxy services.
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface JwtPayload {
  exp: number;
  userId: string;
  username: string;
  [key: string]: any;
}

interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  tokens: AuthTokens | null;
}

interface LoginCredentials {
  username: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  user: any;
  message?: string; // Make message optional
}

export class AuthenticationManager {
  private client: AxiosInstance;
  private tokens: AuthTokens | null = null;
  private user: any | null = null;
  private refreshPromise: Promise<AuthTokens> | null = null;
  private listeners: ((state: AuthState) => void)[] = [];
  private storageKey = '@oxy/auth-tokens';

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 15000,
      withCredentials: true, // Enable cookies for session management
    });

    this.setupInterceptors();
    this.initializeFromStorage();
  }

  /**
   * Setup axios interceptors for automatic token management
   */
  private setupInterceptors(): void {
    // Request interceptor - automatically add auth headers
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Skip auth for login/signup endpoints
        if (this.isPublicEndpoint(config.url || '')) {
          return config;
        }

        // Ensure we have a valid token
        await this.ensureValidToken();

        // Add authorization header if we have a token
        if (this.tokens?.accessToken) {
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${this.tokens.accessToken}`;
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle token expiration and auto-retry
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        // If it's a 401 and we haven't already retried, attempt token refresh
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.tokens?.refreshToken &&
          !this.isPublicEndpoint(originalRequest?.url || '')
        ) {
          originalRequest._retry = true;

          try {
            await this.refreshTokens();
            
            // Retry original request with new token
            if (originalRequest && this.tokens?.accessToken) {
              originalRequest.headers = originalRequest.headers || {};
              originalRequest.headers.Authorization = `Bearer ${this.tokens.accessToken}`;
              return this.client(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, clear tokens and notify listeners
            await this.logout();
            return Promise.reject(error);
          }
        }

        // For non-auth errors or failed retries, reject with formatted error
        return Promise.reject(this.formatError(error));
      }
    );
  }

  /**
   * Check if endpoint is public (doesn't require authentication)
   */
  private isPublicEndpoint(url: string): boolean {
    const publicPaths = [
      '/auth/login',
      '/auth/signup',
      '/auth/register',
      '/auth/check-username',
      '/auth/check-email',
      '/health',
      '/'
    ];
    
    return publicPaths.some(path => url.includes(path));
  }

  /**
   * Initialize authentication state from persistent storage
   */
  private async initializeFromStorage(): Promise<void> {
    try {
      const storedData = await AsyncStorage.getItem(this.storageKey);
      if (storedData) {
        const tokens = JSON.parse(storedData) as AuthTokens;
        
        // Validate that tokens haven't expired
        if (await this.validateStoredTokens(tokens)) {
          this.tokens = tokens;
          await this.fetchCurrentUser();
          this.notifyStateChange();
        } else {
          // Tokens expired, clear storage
          await AsyncStorage.removeItem(this.storageKey);
        }
      }
    } catch (error) {
      console.warn('[OxyAuth] Failed to initialize from storage:', error);
      await AsyncStorage.removeItem(this.storageKey);
    }
  }

  /**
   * Validate stored tokens without making network calls if possible
   */
  private async validateStoredTokens(tokens: AuthTokens): Promise<boolean> {
    try {
      // First check if access token is expired
      const decoded = jwtDecode<JwtPayload>(tokens.accessToken);
      const now = Math.floor(Date.now() / 1000);
      
      // If access token is still valid, we're good
      if (decoded.exp > now + 60) { // 60 second buffer
        return true;
      }

      // Access token expired, try refresh token
      const refreshDecoded = jwtDecode<JwtPayload>(tokens.refreshToken);
      return refreshDecoded.exp > now;
    } catch {
      return false;
    }
  }

  /**
   * Ensure we have a valid access token
   */
  private async ensureValidToken(): Promise<void> {
    if (!this.tokens?.accessToken) {
      return;
    }

    try {
      const decoded = jwtDecode<JwtPayload>(this.tokens.accessToken);
      const now = Math.floor(Date.now() / 1000);
      
      // Refresh if token expires within 5 minutes
      if (decoded.exp - now < 300) {
        await this.refreshTokens();
      }
    } catch (error) {
      console.warn('[OxyAuth] Token validation error:', error);
      // If token is malformed, try refresh
      if (this.tokens?.refreshToken) {
        await this.refreshTokens();
      }
    }
  }

  /**
   * Login with credentials
   */
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    try {
      const response = await this.client.post('/auth/login', credentials);
      const loginData = response.data as LoginResponse;

      if (loginData.success && loginData.accessToken && loginData.refreshToken) {
        await this.setTokens({
          accessToken: loginData.accessToken,
          refreshToken: loginData.refreshToken,
        });
        
        this.user = loginData.user;
        this.notifyStateChange();
        
        return loginData;
      } else {
        throw new Error(loginData.message || 'Login failed');
      }
    } catch (error) {
      throw this.formatError(error);
    }
  }

  /**
   * Register new user
   */
  async register(userData: { username: string; email: string; password: string }): Promise<LoginResponse> {
    try {
      const response = await this.client.post('/auth/register', userData);
      const registerData = response.data as LoginResponse;

      if (registerData.success && registerData.accessToken && registerData.refreshToken) {
        await this.setTokens({
          accessToken: registerData.accessToken,
          refreshToken: registerData.refreshToken,
        });
        
        this.user = registerData.user;
        this.notifyStateChange();
        
        return registerData;
      } else {
        throw new Error(registerData.message || 'Registration failed');
      }
    } catch (error) {
      throw this.formatError(error);
    }
  }

  /**
   * Logout user and clear all tokens
   */
  async logout(): Promise<void> {
    // Attempt server-side logout if we have tokens
    if (this.tokens?.refreshToken) {
      try {
        await this.client.post('/auth/logout', {
          refreshToken: this.tokens.refreshToken,
        });
      } catch (error) {
        console.warn('[OxyAuth] Server logout failed:', error);
      }
    }

    // Clear local state
    this.tokens = null;
    this.user = null;
    
    // Clear storage
    try {
      await AsyncStorage.removeItem(this.storageKey);
    } catch (error) {
      console.warn('[OxyAuth] Failed to clear storage:', error);
    }

    this.notifyStateChange();
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshTokens(): Promise<AuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    // If refresh is already in progress, return that promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();
    
    try {
      const newTokens = await this.refreshPromise;
      this.refreshPromise = null;
      return newTokens;
    } catch (error) {
      this.refreshPromise = null;
      throw error;
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async performTokenRefresh(): Promise<AuthTokens> {
    try {
      const response = await this.client.post('/auth/refresh', {
        refreshToken: this.tokens!.refreshToken,
      });

      const newTokens: AuthTokens = {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
      };

      await this.setTokens(newTokens);
      return newTokens;
    } catch (error) {
      // Refresh failed, clear all tokens
      await this.logout();
      throw this.formatError(error);
    }
  }

  /**
   * Set tokens and persist to storage
   */
  private async setTokens(newTokens: AuthTokens): Promise<void> {
    this.tokens = newTokens;
    
    try {
      await AsyncStorage.setItem(this.storageKey, JSON.stringify(newTokens));
    } catch (error) {
      console.warn('[OxyAuth] Failed to persist tokens:', error);
    }
  }

  /**
   * Fetch current user profile
   */
  private async fetchCurrentUser(): Promise<void> {
    try {
      const response = await this.client.get('/auth/me');
      this.user = response.data.data || response.data;
    } catch (error) {
      console.warn('[OxyAuth] Failed to fetch current user:', error);
      // Don't throw here, we can still function without user profile
    }
  }

  /**
   * Get current authentication state
   */
  getAuthState(): AuthState {
    return {
      isAuthenticated: !!(this.tokens?.accessToken),
      user: this.user,
      tokens: this.tokens,
    };
  }

  /**
   * Get current user (loads if not cached)
   */
  async getCurrentUser(): Promise<any> {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated');
    }

    if (!this.user) {
      await this.fetchCurrentUser();
    }

    return this.user;
  }

  /**
   * Subscribe to authentication state changes
   */
  onAuthStateChange(callback: (state: AuthState) => void): () => void {
    this.listeners.push(callback);
    
    // Immediately call with current state
    callback(this.getAuthState());
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyStateChange(): void {
    const state = this.getAuthState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[OxyAuth] Listener error:', error);
      }
    });
  }

  /**
   * Format error responses consistently
   */
  private formatError(error: any): Error {
    if (error?.response?.data?.message) {
      return new Error(error.response.data.message);
    }
    
    if (error?.message) {
      return new Error(error.message);
    }
    
    return new Error('An unexpected error occurred');
  }

  /**
   * Get authenticated HTTP client for making API calls
   */
  getClient(): AxiosInstance {
    return this.client;
  }

  /**
   * Check username availability
   */
  async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
    try {
      const response = await this.client.get(`/auth/check-username/${encodeURIComponent(username)}`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError?.response?.status === 400) {
        return (axiosError.response as any).data;
      }
      throw this.formatError(error);
    }
  }

  /**
   * Check email availability
   */
  async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
    try {
      const response = await this.client.post('/auth/check-email', { email });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError?.response?.status === 400) {
        return (axiosError.response as any).data;
      }
      throw this.formatError(error);
    }
  }
}

// Global auth manager instance
let globalAuthManager: AuthenticationManager | null = null;

/**
 * Initialize global authentication manager
 */
export function initializeAuth(baseURL: string): AuthenticationManager {
  if (!globalAuthManager) {
    globalAuthManager = new AuthenticationManager(baseURL);
  }
  return globalAuthManager;
}

/**
 * Get global authentication manager instance
 */
export function getAuthManager(): AuthenticationManager {
  if (!globalAuthManager) {
    throw new Error('Authentication manager not initialized. Call initializeAuth() first.');
  }
  return globalAuthManager;
}