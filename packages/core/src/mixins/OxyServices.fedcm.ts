import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';
import type { SessionLoginResponse } from '../models/session';
import { createDebugLogger } from '../shared/utils/debugUtils';

const debug = createDebugLogger('FedCM');

export interface FedCMAuthOptions {
  nonce?: string;
  context?: 'signin' | 'signup' | 'continue' | 'use';
  loginHint?: string;
}

export interface FedCMConfig {
  enabled: boolean;
  configURL: string;
  clientId?: string;
}

/**
 * FedCM request mode values.
 *
 * The W3C FedCM spec renamed the `IdentityCredentialRequestOptions.mode` enum:
 * `'widget'` → `'passive'` and `'button'` → `'active'`. Modern Chrome only
 * accepts `'active'`/`'passive'` and throws a synchronous `TypeError` for the
 * legacy values, while Chrome 125–131 only understands `'button'`/`'widget'`.
 * Callers should use the modern values; the legacy values are accepted for
 * convenience and normalised internally.
 */
export type FedCMRequestMode = 'active' | 'passive' | 'button' | 'widget';

// Modern (W3C spec) → legacy (Chrome 125–131) mode value mapping. Used to
// retry a credential request when an older browser rejects the modern enum.
const MODERN_TO_LEGACY_MODE: Record<'active' | 'passive', 'button' | 'widget'> = {
  active: 'button',
  passive: 'widget',
};

// Legacy → modern mapping so callers may pass either spelling.
const LEGACY_TO_MODERN_MODE: Record<'button' | 'widget', 'active' | 'passive'> = {
  button: 'active',
  widget: 'passive',
};

/**
 * Normalise any accepted mode value to the modern W3C spelling
 * (`'active'`/`'passive'`), which is what is sent to the browser first.
 */
function toModernMode(mode: FedCMRequestMode): 'active' | 'passive' {
  return mode === 'button' || mode === 'widget' ? LEGACY_TO_MODERN_MODE[mode] : mode;
}

/**
 * Detect the synchronous `TypeError` a pre-spec browser throws when it does not
 * recognise a modern `mode` enum value (e.g. Chrome 125–131 rejecting
 * `'active'`/`'passive'`). Such a browser only understands the legacy
 * `'button'`/`'widget'` values, so the caller can retry with those.
 */
function isUnknownModeEnumError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('identitycredentialrequestoptionsmode') ||
    ((message.includes('active') || message.includes('passive')) &&
      (message.includes('enum') || message.includes('not a valid')))
  );
}

/**
 * Detect a `navigator.credentials.get` rejection that is consistent with
 * "the supplied loginHint matched no account at the IdP".
 *
 * When an RP passes a `loginHint` and the IdP returns accounts but NONE of them
 * declare that hint in their `login_hints`, Chrome filters every account out,
 * greys it in the chooser ("You can't sign in using this account"), logs
 * "Accounts were received, but none matched the login hint…", and ultimately
 * rejects the credential request — surfacing as a `NotAllowedError` /
 * `AbortError` (the same shape as a user-cancelled or timed-out request). A
 * stale hint left over from a previously-signed-in/test account therefore hard
 * -blocks sign-in.
 *
 * We can only safely apply the clear-and-retry recovery when a `loginHint` was
 * actually supplied; without one this is just a normal cancel/timeout and must
 * NOT be retried. Callers gate on `hadLoginHint` before calling this.
 */
function isPossibleHintMismatchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // FedCM surfaces a filtered-out / no-eligible-account outcome as
  // NotAllowedError (current Chrome) or AbortError (our own timeout abort while
  // the chooser had no selectable account). Both are indistinguishable from a
  // genuine user cancel at the API level, so the gate on "a hint was supplied"
  // (in the caller) is what makes the retry safe and targeted.
  return error.name === 'NotAllowedError' || error.name === 'AbortError';
}

// Minimal structural types for the FedCM `navigator.credentials.get` surface.
// The DOM lib does not ship these in every TypeScript version we build against,
// so we model only the fields this mixin reads/writes. This lets the FedCM code
// stay free of `any` without depending on lib-dom FedCM typings.
interface FedCMProviderRequest {
  configURL: string;
  clientId: string;
  nonce: string;
  params?: { nonce: string };
  loginHint?: string;
}

