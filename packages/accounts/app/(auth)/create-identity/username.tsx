import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useOxy, useAuthStore } from '@oxyhq/services';
import { useColors } from '@/hooks/useColors';
import { UsernameStep } from '@/components/auth/UsernameStep';
import { useNetworkStatus } from '@/hooks/auth/useNetworkStatus';
import { generateSuggestedUsername } from '@/utils/auth/usernameUtils';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { checkIfOffline } from '@/utils/auth/networkUtils';
import { extractAuthErrorMessage, isNetworkOrTimeoutError } from '@/utils/auth/errorUtils';

/**
 * Create Identity - Username Screen
 * 
 * Allows user to choose a username (mandatory when online)
 */
export default function CreateIdentityUsernameScreen() {
  const router = useRouter();
  const colors = useColors();
  const { oxyServices } = useOxy();
  const { isOffline } = useNetworkStatus();
  const { usernameRef } = useAuthFlowContext();

  const backgroundColor = colors.background;
  const textColor = colors.text;

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
      // Sync should have already happened in the previous step, so we should
      // have a valid token. Just update the profile — if the token is missing,
      // updateProfile will surface a clear error and we will not advance.
      const updatedUser = await oxyServices.updateProfile({ username: username.trim() });

      if (updatedUser) {
        useAuthStore.getState().setUser(updatedUser);
        usernameRef.current = username.trim();
        router.push('/(auth)/create-identity/notifications');
      } else {
        setUpdateError('Failed to update profile. Please try again.');
        setIsUpdatingProfile(false);
      }
    } catch (err: unknown) {
      const errorMessage = extractAuthErrorMessage(err, 'Failed to update username. Please try again.');

      // Critical: keep the user on this step until the username is actually
      // persisted server-side. Previously we would advance to `/notifications`
      // on transient network errors, which left the account permanently
      // username-less and rendered every list row as "@unknown". The new
      // onboarding guard in `_layout.tsx` would catch this and bounce them
      // back, but it's cleaner to block here.
      const offline = await checkIfOffline();
      const isNetwork = isNetworkOrTimeoutError(err);
      usernameRef.current = username.trim();
      if (offline && isNetwork) {
        setUpdateError(
          'You are offline. Reconnect and tap continue to save your username.',
        );
      } else {
        setUpdateError(errorMessage);
      }
      setIsUpdatingProfile(false);
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
      isUpdating={isUpdatingProfile}
      updateError={updateError}
    />
  );
}

