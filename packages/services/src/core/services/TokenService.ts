/**
 * TokenService - Single Source of Truth for Token Management
 * 
 * Handles all token storage, retrieval, refresh, and validation.
 * Used by HttpService, SocketService, and other services that need tokens.
 * 
 * Architecture:
 * - Single storage location (no duplication)
 * - Automatic token refresh when expiring soon
 * - Type-safe token payload handling
 * - userId is always MongoDB ObjectId, never publicKey
 */

import { jwtDecode } from 'jwt-decode';

/**
 * AccessTokenPayload - Matches the token payload structure from API
 * userId is always MongoDB ObjectId (24 hex characters), never publicKey
 */
interface AccessTokenPayload {
  userId: string;      // MongoDB ObjectId - PRIMARY IDENTIFIER
  sessionId: string;   // Session UUID
  deviceId: string;   // Device identifier
  type: 'access';
  iat?: number;        // Issued at (added by JWT)
  exp?: number;        // Expiration (added by JWT)
}

interface TokenStore {
  accessToken: string | null;
  refreshToken: string | null;
}

/**
 * TokenService - Singleton pattern for global token management
 */
class TokenService {
  private static instance: TokenService;
  private tokenStore: TokenStore = {
    accessToken: null,
    refreshToken: null,
  };
  private refreshPromise: Promise<void> | null = null;
  private baseURL: string | null = null;

  private constructor() {}

  static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }

  /**
   * Initialize TokenService with base URL for refresh requests
   */
  initialize(baseURL: string): void {
    this.baseURL = baseURL;
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return this.tokenStore.accessToken;
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | null {
    return this.tokenStore.refreshToken;
  }

  /**
   * Set tokens (called after login or token refresh)
   */
  setTokens(accessToken: string, refreshToken: string = ''): void {
    this.tokenStore.accessToken = accessToken;
    this.tokenStore.refreshToken = refreshToken || this.tokenStore.refreshToken;
  }

  /**
   * Clear all tokens (called on logout)
   */
  clearTokens(): void {
    this.tokenStore.accessToken = null;
    this.tokenStore.refreshToken = null;
    this.refreshPromise = null;
  }

  /**
   * Check if access token exists
   */
  hasAccessToken(): boolean {
    return !!this.tokenStore.accessToken;
  }

  /**
   * Check if token is expiring soon (within 60 seconds)
   */
  isTokenExpiringSoon(): boolean {
    const token = this.tokenStore.accessToken;
    if (!token) return false;

    try {
      const decoded = jwtDecode<AccessTokenPayload>(token);
      if (!decoded.exp) return false;

      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp - currentTime < 60; // Expiring within 60 seconds
    } catch {
      return false;
    }
  }

  /**
   * Get userId from current access token
   * Returns MongoDB ObjectId (never publicKey)
   */
  getUserIdFromToken(): string | null {
    const token = this.tokenStore.accessToken;
    if (!token) return null;

    try {
      const decoded = jwtDecode<AccessTokenPayload>(token);
      return decoded.userId || null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh access token if expiring soon
   * Returns promise that resolves when token is refreshed (or already valid)
   */
  async refreshTokenIfNeeded(): Promise<void> {
    // If already refreshing, wait for that promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // If token not expiring soon, no refresh needed
    if (!this.isTokenExpiringSoon()) {
      return;
    }

    // Start refresh
    this.refreshPromise = this._performRefresh();
    
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Perform token refresh
   */
  private async _performRefresh(): Promise<void> {
    const token = this.tokenStore.accessToken;
    if (!token) {
      throw new Error('No access token to refresh');
    }

    try {
      const decoded = jwtDecode<AccessTokenPayload>(token);
      if (!decoded.sessionId) {
        throw new Error('Token missing sessionId');
      }

      if (!this.baseURL) {
        throw new Error('TokenService not initialized with baseURL');
      }

      const refreshUrl = `${this.baseURL}/api/session/token/${decoded.sessionId}`;
      
      const response = await fetch(refreshUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const { accessToken: newToken } = await response.json();
      
      if (!newToken) {
        throw new Error('No access token in refresh response');
      }

      // Validate new token has correct userId format (ObjectId)
      const newDecoded = jwtDecode<AccessTokenPayload>(newToken);
      if (newDecoded.userId && !/^[0-9a-fA-F]{24}$/.test(newDecoded.userId)) {
        throw new Error(`Invalid userId format in refreshed token: ${newDecoded.userId.substring(0, 20)}...`);
      }

      this.setTokens(newToken);
    } catch (error) {
      // Clear tokens on refresh failure (likely expired or invalid)
      this.clearTokens();
      throw error;
    }
  }

  /**
   * Get authorization header with automatic refresh
   */
  async getAuthHeader(): Promise<string | null> {
    // Refresh if needed
    await this.refreshTokenIfNeeded().catch(() => {
      // Ignore refresh errors, will use current token or return null
    });

    const token = this.tokenStore.accessToken;
    return token ? `Bearer ${token}` : null;
  }
}

// Export singleton instance
export const tokenService = TokenService.getInstance();

