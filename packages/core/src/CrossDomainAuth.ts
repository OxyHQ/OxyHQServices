/**
 * Cross-Domain Authentication Helper
 *
 * Provides a simplified API for cross-domain SSO authentication that automatically
 * selects the best authentication method based on browser capabilities:
 *
 * 1. FedCM (if supported) - Modern, Google-style browser-native auth
 * 2. Redirect (fallback) - Tokenless central SSO full-page redirect
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
   * Sign in with automatic method selection
   *
   * Tries methods in this order:
   * 1. FedCM (if supported and not in private browsing)
   * 2. Redirect (always works)
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
   * Automatic sign-in with progressive enhancement
   *
   * @private
   */
  private async autoSignIn(options: CrossDomainAuthOptions): Promise<SessionLoginResponse | null> {
    // 1. Try FedCM first (best UX, most modern)
    if (this.isFedCMSupported()) {
      try {
        options.onMethodSelected?.('fedcm');
        return await this.signInWithFedCM(options);
      } catch (error) {
        logger.warn('FedCM failed, falling back to redirect', { component: 'CrossDomainAuth', method: 'autoSignIn' }, error);
      }
    }

    // 2. Fallback to redirect (always works)
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
   * Tries to automatically sign in without user interaction.
   * Works with FedCM and iframe-based silent auth.
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
        logger.debug('FedCM silent sign-in did not resolve', { component: 'CrossDomainAuth', method: 'silentSignIn' }, error);
      }
    }

    // Fallback to iframe-based silent auth
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
   * @returns Recommended method name and reason
   */
  getRecommendedMethod(): { method: 'fedcm' | 'redirect'; reason: string } {
    if (this.isFedCMSupported()) {
      return {
        method: 'fedcm',
        reason: 'FedCM is supported - provides best UX with browser-native auth',
      };
    }

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
