/**
 * Web-only persistence of the active multi-account slot index.
 *
 * Google-style multi-account sign-in stores ONE refresh cookie per device
 * slot (`oxy_rt_${authuser}`, where `authuser` is an integer 0..N). The
 * server's `/auth/refresh-all` returns one entry per valid cookie; the
 * client must remember WHICH slot is currently active across reloads so
 * that the cold-boot snapshot resolves to the user's last selection
 * rather than always defaulting to slot 0.
 *
 * The persisted value is JUST the slot INDEX (a small integer) — never an
 * access token, refresh token, session id, or any user-identifying secret.
 * It is read by both `OxyContext` (cold-boot active selection) and the
 * session-management / auth-operations hooks (switch / logout).
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
} from '@oxyhq/core';

const ACTIVE_AUTHUSER_KEY = 'oxy_active_authuser';

function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
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
 * Persist the active `authuser` slot index. No-ops on native and on any
 * storage failure (e.g. Safari private mode). Callers MUST NOT depend on
 * this succeeding — it is best-effort UX persistence, not authoritative.
 */
export function writeActiveAuthuser(authuser: number): void {
  if (!hasLocalStorage()) return;
  if (!Number.isFinite(authuser) || authuser < 0) return;
  try {
    window.localStorage.setItem(ACTIVE_AUTHUSER_KEY, String(authuser));
  } catch {
    // Best-effort persistence; swallow QuotaExceededError / SecurityError.
  }
}

/**
 * Clear the persisted active `authuser` slot index. Called on full sign-out
 * (logoutAll) so that the next cold boot doesn't try to resurrect a
 * cleared slot.
 */
export function clearActiveAuthuser(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(ACTIVE_AUTHUSER_KEY);
  } catch {
    // Best-effort.
  }
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
  if (!hasSessionStorage()) return;
  const origin = window.location.origin;
  try {
    window.sessionStorage.removeItem(ssoAttemptedKey(origin));
    window.sessionStorage.removeItem(ssoNoSessionKey(origin));
    window.sessionStorage.removeItem(ssoGuardKey(origin));
    window.sessionStorage.removeItem(ssoStateKey(origin));
    window.sessionStorage.removeItem(ssoDestKey(origin));
  } catch {
    // Best-effort; swallow SecurityError (e.g. Safari private mode).
  }
}

export { ACTIVE_AUTHUSER_KEY };
