/**
 * Authentication (sign-in) constants.
 *
 * Accounts is a management-only app — identity CREATION (key generation,
 * recovery phrase, username onboarding) lives in the Commons app, so the
 * create/import-identity constants that used to live here are gone.
 */

/**
 * Where the sign-in screen points users who don't yet have an account.
 * Identity creation is native-only and lives in the Commons app, so this links
 * to the place that explains how to get the app and create an Oxy identity.
 * Overridable per deployment.
 */
export const CREATE_ACCOUNT_HELP_URL =
  process.env.EXPO_PUBLIC_CREATE_ACCOUNT_URL ?? 'https://oxy.so/download';
