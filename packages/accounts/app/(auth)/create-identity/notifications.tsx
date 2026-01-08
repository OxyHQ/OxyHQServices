import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NotificationsStep } from '@/components/auth/NotificationsStep';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';

/**
 * Check if running in Expo Go
 * 
 * Push notifications are not available in Expo Go (SDK 53+),
 * so we skip notification permission requests in this environment
 */
const isExpoGo = (): boolean => {
  try {
    return Constants.executionEnvironment === 'storeClient';
  } catch {
    return false;
  }
};

/**
 * Create Identity - Notifications Screen
 * 
 * Requests push notification permissions and completes onboarding.
 * User should already be authenticated at this point (signed in after sync).
 */
export default function CreateIdentityNotificationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { isAuthenticated } = useOxy();
  const { error, setAuthError } = useAuthFlowContext();
  const [isRequestingNotifications, setIsRequestingNotifications] = React.useState(false);

  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  /**
   * Handle notification permission request and complete onboarding
   * User is already authenticated at this point (signed in after sync)
   */
  const handleRequestNotifications = useCallback(async () => {
    // Verify user is authenticated before proceeding
    if (!isAuthenticated) {
      setAuthError('Please sign in first');
      return;
    }

    // Skip notification requests in Expo Go (push notifications not available)
    if (isExpoGo()) {
      // Navigate directly to tabs (user already authenticated)
      router.push('/(tabs)');
      return;
    }

    try {
      setIsRequestingNotifications(true);
      setAuthError(null);

      const { status: existingStatus } = await Notifications.getPermissionsAsync();

      if (existingStatus === 'granted') {
        router.push('/(tabs)');
        return;
      }

      await Notifications.requestPermissionsAsync();
      router.push('/(tabs)');
    } catch (err: unknown) {
      if (__DEV__) {
        console.warn('Notification permission request failed:', err);
      }
      router.push('/(tabs)');
    } finally {
      setIsRequestingNotifications(false);
    }
  }, [isAuthenticated, router, setAuthError]);

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <NotificationsStep
        error={error}
        onRequestNotifications={handleRequestNotifications}
        isRequestingNotifications={isRequestingNotifications}
        isSigningIn={false}
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

