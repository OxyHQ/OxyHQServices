import type {
  AuthRefreshHandler,
  AuthRefreshReason,
  OxyServices,
  SessionLoginResponse,
} from '@oxyhq/core';
import { autoDetectAuthWebUrl, logger } from '@oxyhq/core';

/**
 * In-session access-token refresh for `@oxyhq/auth`'s `WebOxyProvider`.
 *
 * THE GAP THIS CLOSES (Fase 4 cutover — Task 5.2): `AuthManager` used to run
 * `setupCookieRefresh` (a timer that re-hit `POST /auth/refresh?authuser=N`
 * against the legacy `oxy_rt_${n}` cookie a fixed buffer before the access
 * token's expiry) plus a reactive `HttpService.setAuthRefreshHandler` that
 * called the SAME cookie-refresh path on a 401 or per-request preflight.
 * Retiring `AuthManager` (Task 5.3) drops BOTH of those without a
 * replacement — this module is that replacement, built entirely on
 * `SessionClient`-era primitives.
 *
 * WHY NOT `SessionClient.bootstrap()` (`GET /session/device/state`): that
 * route is itself bearer-gated (`authMiddleware`), and the server's
 * `resolveActiveToken` only mints a genuinely NEW token when the STORED
 * session's access token has ALREADY expired server-side — which is exactly
 * when the caller's OWN presented bearer (the identical JWT) would ALSO be
 * rejected by `authMiddleware` before ever reaching that logic. Worse,
 * calling it reactively from inside the registered `AuthRefreshHandler`
 * risks a genuine DEADLOCK: `HttpService.refreshAccessToken` guards
 * re-entrancy with a single per-instance `tokenRefreshPromise`, and
 * `bootstrap()`'s own internal request runs through the SAME
 * `getAuthHeader()` preflight check — which, given the near/at-expiry token
 * that triggered the refresh in the first place, would try to await that
 * very same in-flight promise a second time. So `SessionClient` REST calls
 * are deliberately never used here; every arm below mints a session through a
 * credential path that is fully independent of the current bearer.
 *
 * THE FIX, mirroring `@oxyhq/services`'s `inSessionTokenRefresh.ts` (the RN
 * reference implementation) minus its native `AppState`/shared-keychain arm
 * — `@oxyhq/auth` is web-only:
 *
 *  1. {@link createWebAuthRefreshHandler} — an `AuthRefreshHandler` installed
 *     on `oxyServices.httpService`. It re-mints a fresh access token WITHOUT
 *     a page reload by composing the SAME silent-restore primitive cold
 *     boot already relies on (the per-apex `/auth/silent` iframe) — not a
 *     copy — and commits the result exactly like a winning
 *     cold-boot ladder step would (via the caller-supplied
 *     `commitSilentSession`, which registers the recovered account into the
 *     `SessionClient` device set). There is no FedCM arm — FedCM was removed
 *     from the client sign-in/refresh path entirely (Chrome-only; see
 *     `CrossDomainAuth`'s doc comment in `@oxyhq/core` for the production
 *     sign-in loop that motivated the removal).
 *
 *  2. {@link startTokenRefreshScheduler} — a proactive scheduler that
 *     refreshes ~{@link TOKEN_REFRESH_LEAD_MS} before expiry (and on web
 *     tab-focus), so the common case never even reaches the reactive
 *     401-then-recover flash.
 *
 * Concurrency/cooldown/dedup are owned by `HttpService.refreshAccessToken`
 * (single in-flight `tokenRefreshPromise` + cooldown) — this module does not
 * reimplement them, so the timer and per-request preflight triggers collapse
 * to one network attempt (no refresh storm).
 */

/**
 * Per-arm fail-fast budget (ms) for the first-party `/auth/silent` iframe
 * arm. Slightly more generous than the cold-boot iframe budget (2.5s)
 * because an in-session refresh is NOT in the first-paint critical path — a
 * couple hundred ms of extra headroom for the same-origin handshake is worth
 * a higher success rate. `silentSignIn` still fail-fasts on `iframe.onerror`,
 * so a hard failure returns well before this.
 */
const SILENT_IFRAME_REFRESH_TIMEOUT = 4000;

/**
 * Lead time (ms) before access-token expiry at which the proactive scheduler
 * refreshes. Mirrors `HttpService`'s per-request `TOKEN_REFRESH_LEAD_SECONDS`
 * (60s) so the scheduled refresh and the request-time preflight refresh use
 * the same window — the scheduler simply fires it during idle/background
 * instead of waiting for the next request.
 */
export const TOKEN_REFRESH_LEAD_MS = 60_000;

/** A single refresh arm: mints a session, or resolves to `null` to fall through to the next arm. */
type RefreshArm = () => Promise<SessionLoginResponse | null>;

