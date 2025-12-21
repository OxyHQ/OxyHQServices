import React, { useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NotificationsStep } from '@/components/auth/NotificationsStep';
import { useAuthHandlers } from '@/hooks/auth/useAuthHandlers';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';
import { useAlert } from '@/components/ui';

// Constants for identity verification
const IDENTITY_VERIFICATION_DELAY_MS = 500;
const IDENTITY_VERIFICATION_RETRY_DELAY_MS = 300;
const IDENTITY_VERIFICATION_MAX_RETRIES = 3;

/**
 * Import Identity - Notifications Screen
 * 
 * Requests push notification permissions and completes sign-in
 */
export default function ImportIdentityNotificationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const alert = useAlert();
  const { signIn, oxyServices, isAuthenticated, hasIdentity } = useOxy();
  const { error, isSigningIn, setAuthError, setSigningIn, usernameRef } = useAuthFlowContext();

  // Verify identity exists on mount - if not, redirect back to import
  // Use a ref to track if we've already checked to prevent multiple checks
  const hasCheckedRef = useRef(false);
  useEffect(() => {
    if (hasCheckedRef.current) return; // Only check once

    let mounted = true;
    const checkIdentity = async () => {
      hasCheckedRef.current = true;

      // Small delay to ensure identity is fully persisted after import
      await new Promise(resolve => setTimeout(resolve, IDENTITY_VERIFICATION_DELAY_MS));

      try {
        // Check multiple times with retries to handle transient issues
        let identityExists = false;
        for (let i = 0; i < IDENTITY_VERIFICATION_MAX_RETRIES; i++) {
          identityExists = await hasIdentity();
          if (identityExists) break;
          if (i < IDENTITY_VERIFICATION_MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, IDENTITY_VERIFICATION_RETRY_DELAY_MS));
          }
        }

        if (!identityExists && mounted) {
          alert(
            'Identity Not Found',
            'Identity was not found. Please try importing again.',
            [
              {
                text: 'OK',
                onPress: () => {
                  router.replace('/(auth)/import-identity');
                },
              },
            ]
          );
        }
      } catch {
        // Don't redirect on error - might be transient, let user continue
        // Error is handled silently to avoid disrupting user flow
      }
    };

    checkIdentity();
    return () => {
      mounted = false;
    };
  }, [hasIdentity, alert, router]);

  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  // Shared auth handlers
  const { handleRequestNotifications, isRequestingNotifications } = useAuthHandlers({
    signIn,
    oxyServices,
    usernameRef,
    setAuthError,
    setSigningIn,
    isAuthenticated,
  });

  return (
    <View style={[styles.container, { backgroundColor }]} pointerEvents={isSigningIn ? 'none' : 'auto'}>
      <NotificationsStep
        error={error}
        onRequestNotifications={handleRequestNotifications}
        isRequestingNotifications={isRequestingNotifications}
        isSigningIn={isSigningIn}
        backgroundColor={backgroundColor}
        textColor={textColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

