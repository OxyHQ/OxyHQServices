/**
 * Hook that wraps signIn with biometric authentication check
 * 
 * If biometric login is enabled, this will prompt for biometric authentication
 * before proceeding with the sign-in flow.
 */

import { useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOxy, KeyManager } from '@oxyhq/services';
import { authenticate, canUseBiometrics, getErrorMessage } from '@/lib/biometricAuth';

export function useBiometricSignIn() {
  const { signIn: originalSignIn } = useOxy();

  const signIn = useCallback(async (publicKey?: string, deviceName?: string) => {
    // Check if biometric authentication is enabled
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
      } catch (err: any) {
        // If it's a user cancellation, throw to prevent sign-in
        if (err?.message?.includes('cancelled') || err?.message?.includes('cancel') || err?.message?.includes('user_cancel')) {
          throw new Error('Sign in cancelled');
        }
        // For other errors, re-throw
        throw err;
      }
    }

    // Proceed with normal sign-in
    // If no publicKey provided, get it from KeyManager
    const keyToUse = publicKey || await KeyManager.getPublicKey();
    if (!keyToUse) {
      throw new Error('No identity found on this device');
    }
    
    if (deviceName) {
      return await originalSignIn(keyToUse, deviceName);
    }
    return await originalSignIn(keyToUse);
  }, [originalSignIn]);

  return { signIn };
}


