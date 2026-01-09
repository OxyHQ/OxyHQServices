import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useOxy, useAuthStore } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UsernameStep } from '@/components/auth/UsernameStep';
import { useNetworkStatus } from '@/hooks/auth/useNetworkStatus';
import { generateSuggestedUsername } from '@/utils/auth/usernameUtils';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage, isNetworkOrTimeoutError } from '@/utils/auth/errorUtils';
import { Colors } from '@/constants/theme';

/**
 * Create Identity - Username Screen
 * 
 * Allows user to choose a username (mandatory when online)
 */
export default function CreateIdentityUsernameScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { oxyServices } = useOxy();
  const { isOffline } = useNetworkStatus();
  const { usernameRef } = useAuthFlowContext();

  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  const [username, setUsername] = useState<string>('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Generate random suggested username on mount
  useEffect(() => {
    setUsername(generateSuggestedUsername(null));
  }, []);

  // Update username ref whenever username changes
  useEffect(() => {
    usernameRef.current = username;
  }, [username, usernameRef]);

  const handleContinue = useCallback(async () => {
    if (!oxyServices || !username.trim()) {
      return;
    }

    setIsUpdatingProfile(true);
    setUpdateError(null);

    try {
      // Sync should have already happened in the previous step, so we should have a valid token
      // Just update the profile - if token is missing, updateProfile will handle the error
      const updatedUser = await oxyServices.updateProfile({ username: username.trim() });

      if (updatedUser) {
        useAuthStore.getState().setUser(updatedUser);
        router.push('/(auth)/create-identity/notifications');
      } else {
        setUpdateError('Failed to update profile. Please try again.');
        setIsUpdatingProfile(false);
      }
    } catch (err: unknown) {
      const errorMessage = extractAuthErrorMessage(err, 'Failed to update username. Please try again.');

      const offline = await checkIfOffline();
      if (offline && isNetworkOrTimeoutError(err)) {
        usernameRef.current = username.trim();
        router.push('/(auth)/create-identity/notifications');
      } else {
        setUpdateError(errorMessage);
        setIsUpdatingProfile(false);
      }
    }
  }, [username, oxyServices, router, usernameRef]);

  return (
    <UsernameStep
      username={username}
      onUsernameChange={setUsername}
      onContinue={handleContinue}
      onSkip={undefined}
      isOffline={isOffline}
      oxyServices={oxyServices}
      backgroundColor={backgroundColor}
      textColor={textColor}
      colorScheme={colorScheme}
      isUpdating={isUpdatingProfile}
      updateError={updateError}
    />
  );
}

