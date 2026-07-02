/**
 * Post-claim durable-session establish hop (web device-flow / "Sign in with
 * Oxy" QR).
 *
 * A WEB device-flow claim (`claimSessionByToken`) plants only IN-MEMORY tokens:
 * unlike a redirect/FedCM/silent sign-in, it never causes the IdP to plant a
 * `fedcm_session` cookie. So a reload has nothing to restore from — the
 * silent-iframe and `/sso` paths find no IdP session and the session is lost.
 *
 * This primitive closes that gap. AFTER the claim has committed and the session
 * has been durably persisted, it performs ONE top-level establish hop through
 * the RP's own per-apex IdP host (`auth.<rp-apex>`), reusing the EXISTING
 * `/sso/establish` endpoint: the server mints a short-lived, host+audience-bound
 * establish-token and returns a fully-formed establish URL; navigating to it
 * plants the durable first-party `fedcm_session` cookie and bounces back to the
 * RP callback with an opaque code the standard `sso-return` cold-boot step
 * exchanges.
 *
 * It reuses the SAME per-origin `sessionStorage` bounce contract
 * (`ssoStateKey` / `ssoGuardKey` / `ssoDestKey`) that {@link buildSsoBounceUrl}
 * primes for the terminal `/sso` bounce, so the post-bounce `sso-return` step
 * (`consumeSsoReturn`) validates the CSRF `state`, exchanges the code, and
 * restores the user's real destination with no extra wiring.
 *
 * Contract:
 *  - WEB only — off-web / native it is a no-op returning `false`.
 *  - NEVER fires while sitting on the central IdP origin (that would loop the
 *    IdP against itself).
 *  - Bounce state is persisted ONLY after the establish-URL request succeeds, so
 *    a failed request leaves no stale state behind.
 *  - SINGLE attempt: the caller invokes this exactly once per successful claim.
 *    On ANY failure it does NOT navigate and returns `false`, leaving the
 *    committed in-memory session exactly as-is (the user is no worse off than
 *    before this hop existed).
 *  - Total: never throws. Failures are reported via {@link deps.onError} only.
 */

import {
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNavigate,
  isCentralIdPOrigin,
} from './ssoBounce';
import { generateSsoState } from '../mixins/OxyServices.sso';

/**
 * The minimal SDK surface this hop needs: mint a server-formed establish URL
 * bound to the caller's own session for an approved RP origin. Structural so the
 * primitive is unit-testable with a stub and never imports the full client.
 */
export interface SsoEstablishClient {
  requestSsoEstablishUrl(
    origin: string,
    state: string,
  ): Promise<{ establishUrl: string }>;
}

/**
 * Injectable web seams for {@link establishIdpSessionAfterClaim}. Every seam is
 * overridable so the primitive is fully unit-testable with fakes and so native
 * callers rely on the defaults (which resolve to `window.*` only when a browser
 * is present). Defaults are evaluated lazily inside the function so importing
 * this module never touches `window`.
 */
export interface EstablishAfterClaimDeps {
  /** Per-tab SSO bounce store. Default: `window.sessionStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** The current location. Default: `window.location`. */
  location?: Pick<Location, 'origin' | 'href'>;
  /** Top-level navigation seam. Default: {@link ssoNavigate} (`location.assign`). */
  navigate?: (url: string) => void;
  /**
   * Whether the current environment is a web browser with usable
   * `sessionStorage`. Default: `typeof window !== 'undefined' && typeof
   * window.sessionStorage !== 'undefined'`.
   */
  isWeb?: () => boolean;
  /** CSRF state generator. Default: {@link generateSsoState}. */
  generateState?: () => string;
  /** Epoch-ms clock for the bounce guard. Default: `Date.now`. */
  now?: () => number;
  /**
   * Optional debug hook invoked with the thrown error when the establish
   * request (or state persistence) fails. NEVER rethrown. Default: no-op.
   */
  onError?: (error: unknown) => void;
}

/**
 * Perform the post-claim establish hop. Returns `true` when a navigation to the
 * establish URL was initiated (the document is being torn down and replaced by
 * the IdP), `false` on every no-op / failure path.
 *
 * @param client - The exchange surface (`oxyServices.requestSsoEstablishUrl`).
 * @param deps - Injectable web seams; see {@link EstablishAfterClaimDeps}.
 */
export async function establishIdpSessionAfterClaim(
  client: SsoEstablishClient,
  deps: EstablishAfterClaimDeps = {},
): Promise<boolean> {
  const isWeb =
    deps.isWeb ??
    (() =>
      typeof window !== 'undefined' &&
      typeof window.sessionStorage !== 'undefined');

  if (!isWeb()) {
    return false;
  }

  const storage = deps.storage ?? window.sessionStorage;
  const location = deps.location ?? window.location;
  const navigate = deps.navigate ?? ssoNavigate;
  const generateState = deps.generateState ?? generateSsoState;
  const now = deps.now ?? (() => Date.now());

  const origin = location.origin;

  // Never establish while sitting on the central IdP itself — that would bounce
  // the IdP against itself. (The device-flow claim can only happen on an RP.)
  if (isCentralIdPOrigin(origin)) {
    return false;
  }

  const state = generateState();

  let establishUrl: string;
  try {
    const result = await client.requestSsoEstablishUrl(origin, state);
    if (
      !result ||
      typeof result.establishUrl !== 'string' ||
      result.establishUrl.length === 0
    ) {
      return false;
    }
    establishUrl = result.establishUrl;

    // Persist the bounce state ONLY now that the request has succeeded and we
    // WILL navigate — so a failed request never leaves stale state behind. This
    // is the exact contract the terminal `/sso` bounce primes via
    // `buildSsoBounceUrl`, so the post-bounce `sso-return` step (`consumeSsoReturn`)
    // validates `state`, exchanges the returned code, and restores the dest.
    storage.setItem(ssoStateKey(origin), state);
    storage.setItem(ssoGuardKey(origin), String(now()));
    storage.setItem(ssoDestKey(origin), location.href);
  } catch (error) {
    deps.onError?.(error);
    return false;
  }

  navigate(establishUrl);
  return true;
}
