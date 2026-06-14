/**
 * Central cross-domain SSO bounce — per-origin sessionStorage keys, the bounce
 * URL builder, and the small pure predicates shared by every consumer's
 * cold-boot `sso-return` / `sso-bounce` steps and bfcache `pageshow`
 * re-evaluation.
 *
 * This is the single source of truth for the SSO bounce wire/storage contract.
 * `@oxyhq/auth` (`WebOxyProvider`) and `@oxyhq/services` (`OxyContext`) both
 * consume these helpers so the two providers behave identically.
 *
 * TRUE central SSO (Google/Meta/Clerk style) works like this for a Relying
 * Party (mention.earth, homiio.com, alia.onl, …) with no local session:
 *
 *   1. `sso-bounce` (terminal, once): a TOP-LEVEL navigation to
 *      `auth.oxy.so/sso?prompt=none&client_id=<origin>&return_to=<origin>{@link SSO_CALLBACK_PATH}&state=<s>`.
 *      Before navigating it records, in this origin's `sessionStorage`, the
 *      CSRF `state` ({@link ssoStateKey}), a guard timestamp ({@link ssoGuardKey},
 *      the loop breaker), and the real destination URL ({@link ssoDestKey}) to
 *      restore after the callback.
 *   2. The central IdP worker reads its first-party `fedcm_session`, mints a
 *      session, stores it under an opaque single-use `code`, and 303-redirects
 *      back to `<origin>{@link SSO_CALLBACK_PATH}#oxy_sso=ok&code=<code>&state=<s>`
 *      (or `#oxy_sso=none` / `#oxy_sso=error`).
 *   3. `sso-return` parses the fragment (`parseSsoReturnFragment`), validates
 *      `state`, exchanges the `code` via `oxyServices.exchangeSsoCode`, commits
 *      the session, then restores the original destination.
 *
 * Loop proof (logged-out): first load all steps skip → `sso-bounce` sets
 * guard/state/dest and navigates; the IdP (no central session) returns
 * `#oxy_sso=none`; the callback load's `sso-return` sees `none`, sets the
 * NO_SESSION flag ({@link ssoNoSessionKey}), and `sso-bounce` is then disabled.
 * Exactly ONE bounce, no loop. An interrupted bounce (user hit back
 * mid-redirect) self-heals once the {@link SSO_GUARD_TTL_MS} guard TTL lapses.
 *
 * All state lives in `sessionStorage` (per tab, cleared on tab close) and is
 * keyed per-origin so two RPs hosted in the same browser never collide. The
 * key strings and the 30s TTL are a wire/storage contract — they MUST match
 * the values the IdP and every consumer expect and must not change lightly.
 */

import { CENTRAL_AUTH_URL, resolveCentralAuthUrl } from './authWebUrl';

/**
 * The RP callback path the central IdP redirects back to after a bounce. The
 * SSO result is delivered in the fragment of this URL; the `sso-return` step
 * consumes it and then restores the user's real destination (stored under
 * {@link ssoDestKey}), so the user never lingers on this internal path.
 */
export const SSO_CALLBACK_PATH = '/__oxy/sso-callback';

/**
 * Self-healing TTL (ms) for the bounce guard. An in-flight bounce sets a
 * timestamp guard; if the bounce is interrupted before the callback lands
 * (e.g. the user navigates back mid-redirect), the guard would otherwise pin
 * the RP signed-out forever. After this window the guard is treated as stale
 * and a fresh single bounce is permitted. 30s comfortably exceeds a real
 * redirect round-trip while keeping a crash short-lived.
 */
export const SSO_GUARD_TTL_MS = 30_000;

const STATE_KEY_PREFIX = 'oxy_sso_state:';
const GUARD_KEY_PREFIX = 'oxy_sso_guard:';
const DEST_KEY_PREFIX = 'oxy_sso_dest:';
const NO_SESSION_KEY_PREFIX = 'oxy_sso_no_session:';

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
 * Perform the terminal top-level SSO bounce navigation.
 *
 * A thin wrapper over `window.location.assign(url)` so the single navigation
 * seam lives in one place (and stays mockable in tests, where jsdom's
 * `Location.assign` is a non-configurable native method). In production this is
 * exactly `window.location.assign` — the document is torn down and replaced by
 * the central IdP page. Off-browser (SSR / native) it is a no-op: native never
 * bounces.
 */
export function ssoNavigate(url: string): void {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return;
  }
  window.location.assign(url);
}

/**
 * Build the central IdP `/sso` bounce URL for an RP.
 *
 * Pure (no DOM access) so it is unit-testable and shared by every consumer's
 * terminal `sso-bounce` step. The IdP reads `client_id` (the RP origin) and
 * `return_to` to mint an origin-bound opaque code and 303-redirect back.
 *
 * The IdP base is resolved via {@link resolveCentralAuthUrl} so an explicit
 * `authWebUrl` override (e.g. a staging IdP) drives the SSO bounce exactly the
 * way it drives FedCM. When omitted, the central default {@link CENTRAL_AUTH_URL}
 * is used.
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
 * Whether `origin` IS the central IdP origin. The RP must NEVER bounce while
 * sitting on `auth.oxy.so` itself — doing so would loop the IdP against itself.
 *
 * Both sides are normalised via `new URL(...).origin` so a trailing-slash or
 * path difference never defeats the guard. Returns `false` on any parse
 * failure (an unparseable candidate is, by definition, not the central IdP).
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
 * Active means: a guard value is present AND it parses to a finite timestamp
 * AND less than {@link SSO_GUARD_TTL_MS} has elapsed since it was set. An active
 * guard disables `sso-bounce` (a bounce is already in flight this tab). A
 * missing, malformed, or expired guard is NOT active, so a fresh bounce may
 * proceed (this is the 30s self-heal for an interrupted bounce).
 *
 * Defensive: a `getItem` that throws (e.g. a locked/disabled storage) is
 * treated as "not active" so the guard never wedges the flow.
 *
 * @param storage - The session storage to read (injected for testability).
 * @param origin - The page origin whose guard to evaluate.
 * @param now - Current epoch ms (injected for deterministic tests). Defaults to
 *   `Date.now()`.
 */
export function guardActive(
  storage: Pick<Storage, 'getItem'>,
  origin: string,
  now: number = Date.now(),
): boolean {
  let raw: string | null;
  try {
    raw = storage.getItem(ssoGuardKey(origin));
  } catch {
    return false;
  }
  if (raw === null || raw.length === 0) {
    return false;
  }
  const ts = Number(raw);
  if (!Number.isFinite(ts)) {
    return false;
  }
  return now - ts < SSO_GUARD_TTL_MS;
}
