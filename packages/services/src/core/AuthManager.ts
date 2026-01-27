/**
 * AuthManager - Centralized Authentication Manager
 *
 * Provides a unified authentication interface for all platforms.
 * Handles token storage, session management, and auth state changes.
 *
 * @module core/AuthManager
 */

import type { OxyServices } from './OxyServices';
import type { HttpService } from './HttpService';
import type { SessionLoginResponse, MinimalUserData } from '../models/session';

/**
 * OxyServices with optional FedCM methods (provided by FedCM mixin).
 */
interface OxyServicesWithFedCM extends OxyServices {
  revokeFedCMCredential?: () => Promise<void>;
}

/**
 * Storage adapter interface for platform-agnostic storage.
 */
export interface StorageAdapter {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
}

/**
 * Auth state change callback type.
 */
export type AuthStateChangeCallback = (user: MinimalUserData | null) => void;

/**
 * Auth method types.
 */
export type AuthMethod = 'fedcm' | 'popup' | 'redirect' | 'credentials' | 'identity';

/**
 * Auth manager configuration.
 */
export interface AuthManagerConfig {
  /** Storage adapter (localStorage, AsyncStorage, etc.) */
  storage?: StorageAdapter;
  /** Whether to auto-refresh tokens */
  autoRefresh?: boolean;
  /** Token refresh interval in milliseconds (default: 5 minutes before expiry) */
  refreshBuffer?: number;
}

/**
 * Storage keys used by AuthManager.
 */
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'oxy_access_token',
  REFRESH_TOKEN: 'oxy_refresh_token',
  SESSION: 'oxy_session',
  USER: 'oxy_user',
  AUTH_METHOD: 'oxy_auth_method',
} as const;

/**
 * Default in-memory storage for non-browser environments.
 */
class MemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Browser localStorage adapter.
 */
class LocalStorageAdapter implements StorageAdapter {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage full or blocked
    }
  }

  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
  }
}

/**
 * AuthManager - Centralized authentication management.
 *
 * Provides a single point of control for:
 * - Token storage and retrieval
 * - Session management
 * - Auth state change notifications
 * - Multiple auth method support
 *
 * @example
 * ```typescript
 * const authManager = new AuthManager(oxyServices);
 *
 * // Listen for auth changes
 * authManager.onAuthStateChange((user) => {
 *   console.log('Auth state changed:', user);
 * });
 *
 * // Handle successful auth
 * await authManager.handleAuthSuccess(session);
 *
 * // Sign out
 * await authManager.signOut();
 * ```
 */
export class AuthManager {
  private oxyServices: OxyServices;
  private storage: StorageAdapter;
  private listeners: Set<AuthStateChangeCallback> = new Set();
  private currentUser: MinimalUserData | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private config: Required<AuthManagerConfig>;

  constructor(oxyServices: OxyServices, config: AuthManagerConfig = {}) {
    this.oxyServices = oxyServices;
    this.config = {
      storage: config.storage ?? this.getDefaultStorage(),
      autoRefresh: config.autoRefresh ?? true,
      refreshBuffer: config.refreshBuffer ?? 5 * 60 * 1000, // 5 minutes
    };
    this.storage = this.config.storage;
  }

  /**
   * Get default storage based on environment.
   */
  private getDefaultStorage(): StorageAdapter {
    if (typeof window !== 'undefined' && window.localStorage) {
      return new LocalStorageAdapter();
    }
    return new MemoryStorage();
  }

  /**
   * Subscribe to auth state changes.
   *
   * @param callback - Function called when auth state changes
   * @returns Unsubscribe function
   */
  onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    this.listeners.add(callback);
    // Call immediately with current state
    callback(this.currentUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of auth state change.
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentUser);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Handle successful authentication.
   *
   * @param session - Session response from auth
   * @param method - Auth method used
   */
  async handleAuthSuccess(
    session: SessionLoginResponse,
    method: AuthMethod = 'credentials'
  ): Promise<void> {
    // Store tokens
    if (session.accessToken) {
      await this.storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
      this.oxyServices.httpService.setTokens(session.accessToken);
    }

    // Store refresh token if available
    if (session.refreshToken) {
      await this.storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, session.refreshToken);
    }

