/**
 * Hook that wraps key sign-in with a biometric gate.
 *
 * For INTERACTIVE callers (create / import, triggered by an explicit user
 * action): if biometric login is enabled, prompt for biometric authentication
 * before proceeding. The actual sign-in (post-gate) is the silent core from
 * {@link useSilentKeySignIn} — composed here, not duplicated.
 *
 * NON-interactive callers (the vault restoring its own session at boot) must NOT
 * use this — a headless biometric prompt during boot never resolves and hangs
 * forever. They call `useSilentKeySignIn` directly. See `useSyncIdentity`.
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@oxyhq/core';
import { authenticate, canUseBiometrics, getErrorMessage } from '@/lib/biometricAuth';
import { useSilentKeySignIn } from './useSilentKeySignIn';

export function useBiometricSignIn() {
  const { signInWithKeySilent } = useSilentKeySignIn();

  const signIn = useCallback(
    async (publicKey?: string, deviceName?: string): Promise<User> => {
      // Biometric gate (native only). Interactive sign-in must clear it first.
      if (Platform.OS !== 'web') {
        try {
          const biometricEnabled = await AsyncStorage.getItem('oxy_biometric_enabled');
          if (biometricEnabled === 'true') {
            // Check if biometrics can be used
            const canUse = await canUseBiometrics();
            if (canUse) {
              // Perform biometric authentication
              const authResult = await authenticate('Authenticate to sign in to your account');

              if (!authResult.success) {
                const errorMsg = getErrorMessage(authResult.error);
                throw new Error(errorMsg || 'Biometric authentication failed');
              }
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '';
          // If it's a user cancellation, throw to prevent sign-in
          if (message.includes('cancelled') || message.includes('cancel') || message.includes('user_cancel')) {
            throw new Error('Sign in cancelled');
          }
          // For other errors, re-throw
          throw err;
        }
      }

      // Gate cleared → the silent key sign-in core.
      return signInWithKeySilent(publicKey, deviceName);
    },
    [signInWithKeySilent],
  );

  return { signIn };
}
