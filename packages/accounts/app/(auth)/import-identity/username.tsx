import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColors } from '@/hooks/useColors';
import { UsernameStep } from '@/components/auth/UsernameStep';
import { useNetworkStatus } from '@/hooks/auth/useNetworkStatus';
import { generateSuggestedUsername } from '@/utils/auth/usernameUtils';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';

/**
 * Import Identity - Username Screen
 * 
 * Allows user to choose a username (skippable if offline)
 */
export default function ImportIdentityUsernameScreen() {
  const router = useRouter();
  const colors = useColors();
  const { oxyServices } = useOxy();
  const { isOffline, checkNetworkStatus } = useNetworkStatus();
  const { usernameRef } = useAuthFlowContext();

  const backgroundColor = colors.background;
  const textColor = colors.text;

  // Lazy initialiser keeps the suggestion stable across re-renders.
  const [username, setUsername] = useState<string>(() => generateSuggestedUsername());

  // Update username ref whenever username changes
  useEffect(() => {
    usernameRef.current = username;
  }, [username, usernameRef]);

  // Check network state on mount
  useEffect(() => {
    checkNetworkStatus();
  }, [checkNetworkStatus]);

  const handleContinue = useCallback(() => {
    // Save username to ref for later use after sign-in
    usernameRef.current = username;
    // Navigate to notifications step
    router.replace('/(auth)/import-identity/notifications');
  }, [username, usernameRef, router]);

  const handleSkip = useCallback(() => {
    // Skip username step - user can set it later
    usernameRef.current = '';
    router.replace('/(auth)/import-identity/notifications');
  }, [usernameRef, router]);

  return (
    <UsernameStep
      username={username}
      onUsernameChange={setUsername}
      onContinue={handleContinue}
      onSkip={handleSkip}
      isOffline={isOffline}
      oxyServices={oxyServices}
      backgroundColor={backgroundColor}
      textColor={textColor}
    />
  );
}

