/**
 * Central IdP (auth web) URL resolution for cross-domain SSO.
 *
 * The Oxy ecosystem runs a single, central Identity Provider at
 * `auth.oxy.so`. For TRUE central cross-domain SSO (Google/Meta/Clerk style),
 * FedCM and the opaque-code SSO bounce always target this one origin — it owns
 * the host-only `fedcm_session` cookie and the central session store reachable
 * via `api.oxy.so`. Relying Parties (mention.earth, homiio.com, alia.onl, …)
 * delegate to it rather than standing up a per-apex IdP.
 *
 * This module is intentionally pure: it performs no DOM access, reads no
 * `window`/`location`, and has no side effects. It is the single source of
 * truth for the central IdP origin so call sites never hardcode the literal.
 *
 * LEGACY(old-sdk): the client resolver (`resolveCentralAuthUrl`) was removed in
 * the device-first cutover; `CENTRAL_IDP_APEX` / `CENTRAL_AUTH_URL` survive ONLY
 * because the lista-B IdP worker imports them to brand assertions. Deletable
 * once Homiio/Allo/Alia/Syra are bumped off the old SDK AND CloudWatch
 * `/oxy/ecs` shows the `/sso*` + `/fedcm/*` routes quiet — F-final sweep.
 */

/**
 * The registrable apex (eTLD+1) of the Oxy ecosystem's central Identity
 * Provider. The central IdP is reachable at `auth.${CENTRAL_IDP_APEX}` and the
 * ID-token assertion issuer is always `https://auth.${CENTRAL_IDP_APEX}`
 * regardless of which per-apex `auth.<rp>` host served a given request.
 *
 * Kept as a standalone constant so the IdP worker and the SDK derive the same
 * literal from one source of truth (the worker imports it to brand assertions).
 */
export const CENTRAL_IDP_APEX = 'oxy.so';

/**
 * The canonical central Identity Provider origin for the Oxy ecosystem.
 * No trailing slash. Derived from {@link CENTRAL_IDP_APEX} so the apex and the
 * full origin never drift apart. The IdP worker imports it to brand assertions.
 */
export const CENTRAL_AUTH_URL = `https://auth.${CENTRAL_IDP_APEX}`;
