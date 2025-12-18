import React, { useMemo } from 'react';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { NotificationsStep } from '@/components/auth/NotificationsStep';
import { useAuthHandlers } from '@/hooks/auth/useAuthHandlers';
import { useAuthFlowContext } from '../_authFlowContext';

/**
 * Import Identity - Notifications Screen
 * 
 * Requests push notification permissions and completes sign-in
 */
export default function ImportIdentityNotificationsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { signIn, oxyServices } = useOxy();
  const { error, isSigningIn, setAuthError, setSigningIn, usernameRef } = useAuthFlowContext();

  const backgroundColor = useMemo(() =>
    colorScheme === 'dark' ? '#000000' : '#FFFFFF',
    [colorScheme]
  );
  const textColor = useMemo(() =>
    colorScheme === 'dark' ? '#FFFFFF' : '#000000',
    [colorScheme]
  );

  // Shared auth handlers
  const { handleRequestNotifications, isRequestingNotifications } = useAuthHandlers({
    signIn,
    oxyServices,
    usernameRef,
    setAuthError,
    setSigningIn,
  });

  return (
    <NotificationsStep
      error={error}
      onRequestNotifications={handleRequestNotifications}
      isRequestingNotifications={isRequestingNotifications}
      isSigningIn={isSigningIn}
      backgroundColor={backgroundColor}
      textColor={textColor}
    />
  );
}

