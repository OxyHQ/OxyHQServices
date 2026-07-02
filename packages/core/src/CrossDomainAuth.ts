/**
 * Cross-Domain Authentication Helper
 *
 * Provides a simplified API for cross-domain SSO authentication. The
 * automatic sign-in path uses a full-page redirect through the central IdP
 * (`auth.oxy.so`) — a tokenless, universal mechanism that works in every
 * browser.
 *
 * FedCM (`signInWithFedCM`) is intentionally NOT part of the automatic
 * (`'auto'`) path: it is a Chrome-only browser API, and a misconfigured or
 * unreachable FedCM endpoint fails fast and silently, which — combined with a
 * caller's auth-guard effect re-invoking `signIn()` whenever the user is still
 * unauthenticated — produced a real production incident (an accelerating
 * `autoSignIn` → FedCM-fails → redirect retry loop). `signInWithFedCM` remains
 * available for callers that want to opt into it EXPLICITLY
 * (`signIn({ method: 'fedcm' })`).
 *
 * Usage:
 * ```typescript
 * import { CrossDomainAuth } from '@oxyhq/core';
 *
 * const auth = new CrossDomainAuth(oxyServices);
 *
 * // Automatic method selection (always redirect)
 * const session = await auth.signIn();
 *
 * // Or use a specific method
 * auth.signInWithRedirect();
 * ```
 */

import type { OxyServices } from './OxyServices';
import type { SessionLoginResponse } from './models/session';
import { logger } from './utils/loggerUtils';

export interface CrossDomainAuthOptions {
  /**
   * Preferred authentication method
   * - 'auto': Automatically select best method (default)
   * - 'fedcm': Use FedCM (browser-native)
   * - 'redirect': Use full-page redirect
   */
  method?: 'auto' | 'fedcm' | 'redirect';

  /**
   * Custom redirect URI (for redirect method)
   */
  redirectUri?: string;

  /**
   * Whether to open signup page instead of login
   */
  isSignup?: boolean;

  /**
   * Callback when auth method is selected
   */
  onMethodSelected?: (method: 'fedcm' | 'redirect') => void;
}

export class CrossDomainAuth {
  constructor(private oxyServices: OxyServices) {}

  /**
   * Sign in with automatic method selection.
   *
   * Auto mode always uses the full-page redirect (see the class doc comment
   * for why FedCM was removed from this path). Pass `{ method: 'fedcm' }` to
   * opt into FedCM explicitly.
   *
   * @param options - Authentication options
   * @returns Session with user data and access token
   */
  async signIn(options: CrossDomainAuthOptions = {}): Promise<SessionLoginResponse | null> {
    const method = options.method || 'auto';

    if (method === 'fedcm') {
      return this.signInWithFedCM(options);
    }

    if (method === 'redirect') {
      this.signInWithRedirect(options);
      return null; // Redirect doesn't return immediately
    }

    // Auto mode: try methods in order of preference.
    return this.autoSignIn(options);
  }

  /**
   * Automatic sign-in.
   *
   * Goes straight to the full-page redirect — the sole automatic method.
   * FedCM is deliberately NOT attempted here (see the class doc comment):
   * it is Chrome-only, and its fast/silent failure mode combined with a
   * caller's auth-guard effect re-invoking `signIn()` produced a real
   * production sign-in loop. Use `signIn({ method: 'fedcm' })` to opt in
   * explicitly.
   *
   * @private
   */
  private async autoSignIn(options: CrossDomainAuthOptions): Promise<SessionLoginResponse | null> {
    options.onMethodSelected?.('redirect');
    this.signInWithRedirect(options);
    return null;
  }

  /**
   * Sign in using FedCM (Federated Credential Management)
   *
   * Best method - browser-native, Google-like experience
   */
  async signInWithFedCM(options: CrossDomainAuthOptions = {}): Promise<SessionLoginResponse> {
    return this.oxyServices.signInWithFedCM({
      context: options.isSignup ? 'signup' : 'signin',
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
   * Tries to automatically sign in without user interaction, via the
   * iframe-based silent auth against the per-apex `/auth/silent` IdP host.
   * FedCM is deliberately NOT attempted here (see the class doc comment).
   *
   * @returns Session if user is already signed in, null otherwise
   */
  async silentSignIn(): Promise<SessionLoginResponse | null> {
    try {
      return await this.oxyServices.silentSignIn();
    } catch (error) {
      logger.debug('iframe silent sign-in did not resolve', { component: 'CrossDomainAuth', method: 'silentSignIn' }, error);
      return null;
    }
  }

  /**
   * Restore session from storage.
   *
   * Access tokens are no longer persisted in browser storage; providers restore
   * through refresh cookies / SSO code exchange instead.
   */
  restoreSession(): boolean {
    return false;
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
   * Redirect is the sole recommended automatic method — it works in every
   * browser, unlike FedCM (Chrome-only). Callers that want FedCM must opt in
   * explicitly via `signIn({ method: 'fedcm' })`.
   *
   * @returns Recommended method name and reason
   */
  getRecommendedMethod(): { method: 'redirect'; reason: string } {
    if (typeof window !== 'undefined') {
      return {
        method: 'redirect',
        reason: 'Browser environment - redirect SSO works without token callback URLs',
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
   * 2. Silent sign-in (check for existing SSO session)
   *
   * @returns Session if user is authenticated, null otherwise
   */
  async initialize(): Promise<SessionLoginResponse | null> {
    // 1. Check if this is a redirect callback
    const callbackSession = this.handleRedirectCallback();
    if (callbackSession) {
      return callbackSession;
    }

    // 2. Try silent sign-in (check for SSO session at auth.oxy.so)
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
