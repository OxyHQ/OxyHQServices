import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import type { SessionLoginResponse } from '../models/session';
import { createDebugLogger } from '../shared/utils/debugUtils';

const debug = createDebugLogger('PopupAuth');

export interface PopupAuthOptions {
  width?: number;
  height?: number;
  timeout?: number;
  mode?: 'login' | 'signup';
}

export interface SilentAuthOptions {
  timeout?: number;
}

/**
 * Popup-based Cross-Domain Authentication Mixin
 *
 * Implements OAuth2-style authentication using popup windows and postMessage.
 * This is the primary authentication method for modern browsers, providing a
 * Google-like experience without full page redirects.
 *
 * Flow:
 * 1. Opens small popup window to auth.oxy.so
 * 2. User signs in (auth.oxy.so sets its own first-party cookie)
 * 3. auth.oxy.so sends token back via postMessage
 * 4. Popup closes, parent app has the session
 *
 * Features:
 * - No full page redirect (preserves app state)
 * - Works across different domains (homiio.com, mention.earth, etc.)
 * - Silent refresh using hidden iframe for seamless SSO
 * - CSRF protection via state parameter
 * - XSS protection via origin validation
 *
 * Browser Support: All modern browsers (IE11+)
 */
export function OxyServicesPopupAuthMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
  public static readonly AUTH_URL = 'https://auth.oxy.so';
  public static readonly POPUP_WIDTH = 500;
  public static readonly POPUP_HEIGHT = 700;
  public static readonly POPUP_TIMEOUT = 60000; // 1 minute
  public static readonly SILENT_TIMEOUT = 5000; // 5 seconds

  /**
   * Sign in using popup window
   *
   * Opens a centered popup window to auth.oxy.so where the user can sign in.
   * The popup automatically closes after successful authentication and the
   * session is returned to the parent window.
   *
   * @param options - Popup configuration options
   * @returns Session with access token and user data
   * @throws {OxyAuthenticationError} If popup is blocked or auth fails
   *
   * @example
   * ```typescript
   * const handleSignIn = async () => {
   *   try {
   *     const session = await oxyServices.signInWithPopup();
   *     console.log('Signed in:', session.user);
   *   } catch (error) {
   *     if (error.message.includes('blocked')) {
   *       alert('Please allow popups for this site');
   *     }
   *   }
   * };
   * ```
   */
  async signInWithPopup(options: PopupAuthOptions = {}): Promise<SessionLoginResponse> {
    if (typeof window === 'undefined') {
      throw new OxyAuthenticationError('Popup authentication requires browser environment');
    }

    const state = this.generateState();
    const nonce = this.generateNonce();

    // Store state for CSRF protection
    this.storeAuthState(state, nonce);

    const width = options.width || (this.constructor as any).POPUP_WIDTH;
    const height = options.height || (this.constructor as any).POPUP_HEIGHT;
    const timeout = options.timeout || (this.constructor as any).POPUP_TIMEOUT;
    const mode = options.mode || 'login';

    const authUrl = this.buildAuthUrl({
      mode,
      state,
      nonce,
      clientId: window.location.origin,
      redirectUri: `${(this.constructor as any).AUTH_URL}/auth/callback`,
    });

    const popup = this.openCenteredPopup(authUrl, 'Oxy Sign In', width, height);

    if (!popup) {
      throw new OxyAuthenticationError(
        'Popup blocked. Please allow popups for this site and try again.'
      );
    }

    try {
      const session = await this.waitForPopupAuth(popup, state, timeout);

      // Store access token if present
      if (session && (session as any).accessToken) {
        this.httpService.setTokens((session as any).accessToken);
      }

      // Fetch user data using the session ID
      // The callback page only sends sessionId/accessToken, not user data
      if (session && session.sessionId && !session.user) {
        try {
          const userData = await this.makeRequest<any>(
            'GET',
            `/api/session/user/${session.sessionId}`,
            undefined,
            { cache: false }
          );
          if (userData) {
            (session as any).user = userData;
          }
        } catch (userError) {
          debug.warn('Failed to fetch user data:', userError);
          // Continue without user data - caller can fetch separately
        }
      }

      return session;
    } catch (error) {
      throw error;
    } finally {
      this.clearAuthState(state);
    }
  }

  /**
   * Sign up using popup window
   *
   * Same as signInWithPopup but opens the signup page by default.
   *
   * @param options - Popup configuration options
   * @returns Session with access token and user data
   */
  async signUpWithPopup(options: PopupAuthOptions = {}): Promise<SessionLoginResponse> {
    return this.signInWithPopup({ ...options, mode: 'signup' });
  }

  /**
   * Silent sign-in using hidden iframe
   *
   * Attempts to automatically re-authenticate the user without any UI.
   * This is what enables seamless SSO across all Oxy domains.
   *
   * How it works:
   * 1. Creates hidden iframe pointing to auth.oxy.so/silent-auth
   * 2. If user has valid session at auth.oxy.so, it sends token via postMessage
   * 3. If not, iframe responds with null (no error thrown)
   *
   * This should be called on app startup to check for existing sessions.
   *
   * @param options - Silent auth options
   * @returns Session if user is signed in, null otherwise
   *
   * @example
   * ```typescript
   * useEffect(() => {
   *   const checkAuth = async () => {
   *     const session = await oxyServices.silentSignIn();
   *     if (session) {
   *       setUser(session.user);
   *     }
   *   };
   *   checkAuth();
   * }, []);
   * ```
   */
  async silentSignIn(options: SilentAuthOptions = {}): Promise<SessionLoginResponse | null> {
    if (typeof window === 'undefined') {
      return null;
    }

    const timeout = options.timeout || (this.constructor as any).SILENT_TIMEOUT;
    const nonce = this.generateNonce();
    const clientId = window.location.origin;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.position = 'absolute';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';

    const silentUrl = `${(this.constructor as any).AUTH_URL}/auth/silent?` + `client_id=${encodeURIComponent(clientId)}&` + `nonce=${nonce}`;

    iframe.src = silentUrl;
    document.body.appendChild(iframe);

    try {
      const session = await this.waitForIframeAuth(iframe, timeout, clientId);

      if (session && (session as any).accessToken) {
        this.httpService.setTokens((session as any).accessToken);
      }

      return session;
    } catch (error) {
      return null;
    } finally {
      document.body.removeChild(iframe);
    }
  }

  /**
   * Open a centered popup window
   *
   * @private
   */
  public openCenteredPopup(url: string, title: string, width: number, height: number): Window | null {
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'toolbar=no',
      'menubar=no',
      'scrollbars=yes',
      'resizable=yes',
      'status=no',
      'location=no',
    ].join(',');

    return window.open(url, title, features);
  }

  /**
   * Wait for authentication response from popup
   *
   * @private
   */
  public async waitForPopupAuth(
    popup: Window,
    expectedState: string,
    timeout: number
  ): Promise<SessionLoginResponse> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new OxyAuthenticationError('Authentication timeout'));
      }, timeout);

      const messageHandler = (event: MessageEvent) => {
        const authUrl = (this.constructor as any).AUTH_URL;

        // Log all messages for debugging
        if (event.data && typeof event.data === 'object' && event.data.type) {
          debug.log('Message received:', {
            origin: event.origin,
            expectedOrigin: authUrl,
            type: event.data.type,
            hasSession: !!event.data.session,
            hasError: !!event.data.error,
          });
        }

        // CRITICAL: Verify origin to prevent XSS attacks
        if (event.origin !== authUrl) {
          return;
        }

        const { type, state, session, error } = event.data;

        if (type !== 'oxy_auth_response') {
          return;
        }

        debug.log('Valid auth response:', { state, expectedState, hasSession: !!session, error });

        // Verify state parameter to prevent CSRF attacks
        if (state !== expectedState) {
          cleanup();
          debug.error('State mismatch');
          reject(new OxyAuthenticationError('Invalid state parameter. Possible CSRF attack.'));
          return;
        }

        cleanup();

        if (error) {
          debug.error('Auth error:', error);
          reject(new OxyAuthenticationError(error));
        } else if (session) {
          debug.log('Session received successfully');
          resolve(session);
        } else {
          debug.error('No session in response');
          reject(new OxyAuthenticationError('No session received from authentication server'));
        }
      };

      // Poll to detect if user closed the popup
      const pollInterval = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new OxyAuthenticationError('Authentication cancelled by user'));
        }
      }, 500);

      const cleanup = () => {
        clearTimeout(timeoutId);
        clearInterval(pollInterval);
        window.removeEventListener('message', messageHandler);
        if (!popup.closed) {
          popup.close();
        }
      };

      window.addEventListener('message', messageHandler);
    });
  }

  /**
   * Wait for authentication response from iframe
   *
   * @private
   */
  public async waitForIframeAuth(
    iframe: HTMLIFrameElement,
    timeout: number,
    expectedOrigin: string
  ): Promise<SessionLoginResponse | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(null); // Silent failure - don't throw
      }, timeout);

      const messageHandler = (event: MessageEvent) => {
        // Verify origin
        if (event.origin !== (this.constructor as any).AUTH_URL) {
          return;
        }

        const { type, session } = event.data;

        if (type !== 'oxy_silent_auth') {
          return;
        }

        cleanup();
        resolve(session || null);
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        window.removeEventListener('message', messageHandler);
      };

      window.addEventListener('message', messageHandler);
    });
  }

  /**
   * Build authentication URL with query parameters
   *
   * @private
   */
  public buildAuthUrl(params: {
    mode: string;
    state: string;
    nonce: string;
    clientId: string;
    redirectUri: string;
  }): string {
    const url = new URL(`${(this.constructor as any).AUTH_URL}/${params.mode}`);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    return url.toString();
  }

  /**
   * Generate cryptographically secure state for CSRF protection
   *
   * @private
   */
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

  /**
   * Generate nonce for replay attack prevention
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
   * Store auth state in session storage
   *
   * @private
   */
  public storeAuthState(state: string, nonce: string): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.setItem(`oxy_auth_state_${state}`, JSON.stringify({ nonce, timestamp: Date.now() }));
    }
  }

  /**
   * Clear auth state from session storage
   *
   * @private
   */
  public clearAuthState(state: string): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.removeItem(`oxy_auth_state_${state}`);
    }
  }
  };
}

// Export the mixin function as both named and default
export { OxyServicesPopupAuthMixin as PopupAuthMixin };
