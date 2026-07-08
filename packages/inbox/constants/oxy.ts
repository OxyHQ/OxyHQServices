/**
 * Oxy platform integration constants for the inbox app.
 */

/**
 * Public OAuth client id for this app (the registered `ApplicationCredential`
 * publicKey). Drives the #214 app-identity flow when passed to `OxyProvider`.
 * Public value — safe to commit. Overridable per environment via
 * `EXPO_PUBLIC_OXY_CLIENT_ID`.
 */
export const OXY_CLIENT_ID =
  process.env.EXPO_PUBLIC_OXY_CLIENT_ID ??
  'oxy_dk_19cf17069d097a6ebf17a622709a53d13692ee69487224e3';

/** Registered OAuth redirect surface for this web origin (exact match). */
export const OXY_AUTH_REDIRECT_URI =
  process.env.EXPO_PUBLIC_OXY_AUTH_REDIRECT_URI ?? 'https://inbox.oxy.so';
