/**
 * Hook for managing biometric authentication settings
 * 
 * Provides functionality to:
 * - Load biometric login preference from user settings
 * - Save biometric login preference
 * - Check if biometrics can be enabled (hardware + enrolled)
 * - Toggle biometric login on/off
 */

import { useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOxy } from '@oxyhq/services';
import {
  canUseBiometrics,
  hasBiometricHardware,
  isBiometricEnrolled,
  getSupportedTypes,
  authenticate,
  getAuthenticationTypeName,
  getErrorMessage,
} from '@/lib/biometricAuth';

export interface BiometricSettingsState {
  enabled: boolean;
  canEnable: boolean;
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: string[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

export function useBiometricSettings() {
  const { oxyServices, user } = useOxy();
  const [enabled, setEnabled] = useState(false);
  const [canEnable, setCanEnable] = useState(false);
  const [hasHardware, setHasHardware] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [supportedTypes, setSupportedTypes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load biometric settings and check device capabilities
  useEffect(() => {
    const loadSettings = async () => {
      if (!user?.id || !oxyServices) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Check device capabilities
        const hardwareAvailable = await hasBiometricHardware();
        const enrolled = await isBiometricEnrolled();
        const canUse = await canUseBiometrics();
        const types = await getSupportedTypes();

        setHasHardware(hardwareAvailable);
        setIsEnrolled(enrolled);
        setCanEnable(canUse);
        setSupportedTypes(types.map(getAuthenticationTypeName));

        // Load user preference
        if (Platform.OS !== 'web') {
          try {
            // Try to load from privacy settings first
            const privacySettings = await oxyServices.getPrivacySettings(user.id);
            const biometricEnabled = privacySettings?.biometricLogin ?? false;
            setEnabled(biometricEnabled);
            
            // Sync with local storage
            if (biometricEnabled) {
              await AsyncStorage.setItem('oxy_biometric_enabled', 'true');
            } else {
              await AsyncStorage.removeItem('oxy_biometric_enabled');
            }
          } catch (err) {
            console.error('[useBiometricSettings] Failed to load privacy settings:', err);
            // Fallback to local storage
            try {
              const localPref = await AsyncStorage.getItem('oxy_biometric_enabled');
              setEnabled(localPref === 'true');
            } catch {
              // Use default
              setEnabled(false);
            }
          }
        } else {
          // Web doesn't support biometrics
          setEnabled(false);
        }
      } catch (err) {
        console.error('[useBiometricSettings] Error loading settings:', err);
        setError(err instanceof Error ? err.message : 'Failed to load biometric settings');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [user?.id, oxyServices]);

  /**
   * Toggle biometric login on/off
   * When enabling, requires biometric authentication to confirm
   */
  const toggleBiometricLogin = useCallback(async (value: boolean) => {
    if (!user?.id || !oxyServices) {
      Alert.alert('Error', 'User not available');
      return;
    }

    // If disabling, just update the setting
    if (!value) {
      try {
        setIsSaving(true);
        setError(null);
        await oxyServices.updatePrivacySettings({ biometricLogin: false }, user.id);
        
        // Remove local preference
        await AsyncStorage.removeItem('oxy_biometric_enabled');
        
        setEnabled(false);
      } catch (err) {
        console.error('[useBiometricSettings] Failed to disable biometric login:', err);
        setError(err instanceof Error ? err.message : 'Failed to disable biometric login');
        Alert.alert('Error', 'Failed to disable biometric login');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // If enabling, check if biometrics can be used
    if (!canEnable) {
      if (!hasHardware) {
        Alert.alert(
          'Not Available',
          'Biometric authentication is not available on this device.'
        );
        return;
      }
      if (!isEnrolled) {
        Alert.alert(
          'Not Set Up',
          'Please set up Face ID, Touch ID, or fingerprint in your device settings first.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => {
              // On native, this would typically open device settings
              // For now, just show a message
              Alert.alert('Settings', 'Go to your device settings to set up biometric authentication.');
            }},
          ]
        );
        return;
      }
    }

    // Authenticate with biometrics before enabling
    try {
      setIsSaving(true);
      setError(null);

      const authResult = await authenticate(
        'Enable biometric login to protect your identity'
      );

      if (!authResult.success) {
        const errorMsg = getErrorMessage(authResult.error);
        setError(errorMsg);
        Alert.alert('Authentication Failed', errorMsg);
        return;
      }

      // Save the setting
      await oxyServices.updatePrivacySettings({ biometricLogin: true }, user.id);
      
      // Also store locally for quick access during sign-in
      await AsyncStorage.setItem('oxy_biometric_enabled', 'true');
      
      setEnabled(true);
    } catch (err) {
      console.error('[useBiometricSettings] Failed to enable biometric login:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to enable biometric login';
      setError(errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setIsSaving(false);
    }
  }, [user?.id, oxyServices, canEnable, hasHardware, isEnrolled]);

  /**
   * Refresh device capabilities (useful after user sets up biometrics)
   */
  const refreshCapabilities = useCallback(async () => {
    try {
      const hardwareAvailable = await hasBiometricHardware();
      const enrolled = await isBiometricEnrolled();
      const canUse = await canUseBiometrics();
      const types = await getSupportedTypes();

      setHasHardware(hardwareAvailable);
      setIsEnrolled(enrolled);
      setCanEnable(canUse);
      setSupportedTypes(types.map(getAuthenticationTypeName));
    } catch (err) {
      console.error('[useBiometricSettings] Error refreshing capabilities:', err);
    }
  }, []);

  return {
    enabled,
    canEnable,
    hasHardware,
    isEnrolled,
    supportedTypes,
    isLoading,
    isSaving,
    error,
    toggleBiometricLogin,
    refreshCapabilities,
  };
}