    // Store session info
    await this.storage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      expiresAt: session.expiresAt,
    }));

    // Store user
    if (session.user) {
      await this.storage.setItem(STORAGE_KEYS.USER, JSON.stringify(session.user));
      this.currentUser = session.user;
    }

    // Store auth method
    await this.storage.setItem(STORAGE_KEYS.AUTH_METHOD, method);

    // Setup auto-refresh if enabled
    if (this.config.autoRefresh && session.expiresAt) {
      this.setupTokenRefresh(session.expiresAt);
    }

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Setup automatic token refresh.
   */
  private setupTokenRefresh(expiresAt: string): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const expiresAtMs = new Date(expiresAt).getTime();
    const now = Date.now();
    const refreshAt = expiresAtMs - this.config.refreshBuffer;
    const delay = Math.max(0, refreshAt - now);

    if (delay > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshToken().catch(() => {
          // Refresh failed, user will need to re-auth
        });
      }, delay);
    }
  }

  /**
   * Refresh the access token.
   */
  async refreshToken(): Promise<boolean> {
    const refreshToken = await this.storage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      return false;
    }

    try {
      // Cast httpService to proper type (needed due to mixin composition)
      const httpService = this.oxyServices.httpService as HttpService;
      const response = await httpService.request<SessionLoginResponse>({
        method: 'POST',
        url: '/api/auth/refresh',
        data: { refreshToken },
        cache: false,
      });

      await this.handleAuthSuccess(response, 'credentials');
      return true;
    } catch {
      // Refresh failed, clear session and update state
      await this.clearSession();
      this.currentUser = null;
      this.notifyListeners();
      return false;
    }
  }

  /**
   * Sign out and clear all auth data.
   */
  async signOut(): Promise<void> {
    // Clear refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Revoke FedCM credential if supported
    try {
      const services = this.oxyServices as OxyServicesWithFedCM;
      if (services.revokeFedCMCredential) {
        await services.revokeFedCMCredential();
      }
    } catch {
      // Ignore FedCM errors
    }

    // Clear HTTP client tokens
    this.oxyServices.httpService.setTokens('');

    // Clear storage
    await this.clearSession();

    // Update state and notify
    this.currentUser = null;
    this.notifyListeners();
  }

  /**
   * Clear session data from storage.
   */
  private async clearSession(): Promise<void> {
    await this.storage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    await this.storage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    await this.storage.removeItem(STORAGE_KEYS.SESSION);
    await this.storage.removeItem(STORAGE_KEYS.USER);
    await this.storage.removeItem(STORAGE_KEYS.AUTH_METHOD);
  }

  /**
   * Get current user.
   */
  getCurrentUser(): MinimalUserData | null {
    return this.currentUser;
  }

  /**
   * Check if user is authenticated.
   */
  isAuthenticated(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Get stored access token.
   */
  async getAccessToken(): Promise<string | null> {
    return this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  }

  /**
   * Get the auth method used for current session.
   */
  async getAuthMethod(): Promise<AuthMethod | null> {
    const method = await this.storage.getItem(STORAGE_KEYS.AUTH_METHOD);
    return method as AuthMethod | null;
  }

  /**
   * Initialize auth state from storage.
   *
   * Call this on app startup to restore previous session.
   */
  async initialize(): Promise<MinimalUserData | null> {
    try {
      // Try to restore user from storage
      const userJson = await this.storage.getItem(STORAGE_KEYS.USER);
      if (userJson) {
        this.currentUser = JSON.parse(userJson);
      }

      // Restore token to HTTP client
      const token = await this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      if (token) {
        this.oxyServices.httpService.setTokens(token);
      }

      // Check session expiry
      const sessionJson = await this.storage.getItem(STORAGE_KEYS.SESSION);
      if (sessionJson) {
        const session = JSON.parse(sessionJson);
        if (session.expiresAt) {
          const expiresAt = new Date(session.expiresAt).getTime();
          if (expiresAt <= Date.now()) {
            // Session expired, try refresh
            const refreshed = await this.refreshToken();
            if (!refreshed) {
              await this.clearSession();
              this.currentUser = null;
            }
          } else if (this.config.autoRefresh) {
            // Setup refresh timer
            this.setupTokenRefresh(session.expiresAt);
          }
        }
      }

      return this.currentUser;
    } catch {
      // Failed to restore, start fresh
      await this.clearSession();
      this.currentUser = null;
      return null;
    }
  }

  /**
   * Destroy the auth manager and clean up resources.
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.listeners.clear();
  }
}

/**
 * Create an AuthManager instance.
 *
 * @param oxyServices - OxyServices instance
 * @param config - Optional configuration
 * @returns AuthManager instance
 */
export function createAuthManager(
  oxyServices: OxyServices,
  config?: AuthManagerConfig
): AuthManager {
  return new AuthManager(oxyServices, config);
}
