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
import type {
  RefreshAllAccount,
  RefreshAllAccountUser,
  RefreshAllResponse,
  RefreshCookieResponse,
  User,
} from './models/interfaces';
import type {
  AuthManagerAccount,
  RestoreFromCookiesResult,
  RestoreFromCookiesOptions,
  SwitchAuthuserResult,
} from './AuthManagerTypes';
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
  /**
   * "Cookie-only" mode for web apps that rely exclusively on the
   * `oxy_rt_${authuser}` httpOnly refresh cookies and refuse to fall back
   * to the legacy localStorage token/refresh-token path.
   *
   * - `false` (default): `initialize()` tries `restoreFromCookies()` first;
   *   if no accounts are restored it falls back to the legacy localStorage
   *   path (`oxy_access_token` / `oxy_session`).
   * - `true`: `initialize()` ONLY uses `restoreFromCookies()`. No token /
   *   refresh-token / session JSON is read from or written to localStorage.
   *   This is the secure default for apps that ship the cookie path end-to-
   *   end and want to guarantee no tokens leak to JS-accessible storage.
   */
  cookieOnly?: boolean;
}

/**
 * Messages sent between tabs via BroadcastChannel for token refresh coordination.
 *
 * Legacy bearer-path messages (`refresh_starting`, `tokens_refreshed`,
 * `signed_out`) coexist with the multi-account cookie-path messages
 * (`accounts_restored`, `authuser_switched`, `authuser_signed_out`,
 * `all_signed_out`). The handler ignores unknown types defensively so a
 * mismatched-version sibling tab can't crash this one.
 *
 * Every outgoing message also carries the sender tab's `tabId` and `nonce`
 * (see `_broadcastNonce` / `_tabId` on AuthManager). The receiver records the
 * first (tabId, nonce) pair it sees from each tab and rejects any subsequent
 * message from the same tabId that does not present the same nonce — a
 * best-effort gate against forged broadcasts from a same-origin XSS payload.
 */
interface CrossTabMessage {
  type:
    | 'refresh_starting'
    | 'tokens_refreshed'
    | 'signed_out'
    | 'accounts_restored'
    | 'authuser_switched'
    | 'authuser_signed_out'
    | 'all_signed_out';
  sessionId?: string;
  /** Slot index for `authuser_*` events; absent on legacy bearer events. */
  authuser?: number;
  timestamp: number;
  /** Sender-tab identifier (random hex, generated at AuthManager construction). */
  tabId: string;
  /** Sender-tab nonce (random hex, generated at AuthManager construction). */
  nonce: string;
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
  /**
   * Persisted active `authuser` slot index for the cookie path. Stores ONLY
   * the integer slot index (e.g. `"0"`, `"1"`), never a token or session
   * id — that lives in the httpOnly `oxy_rt_${n}` cookie. Used so that a
   * cold-boot `restoreFromCookies()` lands on the user's last-chosen slot
   * instead of always defaulting to the lowest authuser.
   */
  ACTIVE_AUTHUSER: 'oxy_active_authuser',
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
  private config: Required<Omit<AuthManagerConfig, 'crossTabSync' | 'cookieOnly'>> & {
    crossTabSync: boolean;
    cookieOnly: boolean;
  };

  /** Tracks the access token this instance last knew about, for cross-tab adoption. */
  private _lastKnownAccessToken: string | null = null;

  /** BroadcastChannel for coordinating token refreshes across browser tabs. */
  private _broadcastChannel: BroadcastChannel | null = null;

  /** Set to true when another tab broadcasts a successful refresh, so this tab can skip its own. */
  private _otherTabRefreshed = false;

  /**
   * Identifier for this AuthManager instance (≈ "this tab"). Random hex
   * generated at construction; advertised in every outgoing broadcast and
   * used as the lookup key in `_knownPeerNonces`.
   */
  private readonly _tabId: string = AuthManager._randomHex(16);

  /**
   * Per-tab nonce, advertised in every outgoing broadcast. Receivers record
   * the first (tabId, nonce) pair they see from a given peer; subsequent
   * messages from the same tabId MUST carry the same nonce or they're
   * ignored.
   *
   * Threat model: a same-origin XSS payload can post to the channel but can
   * NOT read this instance's private `_broadcastNonce` field (it lives in
   * closure, not on `window`). Forged broadcasts from XSS therefore can't
   * impersonate this tab. A new attacker-controlled tabId trips the
   * "first message from a new peer" branch, which is by definition trusted
   * — so the gate raises the bar but is not a complete defence (a perfect
   * mitigation would require message signing with a server-issued key).
   */
  private readonly _broadcastNonce: string = AuthManager._randomHex(16);

