/**
 * Parse the SSO return fragment delivered by the central IdP.
 *
 * After a top-level redirect bounce to `auth.oxy.so/sso` (prompt=none), the
 * central IdP returns the Relying Party to its `redirect_uri` with the result
 * encoded in the URL fragment (the `#…` part). The fragment is used — not a
 * query string — so the opaque single-use code never reaches a server access
 * log, a `Referer` header, or browser history in a recoverable form.
 *
 * Three outcomes are possible:
 *   - `#oxy_sso=ok&code=<opaque>&state=<state>` — the IdP had a session; the RP
 *     exchanges `code` (via `oxy.exchangeSsoCode`) for the real session. NO
 *     token/JWT ever appears in the URL — only the opaque code.
 *   - `#oxy_sso=none&state=<state>` — the IdP had no session (prompt=none, user
 *     not signed in centrally). The RP shows its own signed-out UI.
 *   - `#oxy_sso=error&state=<state>` — the bounce failed. The RP recovers.
 *
 * This parser is pure and defensive: it never throws, and `kind` is strictly
 * one of `'ok' | 'none' | 'error'`. It returns `null` when the fragment is not
 * an oxy_sso fragment at all (i.e. `oxy_sso` is absent or an unrecognised
 * value), so the caller can ignore unrelated fragments without special-casing.
 */

import type { SessionLoginResponse } from '../models/session';
import {
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoAttemptedKey,
} from './ssoBounce';

/**
 * The recognised outcomes of an SSO bounce.
 */
export type SsoReturnKind = 'ok' | 'none' | 'error';

/**
 * The parsed result of an SSO return fragment.
 *
 * `code` is present only for `kind: 'ok'`. `state` echoes the CSRF state the RP
 * generated for the bounce (when the IdP round-tripped it).
 */
export interface SsoReturnResult {
  kind: SsoReturnKind;
  code?: string;
  state?: string;
}

const VALID_KINDS: ReadonlySet<string> = new Set<SsoReturnKind>(['ok', 'none', 'error']);

/**
 * Parse an SSO return fragment.
 *
 * @param hash - The URL fragment, with or without the leading `#`
 *   (e.g. `location.hash`). May be `undefined`/empty.
 * @returns The parsed result when `hash` is a recognised oxy_sso fragment,
 *   otherwise `null`. Never throws.
 */
export function parseSsoReturnFragment(hash: string | undefined | null): SsoReturnResult | null {
  if (typeof hash !== 'string' || hash.length === 0) {
    return null;
  }

  // Strip a single leading '#'. A bare '#' (empty fragment) yields no params.
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) {
    return null;
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    // URLSearchParams does not throw for malformed input in practice, but guard
    // against any environment/polyfill that might so this stays total.
    return null;
  }

  const kind = params.get('oxy_sso');
  if (kind === null || !VALID_KINDS.has(kind)) {
    // Not an oxy_sso fragment (absent or unrecognised value) — ignore it.
    return null;
  }

  const result: SsoReturnResult = { kind: kind as SsoReturnKind };

  const state = params.get('state');
  if (state !== null && state.length > 0) {
    result.state = state;
  }

  // The opaque code is only meaningful on success; ignore any stray `code` on
  // none/error so callers never attempt an exchange for a non-ok outcome.
  if (result.kind === 'ok') {
    const code = params.get('code');
    if (code !== null && code.length > 0) {
      result.code = code;
    }
  }

  return result;
}

/**
 * Injectable dependencies for {@link consumeSsoReturn}.
 *
 * Every web seam (storage, location, history, web-detection) is injectable so
 * the function is fully unit-testable with fakes and so SSR / native callers
 * can supply their own (or rely on the defaults, which resolve to `window.*`
 * only when a browser is present). Defaults are evaluated lazily inside
 * `consumeSsoReturn` so importing this module never touches `window`.
 */
export interface ConsumeSsoReturnDeps {
  /** Per-tab SSO state store. Default: `window.sessionStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** The current location. Default: `window.location`. */
  location?: Pick<Location, 'hash' | 'origin' | 'pathname' | 'search'>;
  /** History API for fragment stripping / dest restore. Default: `window.history`. */
  history?: Pick<History, 'replaceState'>;
  /**
   * Whether the current environment is a web browser with usable
   * `sessionStorage`. Default: `typeof window !== 'undefined' && typeof
   * window.sessionStorage !== 'undefined'`.
   */
  isWeb?: () => boolean;
  /**
   * Optional debug hook invoked with the thrown error when the code exchange
   * fails. NEVER rethrown — `consumeSsoReturn` is total. Default: no-op.
   */
  onExchangeError?: (error: unknown) => void;
}

