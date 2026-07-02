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
 * guard/state/dest + the outcome-independent attempted-flag
 * ({@link ssoAttemptedKey}) and navigates; the IdP (no central session) returns
 * `#oxy_sso=none`; the callback load's `sso-return` sees `none`, sets the
 * NO_SESSION flag ({@link ssoNoSessionKey}), and `sso-bounce` is then disabled.
 * Exactly ONE bounce, no loop. An interrupted bounce (user hit back
 * mid-redirect) self-heals once the {@link SSO_GUARD_TTL_MS} guard TTL lapses.
 * The attempted-flag is the definitive, outcome-INDEPENDENT loop breaker: it is
 * set pre-bounce so even if the return-side NO_SESSION write never lands, the
 * bounce can never re-fire this tab after the self-heal TTL lapses.
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
const ATTEMPTED_KEY_PREFIX = 'oxy_sso_attempted:';
const CALLBACK_BOOTSTRAP_KEY_PREFIX = 'oxy_sso_callback_bootstrap:';
const PRIOR_SESSION_KEY_PREFIX = 'oxy_sso_prior_session:';
const SIGNED_OUT_KEY_PREFIX = 'oxy_signed_out:';

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
 * Per-origin, OUTCOME-INDEPENDENT once-guard. Set in `sessionStorage` BEFORE
 * the terminal SSO bounce navigates. Gates the bounce so the silent
 * cross-domain probe fires AT MOST ONCE per tab session — independent of
 * whether the return-side NO_SESSION flag ever lands. The definitive loop
 * breaker; survives the 30s self-heal `ssoGuardKey` TTL. Cleared only on an
 * explicit sign-out/clear so a later cold boot (after the user signs in
 * centrally) can probe again.
 */
export function ssoAttemptedKey(origin: string): string {
  return `${ATTEMPTED_KEY_PREFIX}${origin}`;
}

/**
 * Per-origin DURABLE "this device/origin has had a signed-in Oxy session
 * before" hint.
 *
 * Unlike every other key in this module — which lives in per-tab
 * `sessionStorage` — this hint is written to DURABLE storage (web
 * `localStorage`; the services provider uses its own `storageKeyPrefix`-scoped
 * key in `@oxyhq/services`). It is set whenever a session is established or
 * restored and survives a session expiring; it is cleared ONLY on an explicit
 * full sign-out. It exists purely to drive {@link allowSsoBounce}: a returning
 * visitor (hint present) whose local session has lapsed still gets ONE terminal
 * `/sso` establish bounce to recover a session that lives only at the central
 * IdP, while a truly first-time anonymous visitor is never force-bounced.
 */
export function ssoPriorSessionKey(origin: string): string {
  return `${PRIOR_SESSION_KEY_PREFIX}${origin}`;
}

/**
 * Per-origin DURABLE "the user DELIBERATELY signed out on this device/origin"
 * flag.
 *
 * Like {@link ssoPriorSessionKey} this lives in DURABLE storage (web
 * `localStorage`; services uses its own `storageKeyPrefix`-scoped key), NOT the
 * per-tab `sessionStorage` the loop-breaker keys use — it must survive a reload.
 *
 * It exists purely to suppress AUTOMATIC silent restore after a deliberate
 * sign-out: a still-live IdP session (the central `fedcm_session`) would
 * otherwise let the per-apex `/auth/silent` iframe re-mint a session on the
 * very next cold boot, so a user who pressed "Sign out" gets silently signed
 * back in on reload. With this flag set, that silent cold-boot step is
 * skipped while the Gmail-style returning-account fast-path is otherwise
 * preserved.
 *
 * Lifecycle (mirrors the existing gate machinery — set on a definitive event,
 * cleared on its inverse):
 *   - SET on EXPLICIT full sign-out (alongside clearing the prior-session hint
 *     and the SSO bounce state).
 *   - CLEARED on ANY deliberate sign-in (password, account switch, device
 *     claim) so a real sign-in fully re-enables silent restore — there is no
 *     "stuck signed out" state.
 *
 * NOTE: this gates only AUTOMATIC/silent restore. An INTERACTIVE sign-in always
 * clears it first, so the user can always sign back in.
 */
export function ssoSignedOutKey(origin: string): string {
  return `${SIGNED_OUT_KEY_PREFIX}${origin}`;
}

/**
 * Per-origin marker written by the pre-hydration callback bootstrap.
 *
 * Static Expo exports render unknown paths as `+not-found`; on
 * `/__oxy/sso-callback` that can fail hydration before the React provider has a
 * chance to run `consumeSsoReturn`. The bootstrap runs in the HTML head, moves
 * the URL to a hydratable route while preserving the SSO fragment, and writes
 * this marker so `consumeSsoReturn` still restores the original destination as
 * if the page were physically on the callback path.
 */
export function ssoCallbackBootstrapKey(origin: string): string {
  return `${CALLBACK_BOOTSTRAP_KEY_PREFIX}${origin}`;
}

