/**
 * In-session access-token refresh for the React Native / Expo SDK.
 *
 * THE GAP THIS CLOSES: the services `OxyContext` owns the session but never
 * installed an `authRefreshHandler` on the owner `HttpService`, so
 * `HttpService.refreshAccessToken` short-circuited to `null` — there was NO
 * in-session token refresh on the RN path at all. A 15-minute access token
 * expired with the tab/app open and nothing re-minted one; cross-apex RP feeds
 * (mention.earth, …) then 401'd in a loop while `isAuthenticated` stayed `true`
 * (a zombie logged-in state), because the `Domain=oxy.so` refresh cookie can't
 * reach `api.<apex>`. (`AuthManager`, which installs a refresh handler on the
 * web path, is only ever constructed by `WebOxyProvider` in `@oxyhq/auth`.)
 *
 * THE FIX, two cooperating pieces both wired from `OxyContext`:
 *
 *  1. {@link createInSessionRefreshHandler} — an `AuthRefreshHandler` installed
 *     on the owner client. It re-mints a fresh access token WITHOUT a page
 *     reload by reusing the SAME durable per-apex silent-restore arms cold boot
 *     uses (in order; first that yields a token wins). The linked client
 *     (`createLinkedClient`) inherits the fix for free — its refresh delegates
 *     back to the owner's `refreshAccessToken`.
 *
 *  2. {@link startTokenRefreshScheduler} — a proactive scheduler that refreshes
 *     ~{@link TOKEN_REFRESH_LEAD_MS} before expiry (and on web tab-focus / native
 *     app-foreground), so the common case never even reaches the reactive
 *     401-then-recover flash.
 *
 * Concurrency/cooldown/dedup are owned by `HttpService.refreshAccessToken`
 * (single in-flight `tokenRefreshPromise` + cooldown) — this module does not
 * reimplement them, so the timer / foreground / per-request triggers collapse to
 * one network attempt (no refresh storm).
 */
import type {
  OxyServices,
  AuthRefreshHandler,
  AuthRefreshReason,
} from '@oxyhq/core';
import { autoDetectAuthWebUrl, logger as loggerUtil } from '@oxyhq/core';
import { AppState, type AppStateStatus } from 'react-native';
import { isWebBrowser } from '../hooks/useWebSSO';
import { readActiveAuthuser } from '../utils/activeAuthuser';

/**
 * Per-arm fail-fast budget (ms) for the web first-party `/auth/silent` iframe
 * arm. Slightly more generous than the cold-boot iframe budget (2.5s) because an
 * in-session refresh is NOT in the first-paint critical path — a couple hundred
 * ms of extra headroom for the same-origin handshake is worth a higher success
 * rate. `silentSignIn` still fail-fasts on `iframe.onerror`, so a hard failure
 * returns well before this.
 */
const SILENT_IFRAME_REFRESH_TIMEOUT = 4000;

/**
 * Per-arm fail-fast budget (ms) for the same-apex refresh-cookie arm
 * (`refreshAllSessions`). On a cross-apex RP the `Domain=oxy.so` cookie never
 * reaches `api.<apex>`, so this returns `{accounts:[]}` quickly; the bound only
 * matters if that endpoint stalls.
 */
const COOKIE_REFRESH_TIMEOUT = 4000;

/**
 * Lead time (ms) before access-token expiry at which the proactive scheduler
 * refreshes. Mirrors `HttpService`'s per-request `TOKEN_REFRESH_LEAD_SECONDS`
 * (60s) so the scheduled refresh and the request-time preflight refresh use the
 * same window — the scheduler simply fires it during idle/background instead of
 * waiting for the next request.
 */
export const TOKEN_REFRESH_LEAD_MS = 60_000;

function debugRefresh(message: string, reason: AuthRefreshReason, error?: unknown): void {
  if (__DEV__) {
    loggerUtil.debug(
      message,
      { component: 'inSessionTokenRefresh', method: 'authRefreshHandler', reason },
      error,
    );
  }
}

