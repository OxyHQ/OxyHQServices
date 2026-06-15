/**
 * Oxy platform integration constants for the accounts app.
 */

/**
 * Public OAuth client id for this app (the registered `ApplicationCredential`
 * publicKey). Drives the #214 app-identity flow when passed to `OxyProvider`.
 * Public value — safe to commit. Overridable per environment via
 * `EXPO_PUBLIC_OXY_CLIENT_ID`.
 */
export const OXY_CLIENT_ID =
  process.env.EXPO_PUBLIC_OXY_CLIENT_ID ??
  'oxy_dk_00f0e5d5a2e4697740a476d3cfc54f4490f01245d0d2dd05';
