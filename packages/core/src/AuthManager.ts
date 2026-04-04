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
import type { SessionLoginResponse, MinimalUserData } from './models/session';
import { retryAsync } from './utils/asyncUtils';
import { jwtDecode } from 'jwt-decode';

/**
 * OxyServices already declares revokeFedCMCredential via mixin type augmentation.
 * This alias is kept for readability in the signOut method.
 */
type OxyServicesWithFedCM = OxyServices;

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
  /** Enable cross-tab coordination via BroadcastChannel (default: true in browsers) */
  crossTabSync?: boolean;
}

/**
 * Messages sent between tabs via BroadcastChannel for token refresh coordination.
 */
interface CrossTabMessage {
  type: 'refresh_starting' | 'tokens_refreshed' | 'signed_out';
  sessionId?: string;
  timestamp: number;
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
  FEDCM_LOGIN_HINT: 'oxy_fedcm_login_hint',
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
  private refreshPromise: Promise<boolean> | null = null;
  private config: Required<Omit<AuthManagerConfig, 'crossTabSync'>> & { crossTabSync: boolean };

  /** Tracks the access token this instance last knew about, for cross-tab adoption. */
  private _lastKnownAccessToken: string | null = null;

  /** BroadcastChannel for coordinating token refreshes across browser tabs. */
  private _broadcastChannel: BroadcastChannel | null = null;

  /** Set to true when another tab broadcasts a successful refresh, so this tab can skip its own. */
  private _otherTabRefreshed = false;

  constructor(oxyServices: OxyServices, config: AuthManagerConfig = {}) {
    this.oxyServices = oxyServices;
    const crossTabSync = config.crossTabSync ?? (typeof BroadcastChannel !== 'undefined');
    this.config = {
      storage: config.storage ?? this.getDefaultStorage(),
      autoRefresh: config.autoRefresh ?? true,
      refreshBuffer: config.refreshBuffer ?? 5 * 60 * 1000, // 5 minutes
      crossTabSync,
    };
    this.storage = this.config.storage;

    // Persist tokens to storage when HttpService refreshes them automatically
    this.oxyServices.httpService.onTokenRefreshed = (accessToken: string) => {
      this._lastKnownAccessToken = accessToken;
      this.storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
    };

    // Setup cross-tab coordination in browser environments
    if (this.config.crossTabSync) {
      this._initBroadcastChannel();
    }
  }

