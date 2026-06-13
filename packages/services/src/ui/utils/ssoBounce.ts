/**
 * Central cross-domain SSO bounce — per-origin sessionStorage keys and small
 * pure predicates shared by the cold-boot `sso-return` / `sso-bounce` steps and
 * the bfcache `pageshow` re-evaluation.
 *
 * TRUE central SSO (Google/Meta/Clerk style) works like this for a Relying
 * Party (mention.earth, homiio.com, alia.onl, …) with no local session:
 *
 *   1. `sso-bounce` (terminal, once): top-level navigate to
 *      `auth.oxy.so/sso?prompt=none&client_id=<origin>&return_to=<origin>/__oxy/sso-callback&state=<s>`.
 *      Before navigating it records, in this origin's `sessionStorage`, the CSRF
 *      `state`, a guard timestamp (loop breaker), and the real destination URL
 *      to restore after the callback.
 *   2. The central IdP worker reads its first-party `fedcm_session`, mints a
 *      session, stores it under an opaque single-use `code`, and 303-redirects
 *      back to `<origin>/__oxy/sso-callback#oxy_sso=ok&code=<code>&state=<s>`
 *      (or `#oxy_sso=none` / `#oxy_sso=error`).
 *   3. `sso-return` parses the fragment (`parseSsoReturnFragment` from core),
 *      validates `state`, exchanges the `code` via `oxyServices.exchangeSsoCode`,
 *      and commits the session — then restores the original destination.
 *
 * Loop proof (logged-out): first load all steps skip → `sso-bounce` sets
 * guard/state/dest and navigates; the IdP (no central session) returns
 * `#oxy_sso=none`; the callback load's `sso-return` sees `none`, sets the
 * no-session flag, and `sso-bounce` is then disabled. Exactly ONE bounce, no
 * loop. An interrupted bounce (user hit back mid-redirect) self-heals once the
 * 30s guard TTL lapses.
 *
 * All state lives in `sessionStorage` (per tab, cleared on tab close) and is
 * keyed per-origin so two RPs hosted in the same browser never collide. This
 * module is pure with respect to navigation: it only reads/writes
 * `sessionStorage` and parses URLs; it performs no redirects itself.
 */

import { CENTRAL_AUTH_URL } from '@oxyhq/core';

/**
 * The RP callback path the central IdP redirects back to. The SSO result is
 * delivered in the fragment of this URL; `sso-return` consumes it and then
 * restores the user's real destination.
 */
export const SSO_CALLBACK_PATH = '/__oxy/sso-callback';

/**
 * Self-healing TTL (ms) for the bounce guard. If a bounce is interrupted before
 * the callback lands (e.g. the user navigates back mid-redirect), the guard
 * would otherwise pin the RP signed-out forever. After this window the guard is
 * treated as stale and a fresh single bounce is permitted.
 */
export const SSO_GUARD_TTL_MS = 30_000;

const STATE_KEY_PREFIX = 'oxy_sso_state:';
const GUARD_KEY_PREFIX = 'oxy_sso_guard:';
const DEST_KEY_PREFIX = 'oxy_sso_dest:';
const NO_SESSION_KEY_PREFIX = 'oxy_sso_no_session:';

/**
 * Perform the terminal top-level SSO bounce navigation.
 *
 * A thin wrapper over `window.location.assign(url)` so the single navigation
 * seam lives in one place (and stays mockable in tests, where jsdom's
 * `Location.assign` is a non-configurable native method). In production this is
 * exactly `window.location.assign` — the document is torn down and replaced by
 * the central IdP page. Off-browser it is a no-op (native never bounces).
 */
export function ssoNavigate(url: string): void {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return;
  }
  window.location.assign(url);
}

/** Per-origin CSRF state key (matched on return to defeat fragment forgery). */
export function ssoStateKey(origin: string): string {
  return `${STATE_KEY_PREFIX}${origin}`;
}

/** Per-origin bounce guard key (a timestamp; loop breaker + self-heal TTL). */
export function ssoGuardKey(origin: string): string {
  return `${GUARD_KEY_PREFIX}${origin}`;
}

/** Per-origin destination key (the real URL to restore after the callback). */
export function ssoDestKey(origin: string): string {
  return `${DEST_KEY_PREFIX}${origin}`;
}

/**
 * Per-origin "the central IdP has no session for me" key. Set after a
 * `none`/`error` return (or a failed/forged exchange) so `sso-bounce` does not
 * fire again this tab — the definitive loop breaker.
 */
export function ssoNoSessionKey(origin: string): string {
  return `${NO_SESSION_KEY_PREFIX}${origin}`;
}

/**
 * Whether `origin` IS the central IdP origin. We must never bounce while on
 * `auth.oxy.so` itself (it would bounce to itself). Compared by URL origin so a
 * trailing-slash / path difference never defeats the guard.
 */
export function isCentralIdPOrigin(origin: string): boolean {
  let centralOrigin: string;
  try {
    centralOrigin = new URL(CENTRAL_AUTH_URL).origin;
  } catch {
    return false;
  }
  let candidateOrigin: string;
  try {
    candidateOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  return candidateOrigin === centralOrigin;
}

/**
 * Read the bounce guard and decide whether it is still ACTIVE.
 *
 * Active means: a guard value is present AND it parses to a finite timestamp AND
 * less than {@link SSO_GUARD_TTL_MS} has elapsed since it was set. An active
 * guard disables `sso-bounce` (a bounce is already in flight this tab). A
 * missing, malformed, or expired guard is NOT active, so a fresh bounce may
 * proceed (this is the 30s self-heal for an interrupted bounce).
 *
 * @param storage - The session storage to read (injected for testability).
 * @param origin - The page origin whose guard to evaluate.
 * @param now - Current epoch ms (injected for deterministic tests).
 */
export function guardActive(storage: Storage, origin: string, now: number): boolean {
  let raw: string | null;
  try {
    raw = storage.getItem(ssoGuardKey(origin));
  } catch {
    return false;
  }
  if (raw === null || raw.length === 0) {
    return false;
  }
  const stamp = Number(raw);
  if (!Number.isFinite(stamp)) {
    return false;
  }
  return now - stamp < SSO_GUARD_TTL_MS;
}
