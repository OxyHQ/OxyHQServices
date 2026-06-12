/**
 * Cross-Domain Authentication Helper
 *
 * Provides a simplified API for cross-domain SSO authentication that automatically
 * selects the best authentication method based on browser capabilities:
 *
 * 1. FedCM (if supported) - Modern, Google-style browser-native auth
 * 2. Popup (fallback) - OAuth2-style popup window
 * 3. Redirect (final fallback) - Traditional full-page redirect
 *
 * Usage:
 * ```typescript
 * import { CrossDomainAuth } from '@oxyhq/core';
 *
 * const auth = new CrossDomainAuth(oxyServices);
 *
 * // Automatic method selection
 * const session = await auth.signIn();
 *
 * // Or use specific method
 * const session = await auth.signInWithPopup();
 * ```
 */

import type { OxyServices } from './OxyServices';
import type { SessionLoginResponse } from './models/session';

export interface CrossDomainAuthOptions {
  /**
   * Preferred authentication method
   * - 'auto': Automatically select best method (default)
   * - 'fedcm': Use FedCM (browser-native)
   * - 'popup': Use popup window
   * - 'redirect': Use full-page redirect
   */
  method?: 'auto' | 'fedcm' | 'popup' | 'redirect';

  /**
   * Custom redirect URI (for redirect method)
   */
  redirectUri?: string;

  /**
   * Whether to open signup page instead of login
   */
  isSignup?: boolean;

  /**
   * Popup window dimensions (for popup method)
   */
  popupDimensions?: {
    width?: number;
    height?: number;
  };

  /**
   * Callback when auth method is selected
   */
  onMethodSelected?: (method: 'fedcm' | 'popup' | 'redirect') => void;

  /**
   * A popup window the caller already opened SYNCHRONOUSLY in the user-gesture
   * handler. Forwarded to `OxyServices.signInWithPopup` so the popup is not
   * blocked by Chrome after any prior `await` (FedCM / silent SSO) has
   * consumed the transient user activation. See `OxyServices.openBlankPopup`.
   */
  popup?: Window | null;
}

export class CrossDomainAuth {
  constructor(private oxyServices: OxyServices) {}

  /**
   * Sign in with automatic method selection
   *
   * Tries methods in this order:
   * 1. FedCM (if supported and not in private browsing)
   * 2. Popup (if not blocked)
   * 3. Redirect (always works)
   *
   * @param options - Authentication options
   * @returns Session with user data and access token
   */
  async signIn(options: CrossDomainAuthOptions = {}): Promise<SessionLoginResponse | null> {
    const method = options.method || 'auto';

    // If specific method requested, use it directly. The caller MAY have
    // pre-opened a popup on the raw click (the standard pattern in
    // WebOxyProvider / services useAuth). For the FedCM and redirect paths
    // that popup is unused — close it so it doesn't linger as an orphaned
    // blank window. Close in both success and failure paths.
    if (method === 'fedcm') {
      try {
        const session = await this.signInWithFedCM(options);
        this.closeOrphanPopup(options.popup);
        return session;
      } catch (error) {
        this.closeOrphanPopup(options.popup);
        throw error;
      }
    }

    if (method === 'popup') {
      return this.signInWithPopup(options);
    }

    if (method === 'redirect') {
      this.closeOrphanPopup(options.popup);
      this.signInWithRedirect(options);
      return null; // Redirect doesn't return immediately
    }

    // Auto mode: Try methods in order of preference
    return this.autoSignIn(options);
  }

  /**
   * Close a caller-supplied popup window that is no longer needed (e.g. the
   * resolved auth method didn't end up using it). Safe against null / already
   * closed handles.
   *
   * @private
   */
  private closeOrphanPopup(popup: Window | null | undefined): void {
    if (popup && !popup.closed) {
      popup.close();
    }
  }

  /**
   * Automatic sign-in with progressive enhancement
   *
   * @private
   */
  private async autoSignIn(options: CrossDomainAuthOptions): Promise<SessionLoginResponse | null> {
    // 1. Try FedCM first (best UX, most modern)
    if (this.isFedCMSupported()) {
      try {
        options.onMethodSelected?.('fedcm');
        const session = await this.signInWithFedCM(options);
        // FedCM succeeded — close the pre-opened popup so it doesn't linger
        // as an orphaned blank window.
        this.closeOrphanPopup(options.popup);
        return session;
      } catch (error) {
        console.warn('[CrossDomainAuth] FedCM failed, trying popup...', error);
      }
    }

    // 2. Try popup (good UX, widely supported)
    try {
      options.onMethodSelected?.('popup');
      return await this.signInWithPopup(options);
    } catch (error) {
      console.warn('[CrossDomainAuth] Popup failed, falling back to redirect...', error);
      // Popup path failed — close the pre-opened popup before redirecting.
      this.closeOrphanPopup(options.popup);
    }

    // 3. Fallback to redirect (always works)
    options.onMethodSelected?.('redirect');
    this.signInWithRedirect(options);
    return null;
  }

  /**
   * Sign in using FedCM (Federated Credential Management)
   *
   * Best method - browser-native, no popups, Google-like experience
   */
  async signInWithFedCM(options: CrossDomainAuthOptions = {}): Promise<SessionLoginResponse> {
    return this.oxyServices.signInWithFedCM({
      context: options.isSignup ? 'signup' : 'signin',
    });
  }