/**
 * Consume an SSO return: the commit-free, security-critical kernel of the
 * cross-domain SSO `sso-return` cold-boot step.
 *
 * This performs the CSRF/fragment/exchange/dest-restore/loop-breaker sequence
 * and RETURNS the exchanged session (or `null`). It deliberately does NOT
 * commit any UI/auth state — each provider commits its own way AROUND this
 * (e.g. `@oxyhq/services` `OxyContext` calls its `handleWebSSOSession`,
 * `@oxyhq/auth` `WebOxyProvider` updates its React state). Hoisting the kernel
 * here keeps the two providers byte-for-byte identical on the parts that matter
 * for security (state validation, fragment stripping order, loop prevention).
 *
 * Security/loop invariants (preserved exactly from both former copies):
 *   - The fragment is stripped via `history.replaceState` FIRST — before the
 *     exchange — so the opaque code never lingers in the URL, browser history,
 *     or a `Referer` header even if a later step throws.
 *   - `state` must match (CSRF). A mismatch or a missing code sets the
 *     NO_SESSION flag so `sso-bounce` is disabled (no rebounce loop).
 *   - `none`/`error` outcomes set BOTH the NO_SESSION flag and the
 *     outcome-independent attempted-flag (the load2 half of the loop proof).
 *   - A throwing exchange is caught, reported via `onExchangeError`, and
 *     treated exactly like "no session" (never loops, never rethrows).
 *   - After a successful exchange landing on {@link SSO_CALLBACK_PATH}, the real
 *     destination is restored from the DEST key — same-origin only (an
 *     attacker-planted cross-origin or relative-evil dest is rejected). The
 *     DEST key is removed unconditionally.
 *
 * Total: this function NEVER throws. Off-web it is a no-op returning `null`.
 *
 * @param oxy - The exchange surface (`oxyServices.exchangeSsoCode`).
 * @param deps - Injectable web seams; see {@link ConsumeSsoReturnDeps}.
 * @returns The exchanged session on success, otherwise `null`.
 */
export async function consumeSsoReturn(
  oxy: { exchangeSsoCode: (code: string) => Promise<SessionLoginResponse> },
  deps: ConsumeSsoReturnDeps = {},
): Promise<SessionLoginResponse | null> {
  const isWeb =
    deps.isWeb ??
    (() =>
      typeof window !== 'undefined' &&
      typeof window.sessionStorage !== 'undefined');

  if (!isWeb()) {
    return null;
  }

  const storage = deps.storage ?? window.sessionStorage;
  const location = deps.location ?? window.location;
  const history = deps.history ?? window.history;
  const onExchangeError = deps.onExchangeError;

  const ret = parseSsoReturnFragment(location.hash);
  if (!ret) {
    // Not an oxy_sso fragment — nothing to do (do NOT touch any flags).
    return null;
  }

  const origin = location.origin;
  const expectedState = storage.getItem(ssoStateKey(origin));
  const stateOk = !!ret.state && !!expectedState && ret.state === expectedState;

  // Strip the fragment FIRST so the opaque code never lingers in the address
  // bar, history, or a `Referer` — even if a later step throws.
  history.replaceState(null, '', location.pathname + location.search);
  storage.removeItem(ssoStateKey(origin));

  // The in-flight bounce is now resolved — drop its guard so a later cold boot
  // (e.g. after sign-out) can bounce again.
  storage.removeItem(ssoGuardKey(origin));

  const markNoSession = () => {
    storage.setItem(ssoNoSessionKey(origin), '1');
    // A return was consumed, so the probe definitively happened. Set the
    // outcome-independent attempted-flag too so the bounce can never re-fire
    // even if some consumer path skipped setting it pre-bounce.
    storage.setItem(ssoAttemptedKey(origin), '1');
  };

  if (ret.kind === 'none' || ret.kind === 'error') {
    // The central IdP had no session (or the bounce failed). Record it so we do
    // not bounce again this tab — the definitive loop breaker.
    markNoSession();
    return null;
  }

  if (!stateOk || !ret.code) {
    // Forged / replayed / stale fragment, or a malformed ok with no code. Treat
    // exactly like "no session": never exchange, never loop.
    markNoSession();
    return null;
  }

  let session: SessionLoginResponse | undefined;
  try {
    session = await oxy.exchangeSsoCode(ret.code);
  } catch (error) {
    onExchangeError?.(error);
    markNoSession();
    return null;
  }

  if (!session?.sessionId) {
    markNoSession();
    return null;
  }

  // If we landed on the internal callback path, restore the user's real
  // destination (captured at bounce time). Same-origin only — never honour a
  // cross-origin destination that could have been planted to redirect the
  // freshly signed-in user. `new URL(dest, origin)` tolerates relative dests
  // and is still re-checked against the page origin.
  if (location.pathname === SSO_CALLBACK_PATH) {
    const dest = storage.getItem(ssoDestKey(origin));
    if (dest) {
      try {
        const destUrl = new URL(dest, origin);
        if (destUrl.origin === origin) {
          history.replaceState(
            null,
            '',
            destUrl.pathname + destUrl.search + destUrl.hash,
          );
        }
      } catch {
        // Malformed stored destination — leave the URL on the callback path.
      }
    }
  }
  storage.removeItem(ssoDestKey(origin));

  return session;
}
