/**
 * Silent (non-interactive) identity-key sign-in.
 *
 * The pure core of key sign-in with NO biometric ceremony: resolve the device's
 * public key, then delegate to the SDK's challenge → sign → verify sign-in
 * (`useOxy().signIn`). This is the exact body of {@link useBiometricSignIn} AFTER
 * its biometric gate — extracted so a non-interactive caller (the vault restoring
 * its OWN session at boot: `useSyncIdentity` → `useSessionAutoConnect`) can reuse
 * it WITHOUT triggering `LocalAuthentication`.
 *
 * Why this matters: a headless `authenticate()` prompt fired during boot (when
 * `oxy_biometric_enabled === 'true'`) never resolves, hanging the auto-connect
 * "connecting" state forever. This mirrors the SDK cold boot, which already
 * key-signs-in silently via the shared slot in every Oxy app — biometrics in
 * Commons gate INTERACTIVE ops (approving another app's sign-in, revealing the
 * recovery phrase), not the vault restoring its own session. `useBiometricSignIn`
 * composes the gate + this silent core for the interactive callers (create /
 * import), so its behaviour is unchanged.
 */

import { useCallback } from 'react';
import { useOxy } from '@oxyhq/services';
import { KeyManager } from '@oxyhq/core';
import type { User } from '@oxyhq/core';

export interface UseSilentKeySignInResult {
  /**
   * Sign in with the device's identity key WITHOUT any biometric prompt. Resolves
   * the public key (the argument, or `KeyManager.getPublicKey()`) and delegates to
   * the SDK's key sign-in. Every await is HttpService-bounded — it cannot hang.
   */
  signInWithKeySilent: (publicKey?: string, deviceName?: string) => Promise<User>;
}

export function useSilentKeySignIn(): UseSilentKeySignInResult {
  const { signIn: sdkSignIn } = useOxy();

  const signInWithKeySilent = useCallback(
    async (publicKey?: string, deviceName?: string): Promise<User> => {
      const keyToUse = publicKey || (await KeyManager.getPublicKey());
      if (!keyToUse) {
        throw new Error('No identity found on this device');
      }
      if (deviceName) {
        return await sdkSignIn(keyToUse, deviceName);
      }
      return await sdkSignIn(keyToUse);
    },
    [sdkSignIn],
  );

  return { signInWithKeySilent };
}