  /**
   * Bounded LRU of `(tabId → nonce)` pairs seen on inbound broadcasts. First
   * sighting of a new tabId records its nonce; later messages from that
   * tabId are rejected if the nonce doesn't match.
   */
  private readonly _knownPeerNonces: Map<string, string> = new Map();
  private static readonly _MAX_KNOWN_PEERS = 32;

  /**
   * In-flight `switchAuthuser` promise. Deduplicates concurrent calls so two
   * near-simultaneous switches don't both fire refresh requests and rotate
   * the slot twice. Mirrors the `refreshPromise` pattern used by
   * `refreshToken`.
   */
  private _switchPromise: Promise<SwitchAuthuserResult> | null = null;

  /**
   * Last `restoreFromCookies()` completion timestamp, keyed by the
   * AuthManager's active authuser at the time of completion. Used to gate
   * cross-tab cascade: a flurry of BroadcastChannel events from sibling
   * tabs can otherwise trigger N back-to-back snapshots and rotate every
   * slot's access token N times.
   */
  private readonly _lastRestoreAt: Map<number, number> = new Map();
  private static readonly _RESTORE_DEBOUNCE_MS = 2000;

  /**
   * In-memory registry of every device-local account the AuthManager knows
   * about, keyed by `authuser` slot index. Populated by:
   *   - `restoreFromCookies()` (cold boot)
   *   - `switchAuthuser()` (per-account rotation)
   *   - `handleAuthSuccess()` (fresh login when the server response carries
   *     an `authuser` field)
   * Access tokens live ONLY here in the cookie path — they are never
   * persisted to localStorage.
   */
  private accounts: Map<number, AuthManagerAccount> = new Map();

  /**
   * Currently-active `authuser` slot in the cookie path. `null` means either
   * the cookie path hasn't been initialised yet, or no slots are signed in.
   */
  private activeAuthuser: number | null = null;