/**
 * Inline script for Expo/static web apps.
 *
 * Must run before the app bundle hydrates. It is intentionally tiny and
 * dependency-free: if the browser lands on the internal callback route with an
 * Oxy SSO fragment, it marks the handoff and rewrites the path to `/` while
 * preserving `#oxy_sso=...`. The normal SDK cold-boot `sso-return` step then
 * consumes the fragment from a route that can hydrate. If the internal route is
 * reached without a valid SSO fragment, it leaves the route via a hard root
 * navigation because there is no session material to preserve.
 */
export function getSsoCallbackBootstrapScript(): string {
  const callbackPath = JSON.stringify(SSO_CALLBACK_PATH);
  const bootstrapPrefix = JSON.stringify(CALLBACK_BOOTSTRAP_KEY_PREFIX);

  return `(function(){var p=${callbackPath};if(window.location.pathname!==p)return;var h=window.location.hash||"";if(!/(?:^#|&)oxy_sso=(?:ok|none|error)(?:&|$)/.test(h)){window.location.replace("/");return;}try{window.sessionStorage.setItem(${bootstrapPrefix}+window.location.origin,"1");}catch(e){window.__oxySsoCallbackBootstrapError=e instanceof Error?e.message:String(e);}try{window.history.replaceState(null,"","/"+h);}catch(e){window.__oxySsoCallbackBootstrapError=e instanceof Error?e.message:String(e);window.location.replace("/"+h);}})();`;
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

/**
 * Whether AUTOMATIC silent restore is SUPPRESSED for this origin because the
 * user deliberately signed out (the durable {@link ssoSignedOutKey} flag).
 *
 * When `true`, the silent cold-boot step that can re-mint a session from a
 * still-live IdP session WITHOUT user intent — the per-apex
 * `/auth/silent` iframe — MUST be skipped, so a user who pressed "Sign out" is
 * not silently signed back in on the next reload. Interactive sign-in clears the
 * flag, so this never blocks a deliberate re-sign-in.
 *
 * Defensive: a `getItem` that throws (locked/disabled storage) is treated as NOT
 * suppressed, so the gate fails toward the normal restore behaviour rather than
 * wedging the user out.
 *
 * @param storage - The DURABLE storage to read (web `localStorage`; injected for
 *   testability).
 * @param origin - The page origin whose signed-out flag to evaluate.
 */
export function silentRestoreSuppressed(
  storage: Pick<Storage, 'getItem'>,
  origin: string,
): boolean {
  try {
    return storage.getItem(ssoSignedOutKey(origin)) === '1';
  } catch {
    return false;
  }
}

/**
 * Inputs to the smart {@link allowSsoBounce} gate.
 */
export interface SsoBounceGate {
  /**
   * Whether this device/origin has had a signed-in Oxy session before (the
   * durable {@link ssoPriorSessionKey} hint). Set whenever a session is
   * established or restored; survives session expiry; cleared only on explicit
   * full sign-out. `true` ⇒ a returning visitor.
   */
  readonly hasPriorSession: boolean;
  /**
   * Whether a local/stored session was recovered earlier this cold boot. At the
   * terminal bounce gate this is effectively always `false` (an earlier step
   * would have won and short-circuited), but it is part of the contract — "no
   * prior hint AND no local session" — so it is passed explicitly for fidelity
   * and robustness.
   */
  readonly hasLocalSession: boolean;
}

/**
 * Decide whether the terminal `/sso` establish-bounce is ALLOWED for this
 * visitor (the smart `enabled` gate for the `sso-bounce` cold-boot step).
 *
 * The terminal bounce is the ONLY cold-boot step that can recover a session
 * that lives SOLELY at the central IdP — the cross-apex Relying-Party case
 * (e.g. `mention.earth`, a different apex from `oxy.so`) whose device-local
 * session has expired and whose `Domain=oxy.so` refresh cookie never reaches
 * `api.<apex>`. It is also what plants the first-party per-apex `fedcm_session`
 * cookie that the EARLIER `silent-iframe` step later relies on. So it must fire
 * for a RETURNING user, yet it must NOT force a truly first-time anonymous
 * visitor off to the IdP.
 *
 *   - ALLOW when there is a prior-signed-in hint OR a local session was
 *     recovered this boot (a returning user) — so a central-only cross-domain
 *     session recovers via ONE bounce, after which the per-apex cookie is
 *     planted and subsequent loads restore silently with no bounce.
 *   - else (no hint, no local session) SUPPRESS — a first-time anonymous
 *     visitor browses without a forced redirect.
 *
 * This is the smart DEFAULT and the ONLY behaviour: apps never configure it.
 * It is also the GATE DECISION ONLY — callers still apply the per-tab loop
 * guards (`ssoAttemptedKey`, `ssoNoSessionKey`, {@link guardActive}) so an
 * allowed bounce still fires at most once per cold boot.
 */
export function allowSsoBounce(gate: SsoBounceGate): boolean {
  return gate.hasPriorSession || gate.hasLocalSession;
}
