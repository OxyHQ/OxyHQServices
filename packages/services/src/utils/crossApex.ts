/**
 * Cross-apex web detection for sign-in durability gating.
 *
 * On a web Relying Party whose registrable apex differs from the central Oxy
 * Identity Provider apex (`oxy.so`), the ONLY sign-in completion that survives a
 * page reload is the interactive "Continue with Oxy" IdP flow, because it is the
 * only one that establishes a first-party `fedcm_session` cookie at
 * `auth.<apex>` — the anchor the cross-domain cold-boot restore reads on reload.
 *
 * The other sign-in completions the SDK can drive do NOT plant a `fedcm_session`:
 *   - password / public-key sign-in mints a bearer directly against the Oxy API
 *     (its refresh cookie is host-scoped to `api.oxy.so` and `SameSite=Lax`, so
 *     it is unreachable cross-site from the RP), and
 *   - the Commons-app device-flow handoff (cross-device QR / same-device
 *     deep-link) is approved OUTSIDE the browser, so no IdP browser session is
 *     established.
 * On a cross-apex RP each of these leaves the user signed in for the current
 * page only — a reload logs them out. See OxyHQServices AGENTS.md
 * "Auth / Session Contract".
 *
 * Same-apex `*.oxy.so` apps (e.g. `accounts.oxy.so`) are first-party with
 * `api.oxy.so`: their refresh cookie rides same-site requests so reload restore
 * works without `fedcm_session`, and they are therefore NOT gated.
 *
 * Returns `false` off-browser (React Native has no `window.location`) and for
 * hosts without a registrable apex (localhost / raw IP / single-label dev
 * hosts), so native and local development keep every sign-in method.
 */

import { registrableApex, CENTRAL_IDP_APEX } from '@oxyhq/core';

/**
 * Whether the given host is a web RP on a registrable apex other than the
 * central Oxy IdP apex (`oxy.so`). See the module doc for why this gates the
 * non-durable sign-in paths.
 *
 * @param hostname - The host to classify. Defaults to the current
 *   `window.location.hostname`; resolves to `undefined` off-browser (React
 *   Native / SSR), which yields `false`. The explicit parameter mirrors
 *   `autoDetectAuthWebUrl(location?)` and keeps the predicate unit-testable
 *   without manipulating the global `window.location`.
 */
export function isCrossApexWeb(
  hostname: string | undefined = typeof window !== 'undefined'
    ? window.location?.hostname
    : undefined,
): boolean {
  if (!hostname) {
    return false;
  }
  const apex = registrableApex(hostname);
  return apex !== null && apex !== CENTRAL_IDP_APEX;
}

/**
 * Thrown when an app attempts a direct (non-IdP) sign-in — password or
 * public-key — on a cross-apex web RP, where such a sign-in would not survive a
 * page reload because no `fedcm_session` is established (see {@link isCrossApexWeb}).
 *
 * Apps on a cross-apex apex must sign in through the interactive
 * "Continue with Oxy" IdP flow (`OxySignInButton` / `showSignInModal()`), which
 * plants the durable session.
 */
export class CrossApexDirectSignInError extends Error {
  override readonly name = 'CrossApexDirectSignInError';
  readonly code = 'CROSS_APEX_DIRECT_SIGN_IN_UNSUPPORTED';

  constructor() {
    super(
      'Direct sign-in is unavailable on this domain because the session would ' +
        'not survive a page reload. Use "Continue with Oxy" to sign in through ' +
        'the Oxy identity provider.',
    );
  }
}