export interface WebAuthRefreshHandlerDeps {
  oxyServices: OxyServices;
  /**
   * Commit a freshly re-minted silent session exactly like a winning
   * cold-boot ladder step would: plant the token, register the account into
   * the `SessionClient` device set, and re-sync the projected state. Callers
   * supply this backed by a ref to the provider's `handleAuthSuccess` so the
   * handler always invokes the LATEST closure without listing it as an
   * effect dependency.
   */
  commitSilentSession: (
    session: SessionLoginResponse,
    method: 'credentials',
  ) => Promise<void>;
}

/**
 * Build the in-session `AuthRefreshHandler` for `WebOxyProvider`'s owner
 * `oxyServices` client. Arms run in order; the first to mint a session wins.
 * A throw in one arm is logged and treated as a fall-through so the chain
 * continues. Resolves to `null` when every arm is exhausted — `HttpService`
 * treats that as "refresh failed", clearing tokens and notifying
 * `onTokensChanged(null)`.
 */
export function createWebAuthRefreshHandler(deps: WebAuthRefreshHandlerDeps): AuthRefreshHandler {
  const runArm = async (
    label: string,
    reason: AuthRefreshReason,
    arm: RefreshArm,
  ): Promise<string | null> => {
    try {
      const session = await arm();
      if (!session) {
        return null;
      }
      await deps.commitSilentSession(session, 'credentials');
      return deps.oxyServices.getAccessToken();
    } catch (error) {
      logger.debug(
        `In-session refresh arm "${label}" failed (falling through)`,
        { component: 'tokenRefresh', method: 'authRefreshHandler', reason },
        error,
      );
      return null;
    }
  };

  const arms: Array<[string, RefreshArm]> = [
    ['silent-iframe', async () => {
      const perApexAuthUrl = autoDetectAuthWebUrl();
      if (!perApexAuthUrl) {
        return null;
      }
      const session = await deps.oxyServices.silentSignIn({
        authWebUrlOverride: perApexAuthUrl,
        timeout: SILENT_IFRAME_REFRESH_TIMEOUT,
      });
      return session?.user && session.sessionId ? session : null;
    }],
  ];

  return async (reason: AuthRefreshReason): Promise<string | null> => {
    for (const [label, arm] of arms) {
      const token = await runArm(label, reason, arm);
      if (token) {
        return token;
      }
    }
    return null;
  };
}

/**
 * Handle returned by {@link startTokenRefreshScheduler}; call `dispose()` to
 * tear down the timer and the tab-focus listener.
 */
export interface TokenRefreshSchedulerHandle {
  dispose(): void;
}

/**
 * Start the proactive in-session refresh scheduler against `oxyServices`.
 *
 * Schedules a single timer to fire {@link TOKEN_REFRESH_LEAD_MS} before the
 * current access token's `exp`, calling
 * `oxyServices.httpService.refreshAccessToken('preflight')` — which runs the
 * handler installed by {@link createWebAuthRefreshHandler} and is deduped +
 * cooldown-guarded. After every attempt it reschedules from the (possibly
 * rotated) token. It also reschedules whenever the token changes
 * (`onTokensChanged` — so a sign-out that clears the token cancels the
 * timer) and, on tab-focus, refreshes immediately if already inside the lead
 * window (a long-hidden tab throttles timers, so the token can be expired on
 * return).
 *
 * The `exp` is derived directly from the JWT via `getAccessTokenExpiry()`.
 * No-ops cleanly when there is no token or an opaque/no-`exp` token — the
 * reactive 401 path stays the only refresh trigger in that case.
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
    // `refreshAccessToken` is deduped + cooldown-guarded internally, so this
    // is safe to call from the timer and the focus listener concurrently
    // with request-time preflight — they collapse to one network attempt.
    void oxyServices.httpService.refreshAccessToken('preflight')
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
    const expSeconds = oxyServices.getAccessTokenExpiry();
    if (expSeconds === null) {
      return;
    }
    const fireInMs = expSeconds * 1000 - Date.now() - TOKEN_REFRESH_LEAD_MS;
    timer = setTimeout(runRefresh, Math.max(fireInMs, 0));
  };

  const onFocus = (): void => {
    if (disposed || !oxyServices.getAccessToken()) {
      return;
    }
    const expSeconds = oxyServices.getAccessTokenExpiry();
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

  let removeFocusListener: (() => void) | null = null;
  if (typeof document !== 'undefined') {
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        onFocus();
      }
    };
    document.addEventListener('visibilitychange', handler);
    removeFocusListener = () => document.removeEventListener('visibilitychange', handler);
  }

  schedule();

  return {
    dispose(): void {
      disposed = true;
      clearTimer();
      unsubscribeTokens();
      removeFocusListener?.();
      removeFocusListener = null;
    },
  };
}
