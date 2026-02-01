import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import type { SessionLoginResponse } from '../models/session';
import { createDebugLogger } from '../shared/utils/debugUtils';

const debug = createDebugLogger('FedCM');

export interface FedCMAuthOptions {
  nonce?: string;
  context?: 'signin' | 'signup' | 'continue' | 'use';
}

export interface FedCMConfig {
  enabled: boolean;
  configURL: string;
  clientId?: string;
}

// Global lock to prevent concurrent FedCM requests
// FedCM only allows one navigator.credentials.get request at a time
let fedCMRequestInProgress = false;
let fedCMRequestPromise: Promise<any> | null = null;
let currentMediationMode: string | null = null;

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
  public static readonly FEDCM_TIMEOUT = 15000; // 15 seconds for interactive
  public static readonly FEDCM_SILENT_TIMEOUT = 3000; // 3 seconds for silent mediation

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

      debug.log('Interactive sign-in: Requesting credential for', clientId);

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

      debug.log('Interactive sign-in: Got credential, exchanging for session');

      // Exchange FedCM ID token for Oxy session
      const session = await this.exchangeIdTokenForSession(credential.token);

      // Store access token in HttpService (extract from response or get from session)
      if (session && (session as any).accessToken) {
        this.httpService.setTokens((session as any).accessToken);
      }

      debug.log('Interactive sign-in: Success!', { userId: (session as any)?.user?.id });

      return session;
    } catch (error) {
      debug.log('Interactive sign-in failed:', error);
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
      debug.log('Silent SSO: FedCM not supported in this browser');
      return null;
    }

    const clientId = this.getClientId();
    debug.log('Silent SSO: Starting for', clientId);

    // Only try silent mediation (no UI) - works if user previously consented.
    // We intentionally do NOT fall back to optional mediation here because
    // this runs on app startup — showing browser UI without user action is bad UX.
    // Optional/interactive mediation should only happen when the user clicks "Sign In".
    let credential: { token: string } | null = null;

    try {
      const nonce = this.generateNonce();
      debug.log('Silent SSO: Attempting silent mediation...');

      credential = await this.requestIdentityCredential({
        configURL: (this.constructor as any).DEFAULT_CONFIG_URL,
        clientId,
        nonce,
        mediation: 'silent',
      });

      debug.log('Silent SSO: Silent mediation result:', { hasCredential: !!credential, hasToken: !!credential?.token });
    } catch (silentError) {
      const errorName = silentError instanceof Error ? silentError.name : 'Unknown';
      const errorMessage = silentError instanceof Error ? silentError.message : String(silentError);
      debug.log('Silent SSO: Silent mediation failed:', { name: errorName, message: errorMessage });
      return null;
    }

    if (!credential || !credential.token) {
      debug.log('Silent SSO: No credential returned (user not logged in at IdP or hasn\'t consented)');
      return null;
    }

    debug.log('Silent SSO: Got credential, exchanging for session...');

    let session: SessionLoginResponse;
    try {
      session = await this.exchangeIdTokenForSession(credential.token);
    } catch (exchangeError) {
      debug.error('Silent SSO: Token exchange failed:', exchangeError);
      return null;
    }

    // Validate session response has required fields
    if (!session) {
      debug.error('Silent SSO: Exchange returned null session');
      return null;
    }

    if (!session.sessionId) {
      debug.error('Silent SSO: Exchange returned session without sessionId:', session);
      return null;
    }

    if (!session.user) {
      debug.error('Silent SSO: Exchange returned session without user:', session);
      return null;
    }

    // Set the access token
    if ((session as any).accessToken) {
      this.httpService.setTokens((session as any).accessToken);
      debug.log('Silent SSO: Access token set');
    } else {
      debug.warn('Silent SSO: No accessToken in session response');
    }

    debug.log('Silent SSO: Success!', {
      sessionId: session.sessionId?.substring(0, 8) + '...',
      userId: session.user?.id
    });

    return session;
  }

  /**
   * Request identity credential from browser using FedCM API
   *
   * Uses a global lock to prevent concurrent requests, as FedCM only
   * allows one navigator.credentials.get request at a time.
   *
   * Interactive requests (optional/required) wait for any silent request to finish first.
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
    const requestedMediation = options.mediation || 'optional';
    const isInteractive = requestedMediation !== 'silent';

    debug.log('requestIdentityCredential called:', {
      mediation: requestedMediation,
      clientId: options.clientId,
      inProgress: fedCMRequestInProgress,
    });

    // If a request is already in progress...
    if (fedCMRequestInProgress && fedCMRequestPromise) {
      debug.log('Request already in progress, waiting...');
      // If current request is silent and new request is interactive,
      // wait for silent to finish, then make the interactive request
      if (currentMediationMode === 'silent' && isInteractive) {
        try {
          await fedCMRequestPromise;
        } catch {
          // Ignore silent request errors
        }
        // Now fall through to make the interactive request
      } else {
        // Same type of request - wait for the existing one
        try {
          return await fedCMRequestPromise;
        } catch {
          return null;
        }
      }
    }

    fedCMRequestInProgress = true;
    currentMediationMode = requestedMediation;
    const controller = new AbortController();
    // Use shorter timeout for silent mediation since it should be quick
    const timeoutMs = requestedMediation === 'silent'
      ? (this.constructor as any).FEDCM_SILENT_TIMEOUT
      : (this.constructor as any).FEDCM_TIMEOUT;
    const timeout = setTimeout(() => {
      debug.log('Request timed out after', timeoutMs, 'ms (mediation:', requestedMediation + ')');
      controller.abort();
    }, timeoutMs);

    fedCMRequestPromise = (async () => {
      try {
        debug.log('Calling navigator.credentials.get with mediation:', requestedMediation);
        // Type assertion needed as FedCM types may not be in all TypeScript versions
        const credential = (await (navigator.credentials as any).get({
          identity: {
            providers: [
              {
                configURL: options.configURL,
                clientId: options.clientId,
                // Send nonce at both levels for backward compatibility
                nonce: options.nonce, // For older browsers
                params: {
                  nonce: options.nonce, // For Chrome 145+
                },
                ...(options.context && { loginHint: options.context }),
              },
            ],
          },
          mediation: requestedMediation,
          signal: controller.signal,
        })) as any;

        debug.log('navigator.credentials.get returned:', {
          hasCredential: !!credential,
          type: credential?.type,
          hasToken: !!credential?.token,
        });

        if (!credential || credential.type !== 'identity') {
          debug.log('No valid identity credential returned');
          return null;
        }

        debug.log('Got valid identity credential with token');
        return { token: credential.token };
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'Unknown';
        const errorMessage = error instanceof Error ? error.message : String(error);
        debug.log('navigator.credentials.get error:', { name: errorName, message: errorMessage });
        throw error;
      } finally {
        clearTimeout(timeout);
        fedCMRequestInProgress = false;
        fedCMRequestPromise = null;
        currentMediationMode = null;
      }
    })();

    return fedCMRequestPromise;
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
    debug.log('Exchanging ID token for session...');

    try {
      const response = await this.makeRequest<SessionLoginResponse>(
        'POST',
        '/api/fedcm/exchange',
        { id_token: idToken },
        { cache: false }
      );

      debug.log('Token exchange complete:', {
        hasSession: !!response?.sessionId,
        hasUser: !!response?.user,
      });

      return response;
    } catch (error) {
      debug.error('Token exchange failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
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
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('No secure random source available for nonce generation');
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
