import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UsernameStep } from '@/components/auth/UsernameStep';
import { useNetworkStatus } from '@/hooks/auth/useNetworkStatus';
import { generateSuggestedUsername } from '@/utils/auth/usernameUtils';
import { useAuthFlowContext } from '@/contexts/auth-flow-context';
import { Colors } from '@/constants/theme';

/**
 * Import Identity - Username Screen
 * 
 * Allows user to choose a username (skippable if offline)
 */
export default function ImportIdentityUsernameScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const { oxyServices, getPublicKey } = useOxy();
  const { isOffline, checkNetworkStatus } = useNetworkStatus();
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
  const hasInitializedUsername = useRef(false);
  const isInitializingRef = useRef(false);

  // Initialize suggested username on mount (only once)
  useEffect(() => {
    if (!hasInitializedUsername.current && !isInitializingRef.current) {
      isInitializingRef.current = true;
      getPublicKey().then((publicKey) => {
        if (!hasInitializedUsername.current) {
          setUsername(generateSuggestedUsername(publicKey));
          hasInitializedUsername.current = true;
        }
        isInitializingRef.current = false;
      }).catch(() => {
        isInitializingRef.current = false;
      });
    }
  }, [getPublicKey]);

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
      colorScheme={colorScheme}
    />
  );
}

