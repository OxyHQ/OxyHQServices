/**
 * Central Cross-Domain SSO (opaque-code) Mixin
 *
 * Implements the Relying-Party half of TRUE central cross-domain SSO
 * (Google/Meta/Clerk style). The central IdP at `auth.oxy.so` owns the session;
 * an RP bounces a top-level redirect (prompt=none) to `auth.oxy.so/sso`, which
 * returns an OPAQUE single-use code in the redirect fragment. The RP then
 * exchanges that code here for the real session.
 *
 * Security properties:
 *   - NO token/JWT ever travels in a URL — only the opaque code does. The real
 *     `accessToken` is delivered exclusively in this exchange response body.
 *   - The exchange is a CORS POST with NO credentials/cookies — the opaque code
 *     is the only bearer of authority, and the central store burns it atomically
 *     (single-use). Sending no cookies keeps the request a clean, ambient-
 *     authority-free bearer exchange that the central `POST /sso/exchange`
 *     endpoint validates by `Origin` against the code's bound `clientOrigin`.
 *   - The code is minted server-side bound to the RP origin and expires in
 *     seconds, so a leaked code is useless cross-origin and short-lived.
 *
 * On success the mixin plants the returned access token via
 * `httpService.setTokens(...)` — mirroring `exchangeIdTokenForSession` /
 * `verifyChallenge` — so callers do NOT need to plant tokens manually.
 */

import type { OxyServicesBase } from '../OxyServices.base';
import type { SessionLoginResponse, MinimalUserData } from '../models/session';
import type { UserNameResponse } from '@oxyhq/contracts';
import { createDebugLogger } from '../shared/utils/debugUtils';
import { ssoStateKey } from '../utils/ssoBounce';

const debug = createDebugLogger('SSO');

/**
 * Wire shape of `POST /sso/exchange`. `expiresAt` and `authuser` are optional
 * because the central SSO store may omit them.
 */
interface SsoExchangeWireResponse {
  accessToken: string;
  sessionId: string;
  user: {
    id?: string;
    _id?: string;
    username?: string;
    name?: UserNameResponse;
    avatar?: string;
  };
  expiresAt?: string;
  authuser?: number;
}

/**
 * Generate a cryptographically secure state value for the SSO bounce.
 *
 * Exposed as a module-level helper (in addition to the instance method below)
 * so consumers that do not yet hold an `OxyServices` instance can still mint a
 * bounce state. Uses `crypto.randomUUID` with a `getRandomValues` fallback.
 */
export function generateSsoState(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('No secure random source available for SSO state generation');
}


function getStoredSsoStateForCurrentOrigin(): string | null {
  if (typeof window === 'undefined' || !window.location || !window.sessionStorage) {
    return null;
  }

  try {
    return window.sessionStorage.getItem(ssoStateKey(window.location.origin));
  } catch {
    return null;
  }
}

export function OxyServicesSsoMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Generate cryptographically secure state for the SSO bounce (CSRF
     * protection). Delegates to the module-level {@link generateSsoState}
     * helper, which uses `crypto.randomUUID` when available and falls back to
     * `crypto.getRandomValues`.
     */
    public generateSsoState(): string {
      return generateSsoState();
    }

    /**
     * Exchange an opaque single-use SSO code for the real Oxy session.
     *
     * POSTs `{ code }` to `${getSessionBaseUrl()}/sso/exchange` as a CORS
     * request with NO credentials/cookies. On success the returned access token
     * is planted via `httpService.setTokens(...)` (matching
     * `exchangeIdTokenForSession` / `verifyChallenge`), so callers do not need
     * to plant tokens manually.
     *
     * @param code - The opaque single-use code delivered in the SSO return
     *   fragment (see {@link parseSsoReturnFragment}). The central store burns
     *   it atomically on exchange.
     * @param state - The state value returned alongside the code. In browsers,
     *   when an SSO bounce state is still stored for the current origin, this
     *   must match before any token-committing exchange is attempted.
     * @returns The resolved {@link SessionLoginResponse}.
     */
    public async exchangeSsoCode(code: string, state?: string): Promise<SessionLoginResponse> {
      if (typeof code !== 'string' || code.length === 0) {
        throw this.handleError(new Error('exchangeSsoCode requires a non-empty code'));
      }

      const expectedState = getStoredSsoStateForCurrentOrigin();
      if (expectedState !== null && (typeof state !== 'string' || state.length === 0 || state !== expectedState)) {
        throw this.handleError(new Error('SSO exchange state mismatch'));
      }

      const url = `${this.getSessionBaseUrl().replace(/\/$/, '')}/sso/exchange`;
      debug.log('Exchanging SSO code for session...');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          // No cookies: the opaque code is the sole bearer of authority and the
          // server validates by Origin against the code's bound clientOrigin.
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ code }),
        });
      } catch (error) {
        debug.error('SSO exchange request failed:', error instanceof Error ? error.message : String(error));
        throw this.handleError(error);
      }

      if (!response.ok) {
        throw this.handleError(new Error(`SSO exchange failed with HTTP ${response.status}`));
      }

      let payload: SsoExchangeWireResponse;
      try {
        payload = (await response.json()) as SsoExchangeWireResponse;
      } catch (error) {
        throw this.handleError(error);
      }

      if (!payload || typeof payload.accessToken !== 'string' || payload.accessToken.length === 0) {
        throw this.handleError(new Error('SSO exchange returned no access token'));
      }
      if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) {
        throw this.handleError(new Error('SSO exchange returned no sessionId'));
      }

      const userId = payload.user?.id ?? payload.user?._id;
      if (!userId || typeof payload.user?.username !== 'string' || typeof payload.user.name?.displayName !== 'string') {
        throw this.handleError(new Error('SSO exchange returned an invalid user'));
      }

      const user: MinimalUserData = {
        id: userId,
        username: payload.user.username,
        name: payload.user.name,
        avatar: payload.user.avatar,
      };

      // Plant the access token exactly like exchangeIdTokenForSession does.
      // The SSO exchange does not return a refresh token (the central store
      // holds the refresh credential), so default it to an empty string.
      this.httpService.setTokens(payload.accessToken);

      debug.log('SSO exchange complete:', { hasSession: !!payload.sessionId });

      const session: SessionLoginResponse = {
        sessionId: payload.sessionId,
        deviceId: '',
        expiresAt: payload.expiresAt ?? '',
        user,
        accessToken: payload.accessToken,
      };

      return session;
    }
  };
}