  /**
   * Initialize BroadcastChannel for cross-tab token refresh coordination.
   * Only called in browser environments where BroadcastChannel is available.
   */
  private _initBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    try {
      this._broadcastChannel = new BroadcastChannel('oxy_auth_sync');
      this._broadcastChannel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
        this._handleCrossTabMessage(event.data);
      };
    } catch {
      // BroadcastChannel not supported or blocked (e.g., opaque origins)
      this._broadcastChannel = null;
    }
  }

  /**
   * Handle messages from other tabs about token refresh activity.
   */
  private async _handleCrossTabMessage(message: CrossTabMessage): Promise<void> {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'tokens_refreshed': {
        // Another tab successfully refreshed. Signal to cancel our pending refresh.
        this._otherTabRefreshed = true;

        // Adopt the new tokens from shared storage
        const newToken = await this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        if (newToken && newToken !== this._lastKnownAccessToken) {
          this._lastKnownAccessToken = newToken;
          this.oxyServices.httpService.setTokens(newToken);

          // Re-read session for updated expiry and schedule next refresh
          const sessionJson = await this.storage.getItem(STORAGE_KEYS.SESSION);
          if (sessionJson) {
            try {
              const session = JSON.parse(sessionJson);
              if (session.expiresAt && this.config.autoRefresh) {
                this.setupTokenRefresh(session.expiresAt);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
        break;
      }

      case 'signed_out': {
        // Another tab signed out. Clear our local state to stay consistent.
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = null;
        }
        this.refreshPromise = null;
        this._lastKnownAccessToken = null;
        this.oxyServices.httpService.setTokens('');
        this.currentUser = null;
        this.notifyListeners();
        break;
      }
      // 'refresh_starting' is informational; we don't need to act on it currently
    }
  }

  /**
   * Broadcast a message to other tabs.
   */
  private _broadcast(message: CrossTabMessage): void {
    try {
      this._broadcastChannel?.postMessage(message);
    } catch {
      // Channel closed or unavailable
    }
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
      this._lastKnownAccessToken = session.accessToken;
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

    // Store user only if it has valid required fields (not an empty placeholder)
    if (session.user && typeof (session.user as any).id === 'string' && (session.user as any).id.length > 0) {
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
   * Refresh the access token. Deduplicates concurrent calls so only one
   * refresh request is in-flight at a time.
   */
  async refreshToken(): Promise<boolean> {
    // If a refresh is already in-flight, return the same promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._doRefreshToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async _doRefreshToken(): Promise<boolean> {
    // Reset the cross-tab flag before starting
    this._otherTabRefreshed = false;

    // Get session info to find sessionId for token refresh
    const sessionJson = await this.storage.getItem(STORAGE_KEYS.SESSION);
    if (!sessionJson) {
      return false;
    }

    let sessionId: string;
    try {
      const session = JSON.parse(sessionJson);
      sessionId = session.sessionId;
      if (!sessionId) return false;
    } catch (err) {
      console.error('AuthManager: Failed to parse session from storage.', err);
      return false;
    }

    // Record the token we know about before attempting refresh
    const tokenBeforeRefresh = this._lastKnownAccessToken;

    // Broadcast that we're starting a refresh (informational for other tabs)
    this._broadcast({ type: 'refresh_starting', sessionId, timestamp: Date.now() });

    try {
      await retryAsync(
        async () => {
          // Before each attempt, check if another tab already refreshed
          if (this._otherTabRefreshed) {
            const adoptedToken = await this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
            if (adoptedToken && adoptedToken !== tokenBeforeRefresh) {
              // Another tab succeeded. Adopt its tokens and short-circuit.
              this._lastKnownAccessToken = adoptedToken;
              this.oxyServices.httpService.setTokens(adoptedToken);
              return;
            }
          }

          const httpService = this.oxyServices.httpService as HttpService;
          // Use session-based token endpoint which handles auto-refresh server-side
          const response = await httpService.request<{ accessToken: string; expiresAt: string }>({
            method: 'GET',
            url: `/session/token/${sessionId}`,
            cache: false,
            retry: false,
          });

          if (!response.accessToken) {
            throw new Error('No access token in refresh response');
          }

          // Update access token in storage and HTTP client
          this._lastKnownAccessToken = response.accessToken;
          await this.storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, response.accessToken);
          this.oxyServices.httpService.setTokens(response.accessToken);

          // Update session expiry and schedule next refresh
          if (response.expiresAt) {
            try {
              const session = JSON.parse(sessionJson);
              session.expiresAt = response.expiresAt;
              await this.storage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
            } catch (err) {
              // Ignore parse errors for session update, but log for debugging.
              console.error('AuthManager: Failed to re-save session after token refresh.', err);
            }

            if (this.config.autoRefresh) {
              this.setupTokenRefresh(response.expiresAt);
            }
          }

          // Broadcast success so other tabs can adopt these tokens
          this._broadcast({ type: 'tokens_refreshed', sessionId, timestamp: Date.now() });
        },
        2,    // 2 retries = 3 total attempts
        1000, // 1s base delay with exponential backoff + jitter
        (error: any) => {
          // Don't retry on 4xx client errors (invalid/revoked token)
          const status = error?.status ?? error?.response?.status;
          if (status && status >= 400 && status < 500) return false;
          return true;
        }
      );
      return true;
    } catch {
      // All retry attempts exhausted. Before clearing the session, check if
      // another tab managed to refresh successfully while we were retrying.
      // Since all tabs share the same storage (localStorage), a successful
      // refresh from another tab will have written a different access token.
      const currentStoredToken = await this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      if (currentStoredToken && currentStoredToken !== tokenBeforeRefresh) {
        // Another tab refreshed successfully. Adopt its tokens instead of logging out.
        this._lastKnownAccessToken = currentStoredToken;
        this.oxyServices.httpService.setTokens(currentStoredToken);

        // Restore user from storage in case it was updated
        const userJson = await this.storage.getItem(STORAGE_KEYS.USER);
        if (userJson) {
          try {
            this.currentUser = JSON.parse(userJson);
          } catch {
            // Ignore parse errors
          }
        }

        // Re-read session expiry and schedule next refresh
        const updatedSessionJson = await this.storage.getItem(STORAGE_KEYS.SESSION);
        if (updatedSessionJson) {
          try {
            const session = JSON.parse(updatedSessionJson);
            if (session.expiresAt && this.config.autoRefresh) {
              this.setupTokenRefresh(session.expiresAt);
            }
          } catch {
            // Ignore parse errors
          }
        }
        return true;
      }

      // No other tab rescued us -- truly clear the session
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
    // Clear refresh timer and cancel any in-flight refresh
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshPromise = null;

    // Invalidate current session on the server (best-effort)
    try {
      const sessionJson = await this.storage.getItem(STORAGE_KEYS.SESSION);
      if (sessionJson) {
        const session = JSON.parse(sessionJson);
        if (session.sessionId && typeof (this.oxyServices as any).logoutSession === 'function') {
          await (this.oxyServices as any).logoutSession(session.sessionId);
        }
      }
    } catch {
      // Best-effort: don't block local signout on network failure
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
    this._lastKnownAccessToken = null;

    // Clear storage
    await this.clearSession();

    // Notify other tabs so they also sign out
    this._broadcast({ type: 'signed_out', timestamp: Date.now() });

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
    await this.storage.removeItem(STORAGE_KEYS.FEDCM_LOGIN_HINT);
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
   * Get a valid access token, refreshing automatically if expired or expiring soon.
   */
  async getAccessToken(): Promise<string | null> {
    const token = await this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (!token) return null;

    try {
      const decoded = jwtDecode<{ exp?: number }>(token);
      if (decoded.exp) {
        const now = Math.floor(Date.now() / 1000);
        const buffer = 60; // refresh 60 seconds before expiry
        if (decoded.exp - now < buffer) {
          const refreshed = await this.refreshToken();
          if (refreshed) {
            return this.storage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
          }
        }
      }
    } catch {
      // Decode failed — return token as-is, let the server decide
    }

    return token;
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
        this._lastKnownAccessToken = token;
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

    // Close BroadcastChannel
    if (this._broadcastChannel) {
      try {
        this._broadcastChannel.close();
      } catch {
        // Ignore close errors
      }
      this._broadcastChannel = null;
    }
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
