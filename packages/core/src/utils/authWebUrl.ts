/**
 * Central IdP apex constant.
 *
 * The client SSO/FedCM resolvers (`resolveCentralAuthUrl`, `CENTRAL_AUTH_URL`)
 * were removed in the device-first / legacy-final cutovers. The lone survivor is
 * `CENTRAL_IDP_APEX`, kept because it has a LIVE device-first consumer —
 * `@oxyhq/core/server`'s CORS helper auto-allows `*.oxy.so` from it — as well as
 * the (lista-B) IdP worker branding its assertions. The CORS use is permanent,
 * so this stays past the SSO/FedCM teardown.
 */

/**
 * The registrable apex (eTLD+1) of the Oxy ecosystem's central Identity
 * Provider. The central IdP is reachable at `auth.${CENTRAL_IDP_APEX}` and the
 * ID-token assertion issuer is always `https://auth.${CENTRAL_IDP_APEX}`.
 * A single source of truth so the IdP worker + the CORS helper never drift.
 */
export const CENTRAL_IDP_APEX = 'oxy.so';
