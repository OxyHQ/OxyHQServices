import { Redirect } from 'expo-router';

/**
 * Import Identity Flow Layout (Web)
 *
 * Importing an identity restores private key material onto the device — a
 * native-only operation. On web there is no secure key store to import into,
 * so the entire `import-identity` flow is forbidden: this layout redirects to
 * the sign-in screen before any child route can mount. Returning users sign in
 * via FedCM against the account they created on native.
 */
export default function ImportIdentityWebLayout() {
  return <Redirect href="/(auth)/sign-in" />;
}
