/**
 * Web-only helpers around the retired `oxy_rt_${authuser}` multi-slot
 * refresh-cookie scheme, PLUS the (unrelated, still load-bearing) deliberate
 * sign-out / SSO-bounce gates.
 *
 * NOTE (session-sync cutover, Task 5): the device account SET is now
 * server-authoritative via `SessionClient` (`@oxyhq/core`) — nothing in
 * `@oxyhq/services` writes the persisted active-`authuser`-slot key anymore
 * (`writeActiveAuthuser`/`clearActiveAuthuser` were deleted; their only
 * callers were the deleted `establishDeviceRefreshSlot` sign-in registration
 * and the deleted `switchToAccount`/`switchSession` slot bookkeeping).
 * {@link readActiveAuthuser} is KEPT: `OxyContext`'s `restoreStoredSession`
 * cold-boot step still reads it as part of a deliberate, test-locked gate —
 * on web, a bare stored session id with neither a live in-memory bearer nor
 * this hint is NOT validated locally; recovery instead defers to the
 * authoritative per-apex-iframe / SSO-bounce chain. Since
 * nothing writes the key anymore that branch is now permanently dormant, but
 * the gate itself remains correct and is exercised by
 * `coldBootOrder.test.tsx`.
 *
 * Native (React Native) has no equivalent of these device-local cookies
 * and uses bearer-protected session ids directly, so these helpers no-op
 * outside the browser.
 */

import {
  ssoAttemptedKey,
  ssoNoSessionKey,
  ssoGuardKey,
  ssoStateKey,
  ssoDestKey,
  ssoSignedOutKey,
  silentRestoreSuppressed,
} from '@oxyhq/core';

const ACTIVE_AUTHUSER_KEY = 'oxy_active_authuser';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the persisted active `authuser` slot index.
 *
 * Returns `null` on native, on a corrupted value, or when nothing has been
 * persisted yet (first visit). Callers treat `null` as "no preference" and
 * fall back to deterministic selection (lowest authuser).
 */
export function readActiveAuthuser(): number | null {
  if (!hasLocalStorage()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(ACTIVE_AUTHUSER_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Mark this origin as DELIBERATELY signed out (durable `localStorage`, via the
 * core {@link ssoSignedOutKey}). Called ONLY on EXPLICIT full sign-out so that
 * the next cold boot does NOT silently re-mint a session from a still-live IdP
 * session (the per-apex `/auth/silent` iframe cold-boot step). Cleared by any
 * deliberate sign-in (see {@link clearSignedOut}). No-ops on native / storage
 * failure (best-effort).
 */
export function markSignedOut(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(ssoSignedOutKey(window.location.origin), '1');
  } catch {
    // Best-effort; swallow QuotaExceededError / SecurityError (private mode).
  }
}

/**
 * Clear the durable deliberately-signed-out flag. Called on ANY deliberate
 * sign-in (password, account switch, device claim) so a real sign-in
 * fully re-enables automatic silent restore — there is no "stuck signed out"
 * state. No-ops on native / storage failure.
 */
export function clearSignedOut(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(ssoSignedOutKey(window.location.origin));
  } catch {
    // Best-effort.
  }
}

/**
 * Whether AUTOMATIC silent restore is suppressed for the current origin because
 * the user deliberately signed out. Reads the durable flag through the core
 * {@link silentRestoreSuppressed} predicate. Returns `false` off-web and on any
 * storage failure (fail safe toward normal restore). Used to gate the
 * `silent-iframe` cold-boot step.
 */
export function isSilentRestoreSuppressed(): boolean {
  // Unlike its try/catch-wrapped siblings this reads `window.location.origin`
  // directly, so guard it: an RN polyfill can expose `localStorage` without a
  // `location`, which would throw here. Fail safe toward normal restore.
  if (!hasLocalStorage() || typeof window.location === 'undefined') return false;
  return silentRestoreSuppressed(window.localStorage, window.location.origin);
}

/**
 * Clear all per-origin SSO bounce sessionStorage keys. Called ONLY on EXPLICIT
 * user sign-out (logout / logoutAll) — never on a cold-boot failure path — so a
 * fresh deliberate sign-in can re-probe the central IdP. Clearing on cold-boot
 * failure would reintroduce the redirect loop.
 *
 * No-ops on native and on any storage failure (best-effort).
 */
export function clearSsoBounceState(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    const origin = window.location.origin;
    storage.removeItem(ssoAttemptedKey(origin));
    storage.removeItem(ssoNoSessionKey(origin));
    storage.removeItem(ssoGuardKey(origin));
    storage.removeItem(ssoStateKey(origin));
    storage.removeItem(ssoDestKey(origin));
  } catch {
    // Best-effort; swallow SecurityError (e.g. Safari private mode).
  }
}
