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
 * Mark this origin as DELIBERATELY signed out (durable `localStorage`, via the
 * core {@link ssoSignedOutKey}). Called ONLY on EXPLICIT full sign-out so that
 * the next cold boot does NOT silently re-mint a session from a still-live IdP
 * session (`fedcm-silent` / per-apex `/auth/silent` iframe). Cleared by any
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
 * sign-in (password, FedCM, account switch, device claim) so a real sign-in
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
 * `fedcm-silent` and `silent-iframe` cold-boot steps.
 */
export function isSilentRestoreSuppressed(): boolean {
  if (!hasLocalStorage()) return false;
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

export { ACTIVE_AUTHUSER_KEY };