/**
 * Build the in-session `AuthRefreshHandler` for the owner client.
 *
 * Arms (first to yield a fresh token wins; each is bounded and falls through on
 * failure). Every arm plants the fresh token internally, so on success we read
 * it back via `getAccessToken()`:
 *
 *   NATIVE (Expo): shared cross-app identity key re-mint
 *     (`signInWithSharedIdentity` → challenge→sign→verify plants the tokens).
 *     The ONLY silent native arm (mirrors cold boot's `shared-key-signin`); the
 *     `/auth/silent` web iframe is NEVER attempted on native. Returns `null`
 *     when the device holds no shared identity (e.g. a password-only native
 *     sign-in) so a genuinely dead session reconciles to logged-out rather than
 *     staying a zombie.
 *
 *   WEB, in order:
 *     1. First-party `/auth/silent` iframe at the per-apex IdP
 *        (`silentSignIn` with `authWebUrlOverride = autoDetectAuthWebUrl()`).
 *        The durable cross-apex path: the iframe reads the first-party
 *        `fedcm_session` cookie on `auth.<apex>` and mints a fresh Oxy token. No
 *        top-level navigation → works in a backgrounded tab. On a `*.oxy.so`
 *        app the per-apex host IS the central host, so this also covers
 *        same-apex.
 *     2. FedCM silent re-auth (Chrome) — `silentSignInWithFedCM`.
 *     3. Same-apex refresh cookie — `refreshAllSessions`. On `*.oxy.so` the
 *        httpOnly `oxy_rt_${n}` cookies ride along; we plant the active
 *        account's rotated token. On a cross-apex RP it returns `{accounts:[]}`
 *        and is a clean no-op. Unlike the cold-boot cookie restore this does NOT
 *        rebuild multi-session state — an in-session refresh only needs a fresh
 *        bearer.
 *
 * NO RECURSION: none of these arms issue requests through the authed client's
 * `refreshAccessToken` path. The iframe/FedCM transports are postMessage /
 * credential APIs; the follow-up `/session/user` fetch inside `silentSignIn`
 * runs against the just-planted FULL-TTL token (≫ the preflight lead), so it
 * never re-enters the refresh path; `refreshAllSessions` uses a raw `fetch` with
 * `credentials:'include'`.
 */
export function createInSessionRefreshHandler(oxyServices: OxyServices): AuthRefreshHandler {
  return async (reason: AuthRefreshReason): Promise<string | null> => {
    if (!isWebBrowser()) {
      try {
        const session = await oxyServices.signInWithSharedIdentity?.();
        if (session) {
          // `verifyChallenge` inside `signInWithSharedIdentity` already planted
          // the fresh tokens; read the planted access token back out.
          return oxyServices.getAccessToken();
        }
      } catch (error) {
        debugRefresh('Native shared-key in-session refresh failed', reason, error);
      }
      return null;
    }

    // WEB arm 1 — first-party silent iframe at the per-apex IdP.
    try {
      const perApexAuthUrl = autoDetectAuthWebUrl();
      if (perApexAuthUrl) {
        const session = await oxyServices.silentSignIn?.({
          authWebUrlOverride: perApexAuthUrl,
          timeout: SILENT_IFRAME_REFRESH_TIMEOUT,
        });
        if (session) {
          return oxyServices.getAccessToken();
        }
      }
    } catch (error) {
      debugRefresh('Silent-iframe in-session refresh failed', reason, error);
    }

    // WEB arm 2 — FedCM silent re-auth (Chrome).
    try {
      if (oxyServices.isFedCMSupported?.() === true) {
        const session = await oxyServices.silentSignInWithFedCM?.();
        if (session) {
          return oxyServices.getAccessToken();
        }
      }
    } catch (error) {
      debugRefresh('FedCM-silent in-session refresh failed', reason, error);
    }

    // WEB arm 3 — same-apex refresh cookie.
    try {
      const snapshot = await oxyServices.refreshAllSessions({ timeout: COOKIE_REFRESH_TIMEOUT });
      if (snapshot.accounts.length > 0) {
        const persistedAuthuser = readActiveAuthuser();
        const active =
          (persistedAuthuser !== null
            ? snapshot.accounts.find((account) => account.authuser === persistedAuthuser)
            : undefined) ?? snapshot.accounts[0];
        oxyServices.httpService.setTokens(active.accessToken);
        return oxyServices.getAccessToken();
      }
    } catch (error) {
      debugRefresh('Refresh-cookie in-session refresh failed', reason, error);
    }

    return null;
  };
}