interface FedCMIdentityRequest {
  providers: FedCMProviderRequest[];
  mode?: FedCMRequestMode;
}

interface FedCMCredentialRequest {
  identity: FedCMIdentityRequest;
  mediation: 'silent' | 'optional' | 'required';
  signal: AbortSignal;
}

interface FedCMIdentityCredential {
  type?: string;
  token?: string;
  isAutoSelected?: boolean;
}

interface FedCMCredentialsContainer {
  get(options: FedCMCredentialRequest): Promise<FedCMIdentityCredential | null>;
}

/**
 * Normalised result of a FedCM credential request: the IdP-issued ID token plus
 * whether the browser auto-selected the account (no explicit user choice).
 */
interface FedCMTokenResult {
  token: string;
  isAutoSelected: boolean;
}

// Options accepted by the static `IdentityCredential.disconnect()` method
// (W3C FedCM "disconnect" / sign-out). Not declared in every lib-dom version.
interface FedCMDisconnectOptions {
  configURL: string;
  clientId: string;
  accountHint: string;
}

// Minimal structural shape of the global `IdentityCredential` interface object,
// modelling only the static `disconnect` method this mixin invokes.
interface FedCMIdentityCredentialStatic {
  disconnect(options: FedCMDisconnectOptions): Promise<void>;
}

const FEDCM_LOGIN_HINT_KEY = 'oxy_fedcm_login_hint';

