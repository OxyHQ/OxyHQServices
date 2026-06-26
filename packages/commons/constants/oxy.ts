/**
 * Oxy platform integration constants for the Commons app.
 */

/**
 * Public OAuth client id for Commons (the registered `ApplicationCredential`
 * publicKey). Passed to `OxyProvider` so the device sign-in / `/auth/session/*`
 * flows resolve the correct registered Application identity.
 *
 * Public value — safe to commit. Overridable per environment via
 * `EXPO_PUBLIC_OXY_CLIENT_ID`.
 *
 * PREREQUISITE (plan A0): the placeholder below is NOT yet a real Commons
 * credential. Before first production boot/deploy, register a dedicated
 * `oxy_dk_…` `ApplicationCredential` (type `public`, `active`) for Commons in
 * the Oxy workspace and replace this value (or set `EXPO_PUBLIC_OXY_CLIENT_ID`
 * in the Commons Cloudflare Pages / EAS environment). Without a real active
 * credential, cross-app device sign-in and SSO will not function.
 */
export const OXY_CLIENT_ID =
  process.env.EXPO_PUBLIC_OXY_CLIENT_ID ??
  'oxy_dk_commons_placeholder_register_before_production';