/**
 * Handle returned by {@link startTokenRefreshScheduler}; call `dispose()` to tear
 * down the timer and the foreground listener.
 */
export interface TokenRefreshSchedulerHandle {
  dispose(): void;
}

/**
 * Start the proactive in-session refresh scheduler against `oxyServices`.
 *
 * Schedules a single timer to fire {@link TOKEN_REFRESH_LEAD_MS} before the
 * current access token's `exp`, calling `httpService.refreshAccessToken`
 * ('preflight') — which runs the installed handler and is deduped + cooldown-
 * guarded. After every attempt it reschedules from the (possibly rotated) token.
 * It also reschedules whenever the token changes (`onTokensChanged`) and, on
 * web tab-focus / native app-foreground, refreshes immediately if already inside
 * the lead window (a long-hidden tab throttles timers, so the token can be
 * expired on return).
 *
 * No-ops cleanly when there is no token, an opaque/no-`exp` token, or the host
 * lacks `getAccessTokenExpiry` (older stubs) — in those cases the reactive 401
 * path remains the only refresh trigger.
 */
export function startTokenRefreshScheduler(oxyServices: OxyServices): TokenRefreshSchedulerHandle {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const runRefresh = (): void => {
    // `refreshAccessToken` is deduped + cooldown-guarded internally, so this is
    // safe to call from the timer, the foreground listener, and request-time
    // preflight concurrently — they collapse to one network attempt.
    const refresh = oxyServices.httpService.refreshAccessToken?.('preflight');
    if (!refresh) {
      return;
    }
    void refresh
      .catch(() => null)
      .finally(() => {
        if (!disposed) {
          schedule();
        }
      });
  };

  const schedule = (): void => {
    clearTimer();
    if (disposed || !oxyServices.getAccessToken()) {
      return;
    }
    const expSeconds = oxyServices.getAccessTokenExpiry?.() ?? null;
    if (expSeconds === null) {
      return;
    }
    const fireInMs = expSeconds * 1000 - Date.now() - TOKEN_REFRESH_LEAD_MS;
    timer = setTimeout(runRefresh, Math.max(fireInMs, 0));
  };

  const onForeground = (): void => {
    if (disposed || !oxyServices.getAccessToken()) {
      return;
    }
    const expSeconds = oxyServices.getAccessTokenExpiry?.() ?? null;
    if (expSeconds === null) {
      return;
    }
    const remainingMs = expSeconds * 1000 - Date.now();
    if (remainingMs <= TOKEN_REFRESH_LEAD_MS) {
      runRefresh();
    } else {
      schedule();
    }
  };

  const unsubscribeTokens = oxyServices.onTokensChanged(() => {
    if (!disposed) {
      schedule();
    }
  });

  let removeForeground: (() => void) | null = null;
  if (isWebBrowser() && typeof document !== 'undefined') {
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        onForeground();
      }
    };
    document.addEventListener('visibilitychange', handler);
    removeForeground = () => document.removeEventListener('visibilitychange', handler);
  } else if (!isWebBrowser() && AppState && typeof AppState.addEventListener === 'function') {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        onForeground();
      }
    });
    removeForeground = () => subscription.remove();
  }

  schedule();

  return {
    dispose(): void {
      disposed = true;
      clearTimer();
      unsubscribeTokens();
      removeForeground?.();
      removeForeground = null;
    },
  };
}