  constructor(oxyServices: OxyServices, config: AuthManagerConfig = {}) {
    this.oxyServices = oxyServices;
    const crossTabSync = config.crossTabSync ?? (typeof BroadcastChannel !== 'undefined');
    this.config = {
      storage: config.storage ?? this.getDefaultStorage(),
      autoRefresh: config.autoRefresh ?? true,
      refreshBuffer: config.refreshBuffer ?? 5 * 60 * 1000, // 5 minutes
      crossTabSync,
      cookieOnly: config.cookieOnly ?? false,
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
    if (!this._acceptBroadcast(message)) return;

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

      case 'accounts_restored':
      case 'authuser_switched':
      case 'authuser_signed_out': {
        // Another tab restored/switched/dropped a slot. The authoritative
        // state lives in the httpOnly cookies which we can't read from JS,
        // so the cleanest reaction is to re-run `restoreFromCookies()` on
        // a microtask and re-sync our in-memory registry. We swallow
        // failures: a transient network error must not bring down a tab
        // that already had a valid session.
        //
        // The restoreFromCookies() body owns the per-slot debounce so a
        // burst of N broadcasts only costs one /auth/refresh-all rotation
        // (instead of N back-to-back rotations of every cookie slot).
        Promise.resolve().then(() => {
          this.restoreFromCookies().catch(() => {
            // Best-effort; existing accounts (if any) remain intact.
          });
        });
        break;
      }

      case 'all_signed_out': {
        // Mirror `signed_out` but also wipe the cookie-path registry.
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = null;
        }
        this.refreshPromise = null;
        this.accounts.clear();
        this.activeAuthuser = null;
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
   * Broadcast a message to other tabs. Always stamps this tab's `tabId` and
   * `nonce` onto the message so receivers can run the cross-tab nonce gate.
   */
  private _broadcast(message: Omit<CrossTabMessage, 'tabId' | 'nonce'>): void {
    const stamped: CrossTabMessage = {
      ...message,
      tabId: this._tabId,
      nonce: this._broadcastNonce,
    };
    try {
      this._broadcastChannel?.postMessage(stamped);
    } catch {
      // Channel closed or unavailable
    }
  }

  /**
   * Generate `bytes` bytes of cryptographic randomness encoded as lowercase
   * hex. Prefers Web Crypto's `getRandomValues` when available (browser /
   * modern Node); falls back to `Math.random` ONLY in environments without
   * Web Crypto (the resulting nonce is still unguessable to a same-origin
   * XSS payload — the goal is unforgeability across tabs, not cryptographic
   * secrecy across the network).
   */
  private static _randomHex(bytes: number): string {
    const buffer = new Uint8Array(bytes);
    const gcrypto: Crypto | undefined =
      typeof globalThis !== 'undefined'
        ? (globalThis as { crypto?: Crypto }).crypto
        : undefined;
    if (gcrypto && typeof gcrypto.getRandomValues === 'function') {
      gcrypto.getRandomValues(buffer);
    } else {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.floor(Math.random() * 256);
      }
    }
    let hex = '';
    for (const byte of buffer) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * Validate an inbound broadcast against the cross-tab nonce gate.
   *
   * Returns `true` when the message should be honoured, `false` when it
   * MUST be ignored:
   *   - Message is missing `tabId` or `nonce` → ignore (forged or
   *     mismatched-version sibling tab).
   *   - First sighting of `tabId` → record the nonce and honour the message
   *     (trust-on-first-use, the best we can do without a shared secret).
   *   - Subsequent message from the same `tabId` with the SAME nonce →
   *     honour.
   *   - Subsequent message from the same `tabId` with a DIFFERENT nonce →
   *     ignore (the canonical "forged broadcast" case — a same-origin XSS
   *     payload can't read the real tab's `_broadcastNonce`).
   *
   * Echoes of this tab's own broadcasts (same `tabId`) are also dropped so
   * we don't react to our own messages.
   */
  private _acceptBroadcast(message: CrossTabMessage | null | undefined): boolean {
    if (!message || typeof message.tabId !== 'string' || typeof message.nonce !== 'string') {
      return false;
    }
    if (message.tabId === this._tabId) {
      // Same-tab echo. Some BroadcastChannel implementations deliver our own
      // posts back to us; never act on those.
      return false;
    }
    const seen = this._knownPeerNonces.get(message.tabId);
    if (seen === undefined) {
      // Trust-on-first-use. Bound the map to avoid unbounded growth from a
      // tab-id sprayer.
      if (this._knownPeerNonces.size >= AuthManager._MAX_KNOWN_PEERS) {
        const oldest = this._knownPeerNonces.keys().next().value;
        if (oldest !== undefined) {
          this._knownPeerNonces.delete(oldest);
        }
      }
      this._knownPeerNonces.set(message.tabId, message.nonce);
      return true;
    }
    return seen === message.nonce;
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
   * Initialize auth state on app startup.
   *
   * Order of operations:
   *   1. Try the cookie path via `restoreFromCookies()`. This is the
   *      preferred path because the httpOnly refresh cookies are
   *      cross-tab, persist across hard reloads, and don't expose any
   *      refresh-token material to JS.
   *   2. If the cookie path yielded zero accounts AND `cookieOnly` is
   *      `false`, fall back to the legacy localStorage path
   *      (`oxy_access_token` / `oxy_session`) for backwards compatibility
   *      with apps that haven't migrated to the cookie endpoint yet.
   *   3. If `cookieOnly` is `true`, skip the legacy fallback entirely.
   *      This guarantees no tokens or refresh tokens are ever read from
   *      or written to JS-accessible storage.
   *
   * Returns the active user on success, or `null` when neither path
   * restored a session.
   */
  async initialize(options: RestoreFromCookiesOptions = {}): Promise<MinimalUserData | null> {
    // 1. Cookie path (preferred). Forward the optional cold-boot fail-fast
    // timeout so a cross-domain stall cannot hang provider init.
    const cookieResult = await this.restoreFromCookies(options);
    if (cookieResult.accounts.length > 0) {
      return this.currentUser;
    }

    // 2. Legacy localStorage path (opt-out via `cookieOnly`).
    if (this.config.cookieOnly) {
      return null;
    }

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

  // -------------------------------------------------------------------------
  // Multi-account cookie path (Google-style multi-sign-in).
  // -------------------------------------------------------------------------
  // The cookie path is web-only and orthogonal to the legacy bearer path
  // above: it never touches the `oxy_access_token` / `oxy_refresh_token` /
  // `oxy_session` localStorage keys, because the refresh token lives in the
  // httpOnly `oxy_rt_${authuser}` cookies and access tokens live in
  // `this.accounts` (in-memory only). The only localStorage key the cookie
  // path writes is `STORAGE_KEYS.ACTIVE_AUTHUSER` — a small integer that is
  // explicitly NOT a secret.
  //
  // Apps that want to opt out of the legacy localStorage path entirely
  // (recommended for new web apps) pass `cookieOnly: true` to the
  // AuthManager config; in that mode `initialize()` ONLY uses the cookie
  // path.
  // -------------------------------------------------------------------------

  /**
   * Read the persisted active `authuser` slot index. Returns `null` when
   * none is persisted, the value is corrupt, or the storage adapter has no
   * record. Storage failures are non-fatal: the cookie path falls back to
   * "lowest authuser" deterministic selection.
   */
  private async readActiveAuthuser(): Promise<number | null> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEYS.ACTIVE_AUTHUSER);
      if (raw === null || raw === undefined) return null;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Persist the active `authuser` slot index. No-ops on storage failure
   * (e.g. Safari private mode, native SecureStore unavailable) — this is
   * best-effort UX persistence, not authoritative state.
   */
  private async writeActiveAuthuser(authuser: number): Promise<void> {
    if (!Number.isFinite(authuser) || authuser < 0) return;
    try {
      await this.storage.setItem(STORAGE_KEYS.ACTIVE_AUTHUSER, String(authuser));
    } catch {
      // Best-effort.
    }
  }

  /**
   * Clear the persisted active `authuser` so the next cold boot starts from
   * a clean slate (used on full sign-out).
   */
  private async clearActiveAuthuser(): Promise<void> {
    try {
      await this.storage.removeItem(STORAGE_KEYS.ACTIVE_AUTHUSER);
    } catch {
      // Best-effort.
    }
  }

  /**
   * Build a `MinimalUserData` from a `RefreshAllAccount`. Returns `null` when
   * the wire entry has no user shape (legacy `/auth/refresh` fallback) — the
   * AuthManager's caller is expected to hydrate via `/users/me` in that
   * case.
   */
  private static toMinimalUser(account: RefreshAllAccount): MinimalUserData | null {
    if (!account.user) return null;
    return {
      id: account.user.id,
      username: account.user.username,
      avatar: account.user.avatar ?? undefined,
    };
  }

  /**
   * Hydrate the user shape for a slot whose AuthManagerAccount currently has
   * `user: null` (legacy refresh fallback, or a switch onto a previously
   * unknown slot). Calls `/users/me` with the slot's freshly-planted access
   * token already on the HTTP client; merges the result back into the
   * registry entry. Network failures are non-fatal — the slot remains with
   * `user: null` and the UI is expected to render the public-key fallback
   * handle until a later restore picks the real user shape up.
   */
  private async _hydrateUnknownUser(authuser: number): Promise<void> {
    const oxy = this.oxyServices as OxyServices & {
      getCurrentUser?: () => Promise<User>;
    };
    if (typeof oxy.getCurrentUser !== 'function') return;

    let me: User;
    try {
      me = await oxy.getCurrentUser();
    } catch {
      // Best-effort: keep `user: null` and let the UI fall back to the
      // public-key handle.
      return;
    }

    const existing = this.accounts.get(authuser);
    if (!existing) return;

    const hydrated: RefreshAllAccountUser = {
      id: me.id,
      username: me.username,
      name: typeof me.name === 'string' ? me.name : undefined,
      avatar: me.avatar ?? null,
      email: me.email,
      color: me.color ?? null,
    };
    this.accounts.set(authuser, { ...existing, user: hydrated });

    // Mirror onto `currentUser` if this is the active slot.
    if (this.activeAuthuser === authuser) {
      this.currentUser = {
        id: hydrated.id,
        username: hydrated.username,
        avatar: hydrated.avatar ?? undefined,
      };
      this.notifyListeners();
    }
  }

  /**
   * Snapshot of the registered cookie-path accounts, sorted by `authuser`
   * ascending (canonical order). Mutating the returned array does not
   * affect AuthManager state.
   */
  getAccounts(): AuthManagerAccount[] {
    return Array.from(this.accounts.values()).sort((a, b) => a.authuser - b.authuser);
  }

  /**
   * The slot index that is currently active in the cookie path, or `null`
   * if the cookie path hasn't been initialised or no slots are signed in.
   */
  getActiveAuthuser(): number | null {
    return this.activeAuthuser;
  }

  /**
   * Convenience: the AuthManagerAccount currently flagged active.
   */
  getActiveAccount(): AuthManagerAccount | null {
    if (this.activeAuthuser === null) return null;
    return this.accounts.get(this.activeAuthuser) ?? null;
  }

  /**
   * Restore every device-local account from the httpOnly refresh cookies.
   *
   * Calls `oxyServices.refreshAllSessions()` (`POST /auth/refresh-all` with
   * `credentials: 'include'`). The server rotates every presented
   * `oxy_rt_${authuser}` cookie in parallel and returns one entry per
   * VALID slot. The SDK transparently falls back to the legacy single-slot
   * `/auth/refresh` against older servers (handled inside
   * `refreshAllSessions`).
   *
   * Plants the active account's access token on the shared HTTP client;
   * sibling slots' tokens stay in the in-memory registry so a later
   * `switchAuthuser()` can hot-swap them without a network round-trip.
   *
   * The persisted `oxy_active_authuser` slot wins when it matches a
   * returned account; otherwise the lowest returned `authuser` is chosen
   * deterministically.
   *
   * Returns `{ accounts: [], activeAuthuser: null }` on any failure or
   * empty snapshot — callers treat that as "no signed-in accounts" and
   * proceed unauthenticated. State is NOT cleared on failure; existing
   * accounts (if any) remain intact.
   */
  async restoreFromCookies(options: RestoreFromCookiesOptions = {}): Promise<RestoreFromCookiesResult> {
    // Cross-tab cascade debounce. If we restored within the last
    // _RESTORE_DEBOUNCE_MS for the currently-active slot, skip the network
    // round-trip and return the cached registry verbatim. A burst of N
    // BroadcastChannel events from sibling tabs therefore costs at most one
    // /auth/refresh-all rotation. Cold-boot calls (activeAuthuser still
    // null) always run because the cache hasn't been seeded yet.
    if (this.activeAuthuser !== null) {
      const last = this._lastRestoreAt.get(this.activeAuthuser);
      if (last !== undefined && Date.now() - last < AuthManager._RESTORE_DEBOUNCE_MS) {
        return {
          accounts: this.getAccounts(),
          activeAuthuser: this.activeAuthuser,
        };
      }
    }

    let snapshot: RefreshAllResponse;
    try {
      // Forward the optional cold-boot fail-fast timeout. Undefined (the warm
      // cross-tab cascade default) preserves the wait-indefinitely behaviour.
      snapshot = await this.oxyServices.refreshAllSessions({ timeout: options.timeout });
    } catch {
      return { accounts: [], activeAuthuser: null };
    }

    if (snapshot.accounts.length === 0) {
      return { accounts: [], activeAuthuser: null };
    }

    // Replace the registry wholesale: the server's snapshot is authoritative.
    this.accounts.clear();
    for (const account of snapshot.accounts) {
      this.accounts.set(account.authuser, {
        authuser: account.authuser,
        sessionId: account.sessionId,
        user: account.user,
        accessToken: account.accessToken,
        expiresAt: account.expiresAt,
      });
    }

    // Pick the active slot: persisted `oxy_active_authuser` wins if it
    // matches a returned account; otherwise the lowest returned authuser
    // (the snapshot is already sorted ascending, so accounts[0] is the
    // lowest).
    const persisted = await this.readActiveAuthuser();
    const active = (persisted !== null && this.accounts.has(persisted))
      ? persisted
      : snapshot.accounts[0].authuser;

    this.activeAuthuser = active;
    const activeAccount = this.accounts.get(active);
    const slotsNeedingHydration: number[] = [];
    if (activeAccount) {
      this._lastKnownAccessToken = activeAccount.accessToken;
      this.oxyServices.httpService.setTokens(activeAccount.accessToken);
      this.currentUser = AuthManager.toMinimalUser({
        authuser: activeAccount.authuser,
        accessToken: activeAccount.accessToken,
        expiresAt: activeAccount.expiresAt,
        sessionId: activeAccount.sessionId,
        user: activeAccount.user,
      });
      await this.writeActiveAuthuser(active);

      // Schedule auto-refresh on the active slot so the in-memory access
      // token doesn't silently expire under the user.
      if (this.config.autoRefresh) {
        this.setupCookieRefresh(activeAccount.expiresAt, active);
      }

      // The legacy /auth/refresh fallback yields user=null for the active
      // slot. Schedule a /users/me hydration so the chooser isn't stuck on
      // the public-key handle. Hydration is fire-and-forget — the snapshot
      // is already considered "restored" once the access token is planted.
      if (activeAccount.user === null) {
        slotsNeedingHydration.push(activeAccount.authuser);
      }
    }

    this._lastRestoreAt.set(active, Date.now());
    this._broadcast({ type: 'accounts_restored', timestamp: Date.now() });
    this.notifyListeners();

    for (const slot of slotsNeedingHydration) {
      void this._hydrateUnknownUser(slot);
    }

    return {
      accounts: this.getAccounts(),
      activeAuthuser: this.activeAuthuser,
    };
  }

  /**
   * Switch the active account to a different device-local slot.
   *
   * Calls `oxyServices.refreshTokenViaCookie({ authuser })` to mint a fresh
   * access token from the slot's httpOnly cookie, updates the in-memory
   * registry entry, plants the token on the HTTP client, persists the new
   * active slot, and broadcasts cross-tab.
   *
   * Throws when the slot's refresh cookie is missing / expired / reused
   * (the SDK returns `null` from `refreshTokenViaCookie` in that case, and
   * we surface it as an `Error` so callers can clean up the slot from
   * their UI).
   */
  async switchAuthuser(authuser: number): Promise<SwitchAuthuserResult> {
    // Concurrency gate. Two near-simultaneous switchAuthuser calls would
    // otherwise both POST /auth/refresh?authuser=N, rotating the slot's
    // refresh-token family twice and racing on the registry update. The
    // gate is keyed only by "any switch in flight" — switching to a
    // DIFFERENT slot while a switch is in flight returns the in-flight
    // promise (callers can re-issue once it settles if they really meant a
    // different slot).
    if (this._switchPromise) {
      return this._switchPromise;
    }
    this._switchPromise = this._doSwitchAuthuser(authuser);
    try {
      return await this._switchPromise;
    } finally {
      this._switchPromise = null;
    }
  }

  private async _doSwitchAuthuser(authuser: number): Promise<SwitchAuthuserResult> {
    const refreshed: RefreshCookieResponse | null = await this.oxyServices.refreshTokenViaCookie({ authuser });
    if (refreshed === null) {
      // Drop the dead slot from our registry so the chooser doesn't keep
      // offering it; callers can drive a `restoreFromCookies()` to
      // re-sync.
      this.accounts.delete(authuser);
      if (this.activeAuthuser === authuser) {
        this.activeAuthuser = null;
      }
      throw new Error(`Refresh cookie for authuser=${authuser} is missing or expired`);
    }

    // Update (or insert) the slot in the registry. We preserve any user
    // metadata we already knew from a prior `restoreFromCookies` — the
    // single-slot refresh endpoint does NOT re-project the user shape. When
    // we have no prior metadata, we leave `user: null` and schedule a
    // /users/me hydration below.
    const existing = this.accounts.get(authuser);
    const decoded = AuthManager.decodeSessionIdFromAccessToken(refreshed.accessToken);
    const sessionId = decoded ?? existing?.sessionId ?? '';
    const updated: AuthManagerAccount = {
      authuser,
      sessionId,
      user: existing?.user ?? null,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    this.accounts.set(authuser, updated);

    this.activeAuthuser = authuser;
    this._lastKnownAccessToken = refreshed.accessToken;
    this.oxyServices.httpService.setTokens(refreshed.accessToken);
    this.currentUser = updated.user
      ? {
          id: updated.user.id,
          username: updated.user.username,
          avatar: updated.user.avatar ?? undefined,
        }
      : null;
    await this.writeActiveAuthuser(authuser);

    if (this.config.autoRefresh) {
      this.setupCookieRefresh(refreshed.expiresAt, authuser);
    }

    this._broadcast({ type: 'authuser_switched', authuser, timestamp: Date.now() });
    this.notifyListeners();

    if (updated.user === null) {
      // Fire-and-forget hydration: the switch is considered complete once
      // the token is planted, the UI uses getAccountFallbackHandle (public-
      // key fallback) until /users/me resolves.
      void this._hydrateUnknownUser(authuser);
    }

    return {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      authuser,
    };
  }

  /**
   * Sign out a single device-local slot.
   *
   * Calls `oxyServices.logoutSessionByAuthuser(authuser)`: server-side
   * revokes the slot's refresh-token family and clears the
   * `oxy_rt_${authuser}` cookie via `Set-Cookie`. The slot is removed from
   * the in-memory registry. If the slot was active, the next lowest
   * remaining authuser becomes active (or `null` when none remain).
   */
  async signOutAuthuser(authuser: number): Promise<void> {
    try {
      await this.oxyServices.logoutSessionByAuthuser(authuser);
    } catch {
      // Best-effort: the server-side logout is idempotent on unknown
      // tokens, and we'd rather drop the slot locally than leave dead
      // state on a network blip.
    }

    this.accounts.delete(authuser);

    if (this.activeAuthuser === authuser) {
      const remaining = this.getAccounts();
      if (remaining.length > 0) {
        // Pick the lowest remaining authuser as the new active. We don't
        // proactively refresh its token here — callers can drive
        // `switchAuthuser` if they need a fresh bearer. This keeps the
        // method's network footprint to exactly one request.
        const next = remaining[0];
        this.activeAuthuser = next.authuser;
        this._lastKnownAccessToken = next.accessToken;
        this.oxyServices.httpService.setTokens(next.accessToken);
        this.currentUser = next.user
          ? {
              id: next.user.id,
              username: next.user.username,
              avatar: next.user.avatar ?? undefined,
            }
          : null;
        await this.writeActiveAuthuser(next.authuser);
        if (next.user === null) {
          void this._hydrateUnknownUser(next.authuser);
        }
      } else {
        this.activeAuthuser = null;
        this._lastKnownAccessToken = null;
        this.oxyServices.httpService.setTokens('');
        this.currentUser = null;
        await this.clearActiveAuthuser();
      }
    }

    this._broadcast({ type: 'authuser_signed_out', authuser, timestamp: Date.now() });
    this.notifyListeners();
  }

  /**
   * Sign out EVERY device-local account on this device.
   *
   * Calls `oxyServices.logoutAllSessionsViaCookie()`: server-side revokes
   * every presented family and `Set-Cookie`s an immediate expiry for every
   * recognised `oxy_rt_${n}` slot AND the legacy `oxy_rt` cookie. The
   * in-memory registry is wiped, the active slot is cleared, and the
   * persisted `oxy_active_authuser` is removed so the next cold boot
   * starts fresh.
   */
  async signOutAllViaCookies(): Promise<void> {
    try {
      await this.oxyServices.logoutAllSessionsViaCookie();
    } catch {
      // Best-effort; server-side endpoint is idempotent.
    }

    this.accounts.clear();
    this.activeAuthuser = null;
    this._lastKnownAccessToken = null;
    this.oxyServices.httpService.setTokens('');
    this.currentUser = null;
    this._lastRestoreAt.clear();
    await this.clearActiveAuthuser();

    // Also clear the refresh timer that the cookie path may have scheduled.
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    this._broadcast({ type: 'all_signed_out', timestamp: Date.now() });
    this.notifyListeners();
  }

  /**
   * Schedule an auto-refresh for the cookie path on the active slot. Reuses
   * the same single `refreshTimer` as the legacy path (the AuthManager has
   * exactly ONE active slot at a time, so one timer suffices).
   */
  private setupCookieRefresh(expiresAt: string, authuser: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) return;

    const refreshAt = expiresAtMs - this.config.refreshBuffer;
    const delay = Math.max(0, refreshAt - Date.now());

    this.refreshTimer = setTimeout(() => {
      // Only refresh if this slot is still the active one when the timer
      // fires (the user might have switched in the meantime).
      if (this.activeAuthuser !== authuser) return;
      this.switchAuthuser(authuser).catch(() => {
        // A failed cookie refresh on the active slot means the user must
        // re-auth; surface via `notifyListeners` indirectly when the slot
        // is dropped from the registry by `switchAuthuser`.
      });
    }, delay);
  }

  /**
   * Decode the session id from an unverified JWT access token. Decode-only
   * (no signature verification) — the server already verified the
   * signature when minting the token. Returns `null` on malformed input.
   */
  private static decodeSessionIdFromAccessToken(token: string): string | null {
    try {
      const decoded = jwtDecode<{ sessionId?: string }>(token);
      return typeof decoded.sessionId === 'string' && decoded.sessionId.length > 0
        ? decoded.sessionId
        : null;
    } catch {
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
    this._knownPeerNonces.clear();
    this._lastRestoreAt.clear();
    this._switchPromise = null;
    this.refreshPromise = null;

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