  /**
   * Sign in using popup window
   *
   * Good method - preserves app state, no full page reload
   */
  async signInWithPopup(options: CrossDomainAuthOptions = {}): Promise<SessionLoginResponse> {
    return this.oxyServices.signInWithPopup({
      mode: options.isSignup ? 'signup' : 'login',
      width: options.popupDimensions?.width,
      height: options.popupDimensions?.height,
      popup: options.popup ?? undefined,
    });
  }

  /**
   * Sign in using full-page redirect
   *
   * Fallback method - works everywhere but loses app state
   */
  signInWithRedirect(options: CrossDomainAuthOptions = {}): void {
    this.oxyServices.signInWithRedirect({
      redirectUri: options.redirectUri,
      mode: options.isSignup ? 'signup' : 'login',
    });
  }

  /**
   * Handle redirect callback
   *
   * Call this on app startup to check if we're returning from auth redirect
   */
  handleRedirectCallback(): SessionLoginResponse | null {
    return this.oxyServices.handleAuthCallback();
  }

  /**
   * Silent sign-in (check for existing session)
   *
   * Tries to automatically sign in without user interaction.
   * Works with both FedCM and popup/iframe methods.
   *
   * @returns Session if user is already signed in, null otherwise
   */
  async silentSignIn(): Promise<SessionLoginResponse | null> {
    // Try FedCM silent sign-in first (if supported)
    if (this.isFedCMSupported()) {
      try {
        const session = await this.oxyServices.silentSignInWithFedCM();
        if (session) {
          return session;
        }
      } catch (error) {
        console.warn('[CrossDomainAuth] FedCM silent sign-in failed:', error);
      }
    }

    // Fallback to iframe-based silent auth
    try {
      return await this.oxyServices.silentSignIn();
    } catch (error) {
      console.warn('[CrossDomainAuth] Silent sign-in failed:', error);
      return null;
    }
  }

  /**
   * Restore session from storage
   *
   * For redirect method - restores previously authenticated session from localStorage
   */
  restoreSession(): boolean {
    return this.oxyServices.restoreSession?.() || false;
  }

  /**
   * Open a blank popup SYNCHRONOUSLY (call from a raw user-gesture handler
   * BEFORE any `await`). Returns `null` if the popup was blocked. Pass the
   * handle into `signIn({ popup })` / `signInWithPopup({ popup })` so the
   * popup is not blocked by Chrome after any prior `await` consumed the
   * transient user activation. Delegates to `OxyServices.openBlankPopup`.
   */
  openBlankPopup(width?: number, height?: number): Window | null {
    return this.oxyServices.openBlankPopup(width, height);
  }

  /**
   * Check if FedCM is supported in current browser
   */
  isFedCMSupported(): boolean {
    // FedCM support is exposed both as a static and an instance method on
    // OxyServices; the instance method is reliable across mixin composition.
    return this.oxyServices.isFedCMSupported?.() || false;
  }

  /**
   * Get recommended authentication method for current environment
   *
   * @returns Recommended method name and reason
   */
  getRecommendedMethod(): { method: 'fedcm' | 'popup' | 'redirect'; reason: string } {
    if (this.isFedCMSupported()) {
      return {
        method: 'fedcm',
        reason: 'FedCM is supported - provides best UX with browser-native auth',
      };
    }

    if (typeof window !== 'undefined') {
      return {
        method: 'popup',
        reason: 'Browser environment - popup preserves app state',
      };
    }

    return {
      method: 'redirect',
      reason: 'Fallback method - works in all environments',
    };
  }

  /**
   * Initialize cross-domain auth on app startup
   *
   * This handles:
   * 1. Redirect callback (if returning from auth.oxy.so)
   * 2. Session restoration (from localStorage)
   * 3. Silent sign-in (check for existing SSO session)
   *
   * @returns Session if user is authenticated, null otherwise
   */
  async initialize(): Promise<SessionLoginResponse | null> {
    // 1. Check if this is a redirect callback
    const callbackSession = this.handleRedirectCallback();
    if (callbackSession) {
      return callbackSession;
    }

    // 2. Try to restore existing session from storage
    const restored = this.restoreSession();
    if (restored) {
      // Verify session is still valid by fetching user
      try {
        const user = await this.oxyServices.getCurrentUser();
        if (user) {
          return {
            sessionId: this.oxyServices.getStoredSessionId?.() || '',
            deviceId: '',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            user,
          };
        }
      } catch (error) {
        console.warn('[CrossDomainAuth] Stored session invalid:', error);
      }
    }

    // 3. Try silent sign-in (check for SSO session at auth.oxy.so)
    return await this.silentSignIn();
  }
}

/**
 * Helper function to create CrossDomainAuth instance
 *
 * @example
 * ```typescript
 * import { createCrossDomainAuth } from '@oxyhq/core';
 *
 * const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
 * const auth = createCrossDomainAuth(oxyServices);
 *
 * // On app startup
 * const session = await auth.initialize();
 * if (session) {
 *   console.log('User is signed in:', session.user);
 * }
 *
 * // Sign in button click
 * const session = await auth.signIn();
 * ```
 */
export function createCrossDomainAuth(oxyServices: OxyServices): CrossDomainAuth {
  return new CrossDomainAuth(oxyServices);
}
