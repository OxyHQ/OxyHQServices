import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import type { SessionLoginResponse } from '../../models/session';

export interface FedCMAuthOptions {
  nonce?: string;
  context?: 'signin' | 'signup' | 'continue' | 'use';
}

export interface FedCMConfig {
  enabled: boolean;
  configURL: string;
  clientId?: string;
}

/**
 * Federated Credential Management (FedCM) Authentication Mixin
 *
 * Implements the modern browser-native identity federation API that enables
 * Google-style cross-domain authentication without third-party cookies.
 *
 * Browser Support:
 * - Chrome 108+
 * - Safari 16.4+
 * - Edge 108+
 * - Firefox: Not yet supported (fallback required)
 *
 * Key Features:
 * - No redirects or popups required
 * - Browser-native UI prompts
 * - Privacy-preserving (IdP can't track users)
 * - Automatic SSO across domains
 * - Silent re-authentication support
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/FedCM_API
 */
export function OxyServicesFedCMMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
  public static readonly DEFAULT_CONFIG_URL = 'https://auth.oxy.so/fedcm.json';
  public static readonly FEDCM_TIMEOUT = 60000; // 1 minute

  /**
   * Check if FedCM is supported in the current browser
   */
  static isFedCMSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return 'IdentityCredential' in window && 'navigator' in window && 'credentials' in navigator;
  }

  /**
   * Instance method to check FedCM support
   */
  isFedCMSupported(): boolean {
    return (this.constructor as typeof OxyServicesBase & { isFedCMSupported: () => boolean }).isFedCMSupported();
  }

  /**
   * Sign in using FedCM (Federated Credential Management API)
   *
   * This provides a Google-style authentication experience:
   * - Browser shows native "Sign in with Oxy" prompt
   * - No redirect or popup required
   * - User approves → credential exchange happens in browser
   * - All apps automatically get SSO after first sign-in
   *
   * @param options - Authentication options
   * @returns Session with access token and user data
   * @throws {OxyAuthenticationError} If FedCM not supported or user cancels
   *
   * @example
   * ```typescript
   * try {
   *   const session = await oxyServices.signInWithFedCM();
   *   console.log('Signed in:', session.user);
   * } catch (error) {
   *   // Fallback to popup or redirect auth
   *   await oxyServices.signInWithPopup();
   * }
   * ```
   */
  async signInWithFedCM(options: FedCMAuthOptions = {}): Promise<SessionLoginResponse> {
    if (!this.isFedCMSupported()) {
      throw new OxyAuthenticationError(
        'FedCM not supported in this browser. Please update your browser or use an alternative sign-in method.'
      );
    }

    try {
      const nonce = options.nonce || this.generateNonce();
      const clientId = this.getClientId();

      // Request credential from browser's native identity flow
      const credential = await this.requestIdentityCredential({
        configURL: (this.constructor as any).DEFAULT_CONFIG_URL,
        clientId,
        nonce,
        context: options.context,
      });

      if (!credential || !credential.token) {
        throw new OxyAuthenticationError('No credential received from browser');
      }

      // Exchange FedCM ID token for Oxy session
      const session = await this.exchangeIdTokenForSession(credential.token);

      // Store access token in HttpService (extract from response or get from session)
      if (session && (session as any).accessToken) {
        this.httpService.setTokens((session as any).accessToken);
      }

      return session;
    } catch (error) {
      if ((error as any).name === 'AbortError') {
        throw new OxyAuthenticationError('Sign-in was cancelled by user');
      }
      if ((error as any).name === 'NetworkError') {
        throw new OxyAuthenticationError('Network error during sign-in. Please check your connection.');
      }
      throw error;
    }
  }

  /**
   * Silent sign-in using FedCM
   *
   * Attempts to automatically re-authenticate the user without any UI.
   * This is what enables "instant sign-in" across all Oxy domains after
   * the user has signed in once.
   *
   * The browser will:
   * 1. Check if user has previously signed in to Oxy
   * 2. Check if user is still signed in at auth.oxy.so
   * 3. If yes, automatically provide credential without prompting
   *
   * @returns Session if user is already signed in, null otherwise
   *
   * @example
   * ```typescript
   * // On app startup
   * useEffect(() => {
   *   const checkAuth = async () => {
   *     const session = await oxyServices.silentSignInWithFedCM();
   *     if (session) {
   *       setUser(session.user);
   *     } else {
   *       // Show sign-in button
   *     }
   *   };
   *   checkAuth();
   * }, []);
   * ```
   */
  async silentSignInWithFedCM(): Promise<SessionLoginResponse | null> {
    if (!this.isFedCMSupported()) {
      return null;
    }

    try {
      const nonce = this.generateNonce();
      const clientId = this.getClientId();

      // Request credential with silent mediation (no UI)
      const credential = await this.requestIdentityCredential({
        configURL: (this.constructor as any).DEFAULT_CONFIG_URL,
        clientId,
        nonce,
        mediation: 'silent',
      });

      if (!credential || !credential.token) {
        return null;
      }

      const session = await this.exchangeIdTokenForSession(credential.token);
      if (session && (session as any).accessToken) {
        this.httpService.setTokens((session as any).accessToken);
      }

      return session;
    } catch (error) {
      // Silent failures are expected and should not throw
      return null;
    }
  }

  /**
   * Request identity credential from browser using FedCM API
   *
   * @private
   */
  public async requestIdentityCredential(options: {
    configURL: string;
    clientId: string;
    nonce: string;
    context?: string;
    mediation?: 'silent' | 'optional' | 'required';
  }): Promise<{ token: string } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.constructor as any).FEDCM_TIMEOUT);

    try {
      // Type assertion needed as FedCM types may not be in all TypeScript versions
      const credential = (await (navigator.credentials as any).get({
        identity: {
          providers: [
            {
              configURL: options.configURL,
              clientId: options.clientId,
              nonce: options.nonce,
              ...(options.context && { loginHint: options.context }),
            },
          ],
        },
        mediation: options.mediation || 'optional',
        signal: controller.signal,
      })) as any;

      if (!credential || credential.type !== 'identity') {
        return null;
      }

      return { token: credential.token };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Exchange FedCM ID token for Oxy session
   *
   * The ID token is a JWT issued by auth.oxy.so that proves the user's
   * identity. We exchange it for a full Oxy session with access token.
   *
   * @private
   */
  public async exchangeIdTokenForSession(idToken: string): Promise<SessionLoginResponse> {
    return this.makeRequest<SessionLoginResponse>(
      'POST',
      '/api/fedcm/exchange',
      { id_token: idToken },
      { cache: false }
    );
  }

  /**
   * Revoke FedCM credential (sign out)
   *
   * This tells the browser to forget the FedCM credential for this app.
   * The user will need to re-authenticate next time.
   */
  async revokeFedCMCredential(): Promise<void> {
    if (!this.isFedCMSupported()) {
      return;
    }

    try {
      // FedCM logout API (if available)
      if ('IdentityCredential' in window && 'logout' in (window as any).IdentityCredential) {
        const clientId = this.getClientId();
        await (window as any).IdentityCredential.logout({
          configURL: (this.constructor as any).DEFAULT_CONFIG_URL,
          clientId,
        });
      }
    } catch (error) {
      // Silent failure
    }
  }

  /**
   * Get configuration for FedCM
   *
   * @returns FedCM configuration with browser support info
   */
  getFedCMConfig(): FedCMConfig {
    return {
      enabled: this.isFedCMSupported(),
      configURL: (this.constructor as any).DEFAULT_CONFIG_URL,
      clientId: this.getClientId(),
    };
  }

  /**
   * Generate a cryptographically secure nonce for FedCM
   *
   * @private
   */
  public generateNonce(): string {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    // Fallback for older browsers
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Get the client ID for this origin
   *
   * @private
   */
  public getClientId(): string {
    if (typeof window === 'undefined') {
      return 'unknown';
    }
    return window.location.origin;
  }
  };
}

// Export the mixin function as both named and default
export { OxyServicesFedCMMixin as FedCMMixin };
