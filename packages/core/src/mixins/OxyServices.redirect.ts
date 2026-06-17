import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import type { SessionLoginResponse } from '../models/session';
import {
  buildSsoBounceUrl,
  ssoAttemptedKey,
  ssoDestKey,
  ssoGuardKey,
  ssoStateKey,
} from '../utils/ssoBounce';

export interface RedirectAuthOptions {
  redirectUri?: string;
  mode?: 'login' | 'signup';
  preserveUrl?: boolean;
}

/**
 * Redirect-based authentication without bearer tokens in URLs.
 *
 * The redirect fallback now uses the same central SSO code-return contract as
 * cold boot: the RP stores CSRF/destination state in sessionStorage, navigates
 * to the central IdP, receives only an opaque one-time code in the URL fragment,
 * and the provider's `sso-return` step exchanges that code for the real session.
 */
export function OxyServicesRedirectAuthMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Start a full-page redirect through the central SSO flow.
     *
     * No access token, refresh token, or session id is ever put in the URL or
     * localStorage. The caller's provider must run `consumeSsoReturn` on startup
     * to complete the code exchange and commit the session.
     */
    signInWithRedirect(options: RedirectAuthOptions = {}): void {
      if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        throw new OxyAuthenticationError('Redirect authentication requires browser sessionStorage');
      }

      const origin = window.location.origin;
      const state = this.generateState();
      const destination = options.preserveUrl === false
        ? (options.redirectUri || origin)
        : (options.redirectUri || window.location.href);

      window.sessionStorage.setItem(ssoStateKey(origin), state);
      window.sessionStorage.setItem(ssoGuardKey(origin), String(Date.now()));
      window.sessionStorage.setItem(ssoDestKey(origin), destination);
      window.sessionStorage.setItem(ssoAttemptedKey(origin), '1');

      window.location.assign(buildSsoBounceUrl(origin, state, this.config.authWebUrl));
    }

    signUpWithRedirect(options: RedirectAuthOptions = {}): void {
      this.signInWithRedirect({ ...options, mode: 'signup' });
    }

    /**
     * Legacy token-query callbacks are intentionally rejected. Modern providers
     * complete redirect auth through `consumeSsoReturn`, which accepts only
     * `#oxy_sso=ok&code=...`.
     */
    handleAuthCallback(): SessionLoginResponse | null {
      if (typeof window === 'undefined') {
        return null;
      }

      const url = new URL(window.location.href);
      if (url.searchParams.has('access_token') || url.searchParams.has('session_id')) {
        this.cleanAuthCallbackUrl(url);
        throw new OxyAuthenticationError('Legacy access-token redirect callbacks are no longer accepted.');
      }

      return null;
    }

    restoreSession(): boolean {
      return false;
    }

    clearStoredSession(): void {
      this.httpService.clearTokens();
    }

    getStoredSessionId(): string | null {
      return null;
    }

    public generateState(): string {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      }
      throw new Error('No secure random source available for state generation');
    }

    public generateNonce(): string {
      return this.generateState();
    }

    public cleanAuthCallbackUrl(url: URL): void {
      url.searchParams.delete('access_token');
      url.searchParams.delete('session_id');
      url.searchParams.delete('expires_at');
      url.searchParams.delete('state');
      url.searchParams.delete('nonce');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      window.history.replaceState({}, '', url.toString());
    }
  };
}

export { OxyServicesRedirectAuthMixin as RedirectAuthMixin };
