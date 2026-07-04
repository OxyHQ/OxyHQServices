/**
 * Unified token refresh — THE single refresh implementation for web + native.
 *
 * Before device-first, refresh was duplicated: `@oxyhq/auth`'s
 * `session/tokenRefresh.ts` (per-apex `/auth/silent` iframe) and
 * `@oxyhq/services`'s `inSessionTokenRefresh.ts` (native shared-key). This
 * module replaces both with ONE persisted-refresh-token rotation shared by
 * every consumer:
 *
 *  - `refreshPersistedSession` — arm 1 rotates the stored refresh-token family
 *    (`POST /auth/refresh-token`), planting + persisting the rotated pair; arm 2
 *    (native only) re-mints via the shared-keychain identity when there is no
 *    live refresh token. It is used BOTH reactively (wrapped as the
 *    `AuthRefreshHandler` installed on `HttpService`) AND proactively (the
 *    cold-boot `stored-tokens` step calls it directly).
 *  - `createAuthRefreshHandler` / `installAuthRefreshHandler` wire arm 1+2 into
 *    `HttpService.setAuthRefreshHandler`, keeping that layer's single-flight
 *    dedup + cooldown (this module does NOT reimplement them).
 *  - `startTokenRefreshScheduler` — a proactive scheduler (lifted from the
 *    better of the two prior duplicates, `@oxyhq/auth`'s `tokenRefresh.ts`),
 *    decoupled from any React / auth-sdk type: refreshes ~60s before `exp`,
 *    re-arms on token change + web tab-focus, `.unref?.()`s its timer in Node.
 *
 * Framework-free; no module-level mutable state.
 */
import type { OxyServices } from '../OxyServices';
import type { AuthRefreshHandler, AuthRefreshReason } from '../HttpService';
import type { AuthStateStore, PersistedAuthState } from './authStateStore';
import { isNative } from '../utils/platform';
import { logger } from '../utils/loggerUtils';

/**
 * Lead time (ms) before access-token expiry at which the proactive scheduler
 * refreshes. Mirrors `HttpService`'s per-request `TOKEN_REFRESH_LEAD_SECONDS`
 * (60s) so the scheduled refresh and the request-time preflight refresh use
 * the same window — the scheduler just fires it during idle/background.
 */
export const TOKEN_REFRESH_LEAD_MS = 60_000;

/**
 * Max `setTimeout` delay (2^31 − 1 ms, ~24.8 days). A larger delay overflows
 * the int32 timer field and fires IMMEDIATELY — with a long-TTL token that
 * turns the reschedule-on-finish loop into a tight busy refresh. Clamp to it.
 */
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;

/**
 * Floor (ms) on ANY scheduled delay. An already-expired / in-lead-window token
 * computes a non-positive `exp − now − lead`; without this floor that becomes
 * `setTimeout(…, 0)`, and a FAILING refresh (offline / server error) would
 * re-arm at 0 in the finally block → a tight 100%-CPU busy loop. The floor
 * guarantees every re-arm yields the event loop.
 */
const MIN_SCHEDULE_DELAY_MS = 1_000;

/**
 * Backoff schedule (ms) applied when a scheduled refresh FAILS: first retry
 * after {@link MIN_FAILURE_BACKOFF_MS}, doubling up to {@link MAX_FAILURE_BACKOFF_MS}.
 * Reset to 0 on any success or token change. This is what converts the former
 * zero-delay failure loop into a bounded, backing-off retry.
 */
const MIN_FAILURE_BACKOFF_MS = 5_000;
const MAX_FAILURE_BACKOFF_MS = 5 * 60_000;

/**
 * Error codes (in addition to HTTP 401/403) that mean the stored refresh token
 * is permanently unusable — the family was revoked or a reuse was detected. On
 * any of these the persisted store is CLEARED (the session is truly over);
 * transient failures (network, 5xx) leave the store intact so a later attempt
 * can still succeed.
 */