// Global lock to prevent concurrent FedCM requests
// FedCM only allows one navigator.credentials.get request at a time
let fedCMRequestInProgress = false;
let fedCMRequestPromise: Promise<FedCMTokenResult | null> | null = null;
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

  public resolveFedcmConfigUrl(): string {
    return this.config.authWebUrl
      ? `${this.config.authWebUrl}/fedcm.json`
      : (this.constructor as any).DEFAULT_CONFIG_URL;
  }

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

    // Use provided loginHint, or fall back to stored last-used account ID.
    const initialLoginHint = options.loginHint || this.getStoredLoginHint();

    try {
      return await this.attemptInteractiveSignIn(options, initialLoginHint);
    } catch (error) {
      // A STALE loginHint (e.g. left over from a previously-signed-in or test
      // account) that matches no account at the IdP makes Chrome filter out
      // every account and reject the request — indistinguishable from a user
      // cancel. When that happens AND we supplied a hint, clear the bad hint
      // and retry the credential request ONCE with no hint, which lets the
      // chooser surface the genuinely available account(s). We only do this for
      // a hint we pulled from storage (not a caller-supplied one), and only
      // once, so a real cancel never loops.
      const usedStoredHint = !!initialLoginHint && !options.loginHint;
      if (usedStoredHint && isPossibleHintMismatchError(error)) {
        debug.log(
          'Interactive sign-in: stored loginHint matched no account; clearing it and retrying without a hint'
        );
        this.clearLoginHint();
        return await this.attemptInteractiveSignIn(options, undefined);
      }
      throw this.normalizeInteractiveSignInError(error);
    }
  }

  /**
   * Run a single interactive FedCM credential request + token exchange for the
   * given (possibly undefined) loginHint. A successful exchange plants the
   * access token and persists the user id as the future loginHint — the hint is
   * therefore only ever stored after a GENUINELY successful sign-in, never
   * speculatively.
   *
   * @private
   */
  public async attemptInteractiveSignIn(
    options: FedCMAuthOptions,
    loginHint: string | undefined
  ): Promise<SessionLoginResponse> {
    // Prefer a server-minted, origin-bound nonce so the downstream
    // `/fedcm/exchange` can validate it. A caller-supplied nonce is
    // respected as-is for advanced use cases.
    const nonce = options.nonce || (await this.getFedcmNonce());
    const clientId = this.getClientId();

    debug.log('Interactive sign-in: Requesting credential for', clientId, loginHint ? `(hint: ${loginHint})` : '');

    // Request credential from browser's native identity flow.
    // mode: 'active' signals this is a user-gesture-initiated (button) flow.
    // 'active' is the current W3C spec value; requestIdentityCredential
    // transparently retries with the legacy 'button' value for Chrome 125–131.
    const credential = await this.requestIdentityCredential({
      configURL: this.resolveFedcmConfigUrl(),
      clientId,
      nonce,
      context: options.context,
      loginHint,
      mode: 'active',
    });

    if (!credential || !credential.token) {
      throw new OxyAuthenticationError('No credential received from browser');
    }

    debug.log('Interactive sign-in: Got credential, exchanging for session');

    // Exchange FedCM ID token for Oxy session
    const session = await this.exchangeIdTokenForSession(credential.token);

    // Store access token in HttpService. `accessToken`/`refreshToken` are
    // declared optional on SessionLoginResponse; default the refresh token to
    // an empty string when the exchange did not return one.
    if (session?.accessToken) {
      this.httpService.setTokens(session.accessToken, session.refreshToken ?? '');
    }

    // Store the user ID as loginHint for future FedCM requests — only now, after
    // a real successful exchange, so we never persist a hint that cannot resolve.
    if (session?.user?.id) {
      this.storeLoginHint(session.user.id);
    }

    debug.log('Interactive sign-in: Success!', { userId: session?.user?.id });

    return session;
  }

  /**
   * Map a raw FedCM/exchange failure to a user-facing {@link OxyAuthenticationError}
   * (or pass it through). Extracted so the clear-and-retry path can reuse the
   * exact same error normalisation as the first attempt.
   *
   * @private
   */
  public normalizeInteractiveSignInError(error: unknown): unknown {
    debug.log('Interactive sign-in failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    // FedCM aborts/network failures surface as DOMException/Error instances,
    // both of which carry a `name`. Anything else has no meaningful name.
    const errorName = error instanceof Error ? error.name : '';

    if (errorName === 'AbortError') {
      return new OxyAuthenticationError('Sign-in was cancelled by user');
    }
    if (errorName === 'NetworkError') {
      return new OxyAuthenticationError('Network error during sign-in. Please check your connection.');
    }
    if (errorMessage.includes('multiple accounts')) {
      return new OxyAuthenticationError('Please sign out and sign in again to use FedCM with a single account');
    }
    if (errorMessage.includes('retrieving a token') || errorMessage.includes('Error retrieving')) {
      debug.error('FedCM token retrieval error - this may be a browser or IdP configuration issue');
      return new OxyAuthenticationError('Authentication failed. Please try again or use an alternative sign-in method.');
    }
    return error;
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
    let credential: FedCMTokenResult | null = null;

    const loginHint = this.getStoredLoginHint();

    try {
      // Server-minted, origin-bound nonce — required for `/fedcm/exchange`
      // to accept the resulting ID token (anti-replay binding).
      const nonce = await this.getFedcmNonce();
      debug.log('Silent SSO: Attempting silent mediation...', loginHint ? `(hint: ${loginHint})` : '');

      credential = await this.requestIdentityCredential({
        configURL: this.resolveFedcmConfigUrl(),
        clientId,
        nonce,
        loginHint,
        mediation: 'silent',
      });

      debug.log('Silent SSO: Silent mediation result:', { hasCredential: !!credential, hasToken: !!credential?.token });
    } catch (silentError) {
      const errorName = silentError instanceof Error ? silentError.name : 'Unknown';
      const errorMessage = silentError instanceof Error ? silentError.message : String(silentError);

      // Handle specific FedCM errors with better logging
      if (errorMessage.includes('multiple accounts')) {
        debug.log('Silent SSO: User has used multiple accounts - silent mediation not available');
        debug.log('Silent SSO: User needs to explicitly sign in to choose account');
      } else if (errorMessage.includes('conditions')) {
        debug.log('Silent SSO: Conditions not met (user may not be logged in at IdP or not in approved_clients)');
      } else {
        debug.log('Silent SSO: Silent mediation failed:', { name: errorName, message: errorMessage });
      }

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

    // Set the access token. `accessToken`/`refreshToken` are declared optional
    // on SessionLoginResponse; default the refresh token to an empty string when
    // the exchange did not return one.
    if (session.accessToken) {
      this.httpService.setTokens(session.accessToken, session.refreshToken ?? '');
      debug.log('Silent SSO: Access token set');
    } else {
      debug.warn('Silent SSO: No accessToken in session response');
    }

    // Store the user ID as loginHint for future FedCM requests
    if (session.user?.id) {
      this.storeLoginHint(session.user.id);
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
    loginHint?: string;
    mediation?: 'silent' | 'optional' | 'required';
    /**
     * FedCM request mode. The W3C spec values are `'active'` (user-gesture
     * button flow) and `'passive'` (browser-initiated widget flow). Chrome
     * 125–131 used the legacy names `'button'`/`'widget'`; those are accepted
     * here and mapped to the modern values, with an automatic legacy retry if
     * the running browser only understands the old enum.
     */
    mode?: FedCMRequestMode;
  }): Promise<FedCMTokenResult | null> {
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

    // Normalise the caller's mode to the modern W3C value first. A modern
    // browser accepts it; an older one (Chrome 125–131) rejects it with a
    // synchronous TypeError, in which case we retry with the legacy value.
    const modernMode = options.mode ? toModernMode(options.mode) : undefined;

    // Build the identity request for a specific mode value. The `mode` field
    // lives on the `identity` object (sibling of `providers`), separate from
    // the top-level `mediation` field.
    const buildCredentialOptions = (modeValue: FedCMRequestMode | undefined): FedCMCredentialRequest => ({
      identity: {
        providers: [
          {
            configURL: options.configURL,
            clientId: options.clientId,
            // Older browsers read `nonce` at the top level; Chrome 145+
            // expects it inside `params`. Send both for full coverage.
            nonce: options.nonce,
            params: {
              nonce: options.nonce,
            },
            ...(options.loginHint && { loginHint: options.loginHint }),
          },
        ],
        ...(modeValue && { mode: modeValue }),
      },
      mediation: requestedMediation,
      signal: controller.signal,
    });

    // The DOM lib's `CredentialsContainer` does not declare the FedCM `identity`
    // request in every TypeScript version we build against. Re-type through the
    // minimal structural interface above (not `any`) to keep this typed.
    const credentials = navigator.credentials as unknown as FedCMCredentialsContainer;

    fedCMRequestPromise = (async () => {
      try {
        debug.log('Calling navigator.credentials.get with mediation:', requestedMediation, modernMode ? `mode: ${modernMode}` : '');
        let credential: FedCMIdentityCredential | null;
        try {
          credential = await credentials.get(buildCredentialOptions(modernMode));
        } catch (modeError) {
          // Chrome 125–131 only knows the legacy 'button'/'widget' enum and
          // throws a synchronous TypeError for the modern 'active'/'passive'
          // values. Retry once with the legacy value so older browsers work.
          if (modernMode && isUnknownModeEnumError(modeError)) {
            const legacyMode = MODERN_TO_LEGACY_MODE[modernMode];
            debug.log(`Browser rejected modern mode '${modernMode}'; retrying with legacy mode '${legacyMode}'`);
            credential = await credentials.get(buildCredentialOptions(legacyMode));
          } else {
            throw modeError;
          }
        }

        debug.log('navigator.credentials.get returned:', {
          hasCredential: !!credential,
          type: credential?.type,
          hasToken: !!credential?.token,
        });

        if (!credential || credential.type !== 'identity' || !credential.token) {
          debug.log('No valid identity credential returned');
          return null;
        }

        const isAutoSelected = !!credential.isAutoSelected;
        debug.log('Got valid identity credential with token', { isAutoSelected });
        return { token: credential.token, isAutoSelected };
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
        '/fedcm/exchange',
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
   * Uses IdentityCredential.disconnect() to tell the browser to forget
   * the RP-IdP-account association. This resets the "returning account"
   * state, which is required for silent mediation to work again.
   */
  async revokeFedCMCredential(): Promise<void> {
    // Read hint before clearing so we can pass it to disconnect()
    const accountHint = this.getStoredLoginHint();
    this.clearLoginHint();

    if (!this.isFedCMSupported()) {
      return;
    }

    try {
      // The DOM lib does not declare the global `IdentityCredential` interface
      // object (with its static `disconnect`) in every TypeScript version we
      // build against. Read it off `window` through the minimal structural type
      // (not `any`), guarding that `disconnect` is actually present at runtime.
      const fedCMWindow = window as unknown as {
        IdentityCredential?: Partial<FedCMIdentityCredentialStatic>;
      };
      const identityCredential = fedCMWindow.IdentityCredential;
      if (identityCredential && typeof identityCredential.disconnect === 'function') {
        const clientId = this.getClientId();
        await identityCredential.disconnect({
          configURL: this.resolveFedcmConfigUrl(),
          clientId,
          accountHint: accountHint || '*',
        });
        debug.log('FedCM credential disconnected');
      }
    } catch (error) {
      debug.log('FedCM disconnect failed (non-critical):', error instanceof Error ? error.message : String(error));
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
      configURL: this.resolveFedcmConfigUrl(),
      clientId: this.getClientId(),
    };
  }

  /**
   * Generate a cryptographically secure local nonce for FedCM.
   *
   * NOTE: this is a *local* fallback only. The server-side `/fedcm/exchange`
   * endpoint requires the nonce embedded in the ID token to have been minted
   * by `POST /fedcm/nonce` (see {@link mintServerNonce}) and bound to this
   * origin. A purely local nonce will be rejected with `invalid_nonce`. Use
   * {@link getFedcmNonce}, which prefers a server-minted nonce and only falls
   * back to this generator when the mint endpoint is unreachable.
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
   * Mint a single-use, origin-bound nonce from the Oxy API.
   *
   * The FedCM ID token issued by the IdP embeds this nonce as the `nonce`
   * claim. When the consuming app calls `POST /fedcm/exchange`, the API burns
   * the nonce (atomic `usedAt` transition) and verifies it was minted for the
   * same origin as the token `aud`. This is the anti-replay binding required
   * by the API's H9 hardening — without a server-minted nonce the exchange
   * always fails.
   *
   * The browser attaches the `Origin` header automatically on this
   * cross-origin request, so the API binds the nonce to the calling app's
   * origin (which also becomes the FedCM `clientId`/token `aud`).
   *
   * @private
   */
  public async mintServerNonce(): Promise<string> {
    const result = await this.makeRequest<{ nonce: string; expiresAt: string }>(
      'POST',
      '/fedcm/nonce',
      {},
      { cache: false }
    );
    if (!result?.nonce) {
      throw new OxyAuthenticationError('FedCM nonce endpoint returned no nonce');
    }
    return result.nonce;
  }

  /**
   * Resolve the nonce to use for a FedCM credential request.
   *
   * Prefers a server-minted, origin-bound nonce (required for the token
   * exchange to succeed). If the mint endpoint is unreachable we fall back to
   * a locally generated nonce so the browser flow can still proceed; the
   * exchange may then fail server-side, but that is strictly better than
   * throwing before the browser ever shows its UI.
   *
   * @private
   */
  public async getFedcmNonce(): Promise<string> {
    try {
      return await this.mintServerNonce();
    } catch (error) {
      debug.warn(
        'Could not mint server nonce, falling back to local nonce:',
        error instanceof Error ? error.message : String(error)
      );
      return this.generateNonce();
    }
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

  /** @internal */
  public getStoredLoginHint(): string | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
      return localStorage.getItem(FEDCM_LOGIN_HINT_KEY) || undefined;
    } catch {
      return undefined;
    }
  }

  /** @internal */
  public storeLoginHint(userId: string): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(FEDCM_LOGIN_HINT_KEY, userId);
    } catch {
      // Storage full or blocked
    }
  }

  /** @internal */
  public clearLoginHint(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(FEDCM_LOGIN_HINT_KEY);
    } catch {
      // Storage blocked
    }
  }
  };
}

// Export the mixin function as both named and default
export { OxyServicesFedCMMixin as FedCMMixin };
