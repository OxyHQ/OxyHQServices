import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import type { SessionLoginResponse } from '../models/session';

export interface RedirectAuthOptions {
  redirectUri?: string;
  mode?: 'login' | 'signup';
  preserveUrl?: boolean;
}

/**
 * Redirect-based Cross-Domain Authentication Mixin
 *
 * Implements traditional OAuth2 redirect flow as a fallback when popup or
 * FedCM are not available or fail (e.g., mobile browsers, popup blockers).
 *
 * Flow:
 * 1. Save current URL
 * 2. Redirect to auth.oxy.so/login
 * 3. User signs in
 * 4. Redirect back with token in URL
 * 5. Extract token, restore session, clean URL
 *
 * Features:
 * - Works on all browsers (including old mobile browsers)
 * - Automatic URL cleanup after auth
 * - State preservation option
 * - CSRF protection via state parameter
 *
 * Trade-offs:
 * - Loses JavaScript app state (full page navigation)
 * - Visible redirect (user sees navigation)
 * - Slower perceived performance
 */
export function OxyServicesRedirectAuthMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
  public static readonly AUTH_URL = 'https://auth.oxy.so';
  public static readonly TOKEN_STORAGE_KEY = 'oxy_access_token';
  public static readonly SESSION_STORAGE_KEY = 'oxy_session_id';
  public static readonly STATE_STORAGE_KEY = 'oxy_auth_state';
  public static readonly PRE_AUTH_URL_KEY = 'oxy_pre_auth_url';
  public static readonly NONCE_STORAGE_KEY = 'oxy_auth_nonce';

  /**
   * Sign in using full page redirect
   *
   * Redirects the user to auth.oxy.so for authentication. After successful
   * sign-in, the user will be redirected back to the current page (or custom
   * redirect URI) with authentication tokens in the URL.
   *
   * Call handleAuthCallback() on app startup to complete the flow.
   *
   * @param options - Redirect configuration options
   *
   * @example
   * ```typescript
   * // Initiate sign-in
   * const handleSignIn = () => {
   *   oxyServices.signInWithRedirect();
   * };
   *
   * // Handle callback on app startup
   * useEffect(() => {
   *   const session = oxyServices.handleAuthCallback();
   *   if (session) {
   *     setUser(session.user);
   *   }
   * }, []);
   * ```
   */
  signInWithRedirect(options: RedirectAuthOptions = {}): void {
    if (typeof window === 'undefined') {
      throw new OxyAuthenticationError('Redirect authentication requires browser environment');
    }

    const redirectUri = options.redirectUri || window.location.href;
    const mode = options.mode || 'login';
    const state = this.generateState();
    const nonce = this.generateNonce();

    // Store state for CSRF protection
    this.storeAuthState(state, nonce);

    // Save current URL to restore after auth (optional)
    if (options.preserveUrl !== false) {
      this.savePreAuthUrl(window.location.href);
    }

    const authUrl = this.buildAuthUrl({
      mode,
      redirectUri,
      state,
      nonce,
      clientId: window.location.origin,
    });

    // Perform redirect
    window.location.href = authUrl;
  }

  /**
   * Sign up using full page redirect
   *
   * Same as signInWithRedirect but opens the signup page by default.
   */
  signUpWithRedirect(options: RedirectAuthOptions = {}): void {
    this.signInWithRedirect({ ...options, mode: 'signup' });
  }

  /**
   * Handle authentication callback
   *
   * Call this on app startup to check if the current page load is a
   * redirect back from the authentication server. If it is, this method
   * will extract the tokens, store them, and clean up the URL.
   *
   * @returns Session data if this is a callback, null otherwise
   * @throws {OxyAuthenticationError} If state validation fails (CSRF attack)
   *
   * @example
   * ```typescript
   * // In your app's root component or startup logic
   * useEffect(() => {
   *   try {
   *     const session = oxyServices.handleAuthCallback();
   *     if (session) {
   *       console.log('Logged in:', session.user);
   *       setUser(session.user);
   *     } else {
   *       // Not a callback, check for existing session
   *       const restored = oxyServices.restoreSession();
   *       if (!restored) {
   *         // No session, show login button
   *       }
   *     }
   *   } catch (error) {
   *     console.error('Auth callback failed:', error);
   *   }
   * }, []);
   * ```
   */
  handleAuthCallback(): SessionLoginResponse | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const url = new URL(window.location.href);
    const accessToken = url.searchParams.get('access_token');
    const sessionId = url.searchParams.get('session_id');
    const expiresAt = url.searchParams.get('expires_at');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    // Check if this is an error callback
    if (error) {
      this.clearAuthState();
      throw new OxyAuthenticationError(errorDescription || error);
    }

    // Check if this is an auth callback
    if (!accessToken || !sessionId) {
      return null; // Not a callback
    }

    // Verify state to prevent CSRF attacks
    const savedState = this.getStoredState();
    if (!savedState || state !== savedState) {
      this.clearAuthState();
      throw new OxyAuthenticationError('Invalid state parameter. Possible CSRF attack.');
    }

    // Store tokens
    this.storeTokens(accessToken, sessionId);
    this.httpService.setTokens(accessToken);

    // Build session response (minimal - we'll fetch full user data separately)
    const session: SessionLoginResponse = {
      sessionId,
      deviceId: '', // Not available in redirect flow
      expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      user: {} as any, // Will be fetched separately
    };

    // Clean up URL (remove auth parameters)
    this.cleanAuthCallbackUrl(url);

    // Clean up storage
    this.clearAuthState();

    return session;
  }

  /**
   * Restore session from storage
   *
   * Attempts to restore a previously authenticated session from localStorage.
   * Call this on app startup if handleAuthCallback() returns null.
   *
   * @returns True if session was restored, false otherwise
   *
   * @example
   * ```typescript
   * useEffect(() => {
   *   const session = oxyServices.handleAuthCallback();
   *   if (!session) {
   *     const restored = oxyServices.restoreSession();
   *     if (!restored) {
   *       // No session, user needs to sign in
   *       setShowLogin(true);
   *     }
   *   }
   * }, []);
   * ```
   */
  restoreSession(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    const token = localStorage.getItem((this.constructor as any).TOKEN_STORAGE_KEY);
    const sessionId = localStorage.getItem((this.constructor as any).SESSION_STORAGE_KEY);

    if (token && sessionId) {
      this.httpService.setTokens(token);
      return true;
    }

    return false;
  }

  /**
   * Clear stored session
   *
   * Removes all authentication data from storage. Call this on logout.
   */
  clearStoredSession(): void {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.removeItem((this.constructor as any).TOKEN_STORAGE_KEY);
    localStorage.removeItem((this.constructor as any).SESSION_STORAGE_KEY);
    this.httpService.clearTokens();
  }

  /**
   * Get stored session ID
   */
  getStoredSessionId(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return localStorage.getItem((this.constructor as any).SESSION_STORAGE_KEY);
  }

  /**
   * Build authentication URL with query parameters
   *
   * @private
   */
  public buildAuthUrl(params: {
    mode: string;
    redirectUri: string;
    state: string;
    nonce: string;
    clientId: string;
  }): string {
    const url = new URL(`${(this.constructor as any).AUTH_URL}/${params.mode}`);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('response_type', 'token');
    return url.toString();
  }

  /**
   * Store tokens in localStorage
   *
   * @private
   */
  public storeTokens(accessToken: string, sessionId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem((this.constructor as any).TOKEN_STORAGE_KEY, accessToken);
    localStorage.setItem((this.constructor as any).SESSION_STORAGE_KEY, sessionId);
  }

  /**
   * Generate cryptographically secure state for CSRF protection
   *
   * @private
   */
  public generateState(): string {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generate nonce for replay attack prevention
   *
   * @private
   */
  public generateNonce(): string {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Store auth state in session storage
   *
   * @private
   */
  public storeAuthState(state: string, nonce: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    sessionStorage.setItem((this.constructor as any).STATE_STORAGE_KEY, state);
    sessionStorage.setItem((this.constructor as any).NONCE_STORAGE_KEY, nonce);
  }

  /**
   * Get stored state
   *
   * @private
   */
  public getStoredState(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return sessionStorage.getItem((this.constructor as any).STATE_STORAGE_KEY);
  }

  /**
   * Clear auth state from storage
   *
   * @private
   */
  public clearAuthState(): void {
    if (typeof window === 'undefined') {
      return;
    }

    sessionStorage.removeItem((this.constructor as any).STATE_STORAGE_KEY);
    sessionStorage.removeItem((this.constructor as any).NONCE_STORAGE_KEY);
    sessionStorage.removeItem((this.constructor as any).PRE_AUTH_URL_KEY);
  }

  /**
   * Save pre-authentication URL to restore later
   *
   * @private
   */
  public savePreAuthUrl(url: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    sessionStorage.setItem((this.constructor as any).PRE_AUTH_URL_KEY, url);
  }

  /**
   * Clean authentication parameters from URL
   *
   * @private
   */
  public cleanAuthCallbackUrl(url: URL): void {
    // Remove auth parameters
    url.searchParams.delete('access_token');
    url.searchParams.delete('session_id');
    url.searchParams.delete('expires_at');
    url.searchParams.delete('state');
    url.searchParams.delete('nonce');
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');

    // Update URL without reloading page
    window.history.replaceState({}, '', url.toString());
  }
  };
}

// Export the mixin function as both named and default
export { OxyServicesRedirectAuthMixin as RedirectAuthMixin };
