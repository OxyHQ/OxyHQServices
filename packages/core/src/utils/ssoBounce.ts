/**
 * SSO callback path constant.
 *
 * The client SSO-bounce machinery (per-origin sessionStorage keys, the bounce
 * URL builder, the `guardActive` / `allowSsoBounce` / `getSsoCallbackBootstrapScript`
 * predicates, …) was removed in the device-first cutover — RP apps no longer
 * bounce through `auth.oxy.so`. The one survivor is this path constant, still
 * referenced by the api SSO controller and the IdP (both lista B, gated on the
 * ecosystem bump). `@oxyhq/core/server` re-exports it for the api.
 *
 * LEGACY(old-sdk): `SSO_CALLBACK_PATH` survives ONLY for the lista-B api/IdP SSO
 * surface. Deletable once Homiio/Allo/Alia/Syra are bumped off the old SDK AND
 * CloudWatch `/oxy/ecs` shows the `/sso*` + `/fedcm/*` routes quiet — the
 * F-final sweep should remove this file then.
 */

/**
 * The RP callback path the central IdP redirects back to after a legacy SSO
 * bounce. Kept as the single source of truth so the api/IdP never hardcode the
 * literal.
 */
export const SSO_CALLBACK_PATH = '/__oxy/sso-callback';
