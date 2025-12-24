import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NotificationsStep } from '@/components/auth/NotificationsStep';
import { useAuthHandlers } from '@/hooks/auth/useAuthHandlers';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';

/**
 * Create Identity - Notifications Screen
 * 
 * Requests push notification permissions and completes sign-in
 */
export default function CreateIdentityNotificationsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { signIn, oxyServices, isAuthenticated, isIdentitySynced, syncIdentity } = useOxy();
  const { error, isSigningIn, setAuthError, setSigningIn, usernameRef } = useAuthFlowContext();

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
    isIdentitySynced,
    syncIdentity,
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

