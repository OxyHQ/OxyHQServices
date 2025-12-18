import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import * as Notifications from 'expo-notifications';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { LoadingSpinner } from '@/components/ui/Loading';
import { getNetworkStateAsync } from 'expo-network';

type Step = 'creating' | 'username' | 'notifications';

// Generate a random suggested username
const generateSuggestedUsername = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export default function CreateIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const { createIdentity, signIn, oxyServices } = useOxy();
  const { status, hasIdentity } = useOnboardingStatus();

  const backgroundColor = useMemo(() =>
    colorScheme === 'dark' ? '#000000' : '#FFFFFF',
    [colorScheme]
  );
  const textColor = useMemo(() =>
    colorScheme === 'dark' ? '#FFFFFF' : '#000000',
    [colorScheme]
  );

  const [step, setStep] = useState<Step>('creating');
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Creating step state
  const [creatingProgress, setCreatingProgress] = useState(0);
  const creatingProgressRef = useRef<NodeJS.Timeout | null>(null);

  // Username step state
  const [username, setUsername] = useState<string>('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const hasInitializedUsername = useRef(false);
  const previousStepRef = useRef<Step>('creating');

  // Notifications step state
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);

  // Check if device is offline using expo-network
  const checkIfOffline = useCallback(async (): Promise<boolean> => {
    try {
      const networkState = await getNetworkStateAsync();
      return !networkState.isConnected || !networkState.isInternetReachable;
    } catch {
      // If network check fails, assume offline to be safe
      return true;
    }
  }, []);

  // Initialize flow based on onboarding status
  useEffect(() => {
    // Wait for status to be determined
    if (status === 'checking') return;

    // If onboarding complete, shouldn't be here (handled by routing)
    if (status === 'complete') return;

    // If identity exists but onboarding in progress, resume from username
    if (status === 'in_progress' && hasIdentity) {
      setStep('username');
      if (!hasInitializedUsername.current) {
        setUsername(generateSuggestedUsername());
        hasInitializedUsername.current = true;
      }
      return;
    }

    // No identity - create one
    if (status === 'none') {
      const create = async () => {
        try {
          // Start progress animation
          setCreatingProgress(0);
          let progressStep = 0;

          const progressInterval = setInterval(() => {
            progressStep++;
            if (progressStep <= 2) {
              setCreatingProgress(progressStep);
            } else {
              clearInterval(progressInterval);
            }
          }, 500);

          creatingProgressRef.current = progressInterval as unknown as NodeJS.Timeout;

          await createIdentity();

          // Clear progress interval
          if (creatingProgressRef.current) {
            clearInterval(creatingProgressRef.current);
            creatingProgressRef.current = null;
          }

          // Small delay to show final progress message
          setTimeout(async () => {
            // Check if offline - if so, skip username step
            const isOffline = await checkIfOffline();
            if (isOffline) {
              // Skip username step when offline, go directly to notifications
              setStep('notifications');
            } else {
              setStep('username');
              if (!hasInitializedUsername.current) {
                setUsername(generateSuggestedUsername());
                hasInitializedUsername.current = true;
              }
            }
            setCreatingProgress(0);
          }, 500);
        } catch (err: any) {
          // Clear progress interval on error
          if (creatingProgressRef.current) {
            clearInterval(creatingProgressRef.current);
            creatingProgressRef.current = null;
          }

          // If identity already exists (race condition), go to username step
          if (err?.message?.includes('already exists') || err?.message?.includes('Identity already')) {
            setStep('username');
            if (!hasInitializedUsername.current) {
              setUsername(generateSuggestedUsername());
              hasInitializedUsername.current = true;
            }
            setCreatingProgress(0);
          } else {
            setError(err.message || 'Failed to create identity');
            setCreatingProgress(0);
          }
        }
      };
      create();
    }

    return () => {
      if (creatingProgressRef.current) {
        clearInterval(creatingProgressRef.current);
      }
    };
  }, [status, hasIdentity, createIdentity, checkIfOffline]);

  // Reset username initialization flag when leaving username step
  useEffect(() => {
    if (step !== 'username' && previousStepRef.current === 'username') {
      hasInitializedUsername.current = false;
      setUsername('');
    }
    previousStepRef.current = step;
  }, [step]);

  // Username validation
  useEffect(() => {
    if (!username || username.length < 4) {
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    // Validate format
    if (!/^[a-z0-9]+$/i.test(username)) {
      setUsernameError('You can use a-z, 0-9. Minimum length is 4 characters.');
      setUsernameAvailable(false);
      return;
    }

    setUsernameError(null);

    // Debounce API check
    const timer = setTimeout(async () => {
      if (!oxyServices) return;

      setIsCheckingUsername(true);
      try {
        const result = await oxyServices.checkUsernameAvailability(username);
        setUsernameAvailable(result.available);
        if (!result.available) {
          setUsernameError(result.message || 'Username is already taken');
        }
      } catch (err: any) {
        const errorMsg = err?.message || '';
        // Handle timeout and network errors gracefully
        if (
          errorMsg.includes('network') ||
          errorMsg.includes('offline') ||
          errorMsg.includes('timeout') ||
          errorMsg.includes('cancelled') ||
          errorMsg.includes('ECONNABORTED')
        ) {
          // Allow proceeding if offline/network issue
          setUsernameAvailable(true);
        } else {
          setUsernameAvailable(false);
          setUsernameError(errorMsg || 'Failed to check username availability');
        }
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [username, oxyServices]);

  const handleUsernameContinue = useCallback(async () => {
    if (!username || username.length < 4 || !/^[a-z0-9]+$/i.test(username)) {
      setUsernameError('Please enter a valid username (4+ characters, a-z and 0-9 only)');
      return;
    }

    if (usernameAvailable === false || isCheckingUsername) {
      return;
    }

    // Just proceed - we'll save username after sign-in
    setStep('notifications');
  }, [username, usernameAvailable, isCheckingUsername]);

  const handleSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      await signIn();

      // Now that we're authenticated, update profile with username
      if (username && oxyServices) {
        try {
          await oxyServices.updateProfile({ username });
        } catch (err: any) {
          // Log but don't block - username can be set later
          console.warn('Failed to set username:', err);
        }
      }

      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  }, [router, signIn, username, oxyServices]);

  const handleRequestNotifications = useCallback(async () => {
    setIsRequestingNotifications(true);
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();

      if (existingStatus !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }

      await handleSignIn();
    } catch (err: any) {
      console.error('Error requesting notifications:', err);
      await handleSignIn();
    } finally {
      setIsRequestingNotifications(false);
    }
  }, [handleSignIn]);

  // Creating animation step
  const renderCreatingStep = () => {
    const progressMessages = [
      'Generating cryptographic keys...',
      'Creating your identity...',
      'Setting up your account...',
    ];

    const currentMessage = progressMessages[creatingProgress] || progressMessages[0];

    return (
      <View style={[styles.container, { backgroundColor }]}>
        <View style={styles.centeredContainer}>
          <LoadingSpinner iconSize={48} color={textColor} />
          <Animated.View
            key={creatingProgress}
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={styles.progressMessageContainer}
          >
            <Text style={[styles.creatingTitle, { color: textColor }]}>
              {currentMessage}
            </Text>
          </Animated.View>
          <Text style={[styles.creatingSubtitle, { color: textColor, opacity: 0.6 }]}>
            This may take a moment
          </Text>
        </View>
      </View>
    );
  };

  // Username step
  const renderUsernameStep = () => {
    const isUsernameValid = username.length >= 4 && /^[a-z0-9]+$/i.test(username);
    const canContinue = isUsernameValid && (usernameAvailable === true || usernameAvailable === null) && !isCheckingUsername;

    return (
      <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
        <View style={styles.stepContainer}>
          <Text style={[styles.title, { color: textColor }]}>Choose your username</Text>
          <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
            You can change this later in the settings
          </Text>

          <View style={styles.inputWrapper}>
            <TextInput
              style={[styles.usernameInput, {
                color: textColor,
                backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                borderColor: usernameError ? '#DC3545' : (colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0')
              }]}
              placeholder="Username"
              placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#8E8E93'}
              value={username}
              onChangeText={(text) => {
                setUsername(text.toLowerCase().replace(/[^a-z0-9]/g, ''));
                setUsernameError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          </View>

          <Text style={[styles.inputHint, { color: textColor, opacity: 0.6 }]}>
            You can use a-z, 0-9. Minimum length is 4 characters.
          </Text>

          {isCheckingUsername && (
            <Text style={[styles.checkingText, { color: textColor, opacity: 0.6 }]}>
              Checking availability...
            </Text>
          )}

          {usernameAvailable === true && !isCheckingUsername && (
            <Text style={[styles.availableText, { color: '#28A745' }]}>
              ✓ Username is available
            </Text>
          )}

          {usernameError && (
            <Text style={styles.errorText}>{usernameError}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor: canContinue ? textColor : (colorScheme === 'dark' ? '#2C2C2E' : '#CCCCCC'),
                opacity: canContinue ? 1 : 0.6,
              }
            ]}
            onPress={handleUsernameContinue}
            disabled={!canContinue}
          >
            <Text style={[
              styles.primaryButtonText,
              { color: canContinue ? backgroundColor : (colorScheme === 'dark' ? '#8E8E93' : '#999999') }
            ]}>
              Confirm
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => { }}
          >
            <Text style={[styles.linkText, { color: textColor, opacity: 0.6 }]}>
              Learn more about usernames
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Notifications step
  const renderNotificationsStep = () => (
    <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
      <View style={styles.stepContainer}>
        <View style={styles.notificationIllustration}>
          <Text style={styles.notificationIcon}>🔔</Text>
        </View>

        <Text style={[styles.title, { color: textColor }]}>Receive push notifications</Text>
        <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
          Don&apos;t miss messages from friends, transaction alerts, and feature updates.
        </Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: textColor }]}
          onPress={handleRequestNotifications}
          disabled={isRequestingNotifications || isSigningIn}
        >
          {isRequestingNotifications || isSigningIn ? (
            <ActivityIndicator color={backgroundColor} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: backgroundColor }]}>
              Enable notifications
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <>
      {step === 'creating' && renderCreatingStep()}
      {step === 'username' && renderUsernameStep()}
      {step === 'notifications' && renderNotificationsStep()}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  stepContainer: {
    flex: 1,
    padding: 24,
    paddingTop: 60,
    justifyContent: 'center',
  },
  title: {
    fontSize: 38,
    fontFamily: 'Phudu-SemiBold',
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
    lineHeight: 22,
    textAlign: 'center',
  },
  creatingTitle: {
    fontSize: 20,
    fontFamily: 'Phudu-SemiBold',
    fontWeight: '600',
    marginTop: 20,
    textAlign: 'center',
  },
  creatingSubtitle: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  progressMessageContainer: {
    marginTop: 20,
    minHeight: 30,
  },
  inputWrapper: {
    marginTop: 24,
    marginBottom: 8,
  },
  usernameInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  inputHint: {
    fontSize: 12,
    marginBottom: 8,
  },
  checkingText: {
    fontSize: 12,
    marginTop: 4,
  },
  availableText: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  errorText: {
    color: '#DC3545',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  primaryButton: {
    padding: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
    minHeight: 56,
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: 'Phudu-SemiBold',
    fontWeight: '600',
  },
  linkButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  linkText: {
    fontSize: 16,
    textDecorationLine: 'underline',
  },
  notificationIllustration: {
    alignItems: 'center',
    marginBottom: 32,
  },
  notificationIcon: {
    fontSize: 64,
  },
});