const REVOKED_REFRESH_CODES = new Set([
  'invalid_grant',
  'refresh_token_revoked',
  'refresh_token_reuse',
  'token_reuse',
  'invalid_token',
]);

interface HttpishError {
  status?: number;
  code?: string;
}

/** Does this error mean the refresh token is permanently dead (vs. transient)? */
function isRevokedRefreshError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as HttpishError;
  if (e.status === 401 || e.status === 403) {
    return true;
  }
  return typeof e.code === 'string' && REVOKED_REFRESH_CODES.has(e.code);
}

export interface RefreshDeps {
  oxy: OxyServices;
  store: AuthStateStore;
  /**
   * Whether to fall back to the native shared-keychain re-mint (arm 2) when
   * there is no live refresh token / arm 1 is revoked. Defaults to `isNative()`
   * — web has no shared keychain. Exposed for tests.
   */
  allowSharedKeyFallback?: boolean;
}

/**
 * Rotate the persisted session and return the fresh access token, or `null`
 * when no arm could produce one.
 *
 * Arm 1 (`POST /auth/refresh-token`): if the store holds a refresh token, rotate
 * it — on success plant + persist the rotated pair; on a REVOKED error clear the
 * store; on a transient error leave the store and return `null`.
 *
 * Arm 2 (native shared-keychain): when there is no refresh token or arm 1 was
 * revoked, re-mint via `signInWithSharedIdentity` (which plants tokens). The
 * shared keychain — not the per-origin store — is the durable native credential,
 * so this arm does not write the store.
 */
export async function refreshPersistedSession(deps: RefreshDeps): Promise<string | null> {
  const { oxy, store } = deps;
  const allowSharedKeyFallback = deps.allowSharedKeyFallback ?? isNative();

  const persisted = await store.load();

  if (persisted?.refreshToken) {
    try {
      const rotated = await oxy.refreshWithToken(persisted.refreshToken);
      oxy.setTokens(rotated.accessToken);
      const next: PersistedAuthState = {
        sessionId: rotated.sessionId,
        refreshToken: rotated.refreshToken,
        userId: persisted.userId,
        accessToken: rotated.accessToken,
        expiresAt: rotated.expiresAt,
      };
      if (persisted.deviceToken) {
        next.deviceToken = persisted.deviceToken;
      }
      await store.save(next);
      return rotated.accessToken;
    } catch (error) {
      if (isRevokedRefreshError(error)) {
        await store.clear();
        // Fall through to the native shared-key arm below — on a shared-key
        // device the refresh family being revoked does not end the session.
      } else {
        logger.debug(
          'Persisted refresh failed (transient) — keeping store',
          { component: 'refresh', method: 'refreshPersistedSession' },
          error,
        );
        return null;
      }
    }
  }

  if (allowSharedKeyFallback) {
    try {
      const session = await oxy.signInWithSharedIdentity();
      if (session?.accessToken) {
        return session.accessToken;
      }
    } catch (error) {
      logger.debug(
        'Shared-key refresh fallback failed',
        { component: 'refresh', method: 'refreshPersistedSession' },
        error,
      );
    }
  }

  return null;
}

/**
 * Build the reactive `AuthRefreshHandler` (arm 1 + arm 2). Install it via
 * {@link installAuthRefreshHandler} or directly on
 * `oxy.httpService.setAuthRefreshHandler`. `HttpService` owns single-flight
 * dedup + cooldown, so the timer, the request-time preflight, and a 401 all
 * collapse to one network attempt.
 */
export function createAuthRefreshHandler(deps: RefreshDeps): AuthRefreshHandler {
  return async (_reason: AuthRefreshReason): Promise<string | null> => {
    return refreshPersistedSession(deps);
  };
}

/**
 * Install the unified refresh handler on the owner client's `HttpService`.
 * Returns a disposer that removes it.
 */
