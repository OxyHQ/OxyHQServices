import { Redirect } from 'expo-router';

/**
 * Create Identity Flow Layout (Web)
 *
 * Identity CREATION is native-only — generating cryptographic keys and the
 * recovery phrase happens on the user's device, never in a browser. On web,
 * the entire `create-identity` flow is forbidden: this layout redirects to the
 * sign-in screen before any child route (key generation, recovery-phrase
 * reveal, username step) can mount. No key material is ever created on web.
 */
export default function CreateIdentityWebLayout() {
  return <Redirect href="/(auth)/sign-in" />;
}
