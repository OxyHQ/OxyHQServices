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
