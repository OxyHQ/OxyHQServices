/**
 * Central cross-domain SSO bounce helpers (web-only).
 *
 * These pure helpers back the `sso-return` and `sso-bounce` cold-boot steps in
 * `WebOxyProvider`. They mirror the equivalent helpers in `@oxyhq/services`
 * `OxyContext` exactly so both providers behave identically (consistency
 * mandate).
 *
 * The flow (TRUE central cross-domain SSO, Google/Meta/Clerk style):
 *   1. An RP (e.g. mention.earth) with no local session does a TOP-LEVEL
 *      navigation to `auth.oxy.so/sso?prompt=none&client_id=<origin>&return_to=
 *      <origin>{@link SSO_CALLBACK_PATH}&state=<s>` (the `sso-bounce` step).
 *   2. The central worker reads its `fedcm_session` cookie, mints a session,
 *      stores it under an opaque single-use code, and 303-redirects back to
 *      `<origin>{@link SSO_CALLBACK_PATH}#oxy_sso=ok&code=<code>&state=<s>`
 *      (or `#oxy_sso=none` / `#oxy_sso=error`).
 *   3. On return the RP parses the fragment, validates `state`, exchanges the
 *      code via `oxyServices.exchangeSsoCode(code)`, and is signed in (the
 *      `sso-return` step).
 *
 * Loop proof (logged-out): load1 all steps skip → `sso-bounce` sets
 * guard/state/dest and navigates; `/sso` has no cookie → returns
 * `#oxy_sso=none`; load2 (on the callback) `sso-return` sees `none`, sets the
 * NO_SESSION flag, skips → `sso-bounce` is now disabled. Exactly ONE bounce, no
 * loop. An interrupted bounce self-heals after the guard's 30s TTL.
 *
 * Every key is suffixed with the RP origin so multiple origins sharing a
 * `sessionStorage` backing (they never do in practice, but defensively) cannot
 * collide.
 */

import { CENTRAL_AUTH_URL, resolveCentralAuthUrl } from '@oxyhq/core';

/**
 * The RP path the central IdP redirects back to after a bounce. The provider
 * restores the user's real destination (stored under {@link ssoDestKey}) once
 * the return is processed, so the user never lingers on this internal path.
 */
export const SSO_CALLBACK_PATH = '/__oxy/sso-callback';

/**
 * Guard TTL (ms). An in-flight bounce sets a timestamp guard; if the user
 * navigates away or the bounce is interrupted, a stale guard older than this
 * window is treated as absent so the flow can self-heal. 30s comfortably
 * exceeds a real redirect round-trip while keeping a crash short-lived.
 */
export const SSO_GUARD_TTL_MS = 30_000;

/** Per-origin sessionStorage key for the CSRF state of an in-flight bounce. */
export function ssoStateKey(origin: string): string {
  return `oxy_sso_state:${origin}`;
}

/**
 * Per-origin sessionStorage flag set when the central IdP reported NO session
 * (or an error). While present, `sso-bounce` is disabled — this is the load2
 * half of the loop proof.
 */
export function ssoNoSessionKey(origin: string): string {
  return `oxy_sso_no_session:${origin}`;
}

/** Per-origin sessionStorage key holding the timestamp of an in-flight bounce. */
export function ssoGuardKey(origin: string): string {
  return `oxy_sso_guard:${origin}`;
}

/**
 * Per-origin sessionStorage key holding the user's real destination URL,
 * captured at bounce time so it can be restored after the callback.
 */
export function ssoDestKey(origin: string): string {
  return `oxy_sso_dest:${origin}`;
}

/**
 * Build the central IdP `/sso` bounce URL for an RP.
 *
 * Pure (no DOM access) so it is unit-testable and shared by the provider's
 * terminal `sso-bounce` step. The IdP reads `client_id` (the RP origin) and
 * `return_to` to mint an origin-bound opaque code and 303-redirect back.
 *
 * The IdP base is resolved via {@link resolveCentralAuthUrl} so an explicit
 * `authWebUrl` override (e.g. a staging IdP) drives the SSO bounce exactly the
 * way it drives FedCM — mirroring the services `OxyContext` bounce, which
 * builds from `resolveCentralAuthUrl(oxyServices.config?.authWebUrl)`. When
 * omitted, the central default {@link CENTRAL_AUTH_URL} is used.
 *
 * @param origin - The RP origin (`window.location.origin`).
 * @param state - The CSRF state minted for this bounce.
 * @param authWebUrl - Optional explicit IdP base URL override. Falls back to
 *   the central default when `undefined`/empty.
 * @returns The absolute `<idp-origin>/sso?...` URL string.
 */
export function buildSsoBounceUrl(
  origin: string,
  state: string,
  authWebUrl?: string,
): string {
  const url = new URL('/sso', resolveCentralAuthUrl(authWebUrl));
  url.searchParams.set('prompt', 'none');
  url.searchParams.set('client_id', origin);
  url.searchParams.set('return_to', origin + SSO_CALLBACK_PATH);
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * The origin of the central IdP, derived once from {@link CENTRAL_AUTH_URL}.
 * `new URL(...).origin` normalises away any path/trailing slash.
 */
const CENTRAL_IDP_ORIGIN = (() => {
  try {
    return new URL(CENTRAL_AUTH_URL).origin;
  } catch {
    return CENTRAL_AUTH_URL;
  }
})();

/**
 * True when `origin` is the central IdP itself. The RP must NEVER bounce while
 * sitting on `auth.oxy.so` — doing so would loop the IdP against itself.
 */
export function isCentralIdPOrigin(origin: string): boolean {
  return origin === CENTRAL_IDP_ORIGIN;
}

/**
 * Whether a bounce guard is currently active for `origin`.
 *
 * Active means the guard is present AND younger than {@link SSO_GUARD_TTL_MS}.
 * A guard older than the TTL is stale (the bounce was interrupted) and is
 * treated as inactive so the flow can self-heal on the next cold boot.
 *
 * @param now - Injectable clock for deterministic tests. Defaults to `Date.now`.
 */
export function guardActive(
  origin: string,
  storage: Pick<Storage, 'getItem'>,
  now: () => number = Date.now,
): boolean {
  const raw = storage.getItem(ssoGuardKey(origin));
  if (raw === null) {
    return false;
  }
  const ts = Number(raw);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return now() - ts < SSO_GUARD_TTL_MS;
}