export function installAuthRefreshHandler(deps: RefreshDeps): () => void {
  deps.oxy.httpService.setAuthRefreshHandler(createAuthRefreshHandler(deps));
  return () => {
    deps.oxy.httpService.setAuthRefreshHandler(null);
  };
}

/** Handle returned by {@link startTokenRefreshScheduler}; `dispose()` tears it down. */
export interface TokenRefreshSchedulerHandle {
  dispose(): void;
}

/**
 * Start the proactive refresh scheduler against `oxy`.
 *
 * Schedules a single timer to fire {@link TOKEN_REFRESH_LEAD_MS} before the
 * current access token's `exp`, calling
 * `oxy.httpService.refreshAccessToken('preflight')` (which runs the installed
 * handler; deduped + cooldown-guarded). After every attempt it reschedules
 * from the possibly-rotated token. It also reschedules whenever the token
 * changes (a sign-out that clears the token cancels the timer) and, on web
 * tab-focus, refreshes immediately if already inside the lead window (a
 * long-hidden tab throttles timers, so the token can be expired on return).
 *
 * No-ops cleanly when there is no token or an opaque/no-`exp` token — the
 * reactive 401 path stays the only refresh trigger in that case. The timer is
 * `.unref?.()`-ed so it never keeps a Node/Jest event loop alive.
 */
export function startTokenRefreshScheduler(oxy: OxyServices): TokenRefreshSchedulerHandle {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 0 = no active backoff; grows on consecutive failures, resets on success /
  // token change. Keeps a failing refresh from re-arming at zero delay.
  let failureBackoffMs = 0;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Arm the timer for `delayMs`, flooring at {@link MIN_SCHEDULE_DELAY_MS} and capping at the int32 max. */
  const armTimer = (delayMs: number): void => {
    clearTimer();
    const clamped = Math.min(Math.max(delayMs, MIN_SCHEDULE_DELAY_MS), MAX_TIMEOUT_DELAY_MS);
    timer = setTimeout(runRefresh, clamped);
    // Never keep a Node/Jest event loop alive for a background refresh timer.
    timer.unref?.();
  };

  /** Schedule the next refresh from the current token's expiry (the healthy path). */
  const scheduleFromExpiry = (): void => {
    clearTimer();
    if (disposed || !oxy.getAccessToken()) {
      return;
    }
    const expSeconds = oxy.getAccessTokenExpiry();
    if (expSeconds === null) {
      return;
    }
    armTimer(expSeconds * 1000 - Date.now() - TOKEN_REFRESH_LEAD_MS);
  };

  const runRefresh = (): void => {
    // Clear any pending timer up front so an out-of-band trigger (focus) plus
    // a fired timer can never double-run.
    clearTimer();
    void oxy.httpService.refreshAccessToken('preflight')
      .then((token) => Boolean(token))
      .catch(() => false)
      .then((ok) => {
        if (disposed) {
          return;
        }
        if (ok) {
          // Success — drop any backoff and re-arm from the rotated token's exp.
          failureBackoffMs = 0;
          scheduleFromExpiry();
          return;
        }
        // Failure — back off (never re-arm at zero) and retry.
        failureBackoffMs =
          failureBackoffMs === 0
            ? MIN_FAILURE_BACKOFF_MS
            : Math.min(failureBackoffMs * 2, MAX_FAILURE_BACKOFF_MS);
        armTimer(failureBackoffMs);
      });
  };

  /** Public (re)schedule entry: a fresh token / focus signal — drop backoff and arm from expiry. */
  const schedule = (): void => {
    failureBackoffMs = 0;
    scheduleFromExpiry();
  };

  const onFocus = (): void => {
    if (disposed || !oxy.getAccessToken()) {
      return;
    }
    const expSeconds = oxy.getAccessTokenExpiry();
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

  const unsubscribeTokens = oxy.onTokensChanged(() => {
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
