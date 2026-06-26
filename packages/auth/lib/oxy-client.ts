/**
 * The auth app's OWN registered OAuth client id.
 *
 * For the "Sign in with Oxy" (QR) handoff the IdP is itself a relying party:
 * it asks the user's Oxy app (Commons) to approve a sign-in on a fresh
 * device-flow session. That session must be created with a REAL registered
 * `ApplicationCredential` publicKey so the API can resolve the requesting app's
 * identity on the approval screen — distinct from the per-request `?client_id=`
 * of whatever RP the IdP happens to be authorizing.
 *
 * Public value — safe to commit. Overridable per environment via
 * `VITE_OXY_CLIENT_ID`.
 *
 * PREREQUISITE (plan A0): the placeholder below is NOT yet a real credential.
 * Before production, register a dedicated `oxy_dk_…` `ApplicationCredential`
 * (type `public`, `active`) for the auth app in the Oxy workspace and replace
 * this value (or set `VITE_OXY_CLIENT_ID` in the auth Cloudflare Pages
 * environment). Without a real active credential the QR sign-in option is shown
 * but the session create call will be rejected.
 */
export const OXY_CLIENT_ID =
  import.meta.env.VITE_OXY_CLIENT_ID ||
  "oxy_dk_auth_placeholder_register_before_production"
