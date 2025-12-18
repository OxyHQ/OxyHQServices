import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy, RecoveryPhraseService } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import * as Notifications from 'expo-notifications';

type Step = 'import' | 'username' | 'notifications';

// Generate a random suggested username
const generateSuggestedUsername = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export default function ImportIdentityScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const { importIdentity, isLoading, oxyServices, signIn } = useOxy();

  const backgroundColor = useMemo(() => 
    colorScheme === 'dark' ? '#000000' : '#FFFFFF',
    [colorScheme]
  );
  const textColor = useMemo(() => 
    colorScheme === 'dark' ? '#FFFFFF' : '#000000',
    [colorScheme]
  );

  const [step, setStep] = useState<Step>('import');
  const [phraseWords, setPhraseWords] = useState<string[]>(new Array(12).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Username step state
  const [username, setUsername] = useState<string>('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

  // Notifications step state
  const [isRequestingNotifications, setIsRequestingNotifications] = useState(false);
  const hasInitializedUsername = useRef(false);
  const previousStepRef = useRef<Step>('import');

  // Initialize suggested username only once when first entering username step
  useEffect(() => {
    if (step === 'username' && !hasInitializedUsername.current) {
      setUsername(generateSuggestedUsername());
      hasInitializedUsername.current = true;
    }
    // Reset flag when leaving username step
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

  const handleWordChange = useCallback((index: number, word: string) => {
    setPhraseWords(prev => {
      const newWords = [...prev];
      newWords[index] = word.toLowerCase().trim();
      return newWords;
    });
    setError(null);
  }, []);

  const handlePaste = useCallback((text: string) => {
    const words = text.trim().toLowerCase().split(/\s+/);
    if (words.length === 12 || words.length === 24) {
      setPhraseWords(words.slice(0, 12));
    }
  }, []);

  const handleImportPhrase = useCallback(async () => {
    const phrase = phraseWords.join(' ');

    if (!RecoveryPhraseService.validatePhrase(phrase)) {
      setError('Invalid recovery phrase. Please check the words and try again.');
      return;
    }

    setError(null);

    try {
      const result = await importIdentity(phrase);
      const wasOffline = !result.synced;
      setIsOffline(wasOffline);
      
      // Check if offline - if so, skip username step
      if (wasOffline) {
        // Skip username step when offline, go directly to notifications
        setStep('notifications');
      } else {
        setStep('username');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import identity');
    }
  }, [phraseWords, importIdentity]);

  const handleUsernameContinue = useCallback(async () => {
    if (!username || username.length < 4 || !/^[a-z0-9]+$/i.test(username)) {
      setUsernameError('Please enter a valid username (4+ characters, a-z and 0-9 only)');
      return;
    }

    if (usernameAvailable === false || isCheckingUsername) {
      return;
    }

    // Save username if we have oxyServices
    if (oxyServices) {
      try {
        await oxyServices.updateProfile({ username });
      } catch (err: any) {
        // If offline, continue anyway
        if (!err?.message?.includes('network') && !err?.message?.includes('offline')) {
          setError(err?.message || 'Failed to save username');
          return;
        }
      }
    }

    setStep('notifications');
  }, [username, usernameAvailable, isCheckingUsername, oxyServices]);

  const handleSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      await signIn();
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  }, [router, signIn]);

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

  // Import step
  const renderImportStep = () => (
    <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.stepContainer}>
          <Text style={[styles.title, { color: textColor }]}>Import Your Identity</Text>
          <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
            Enter your 12-word recovery phrase to restore your identity.
          </Text>

          <View style={[styles.phraseGrid, { 
            backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5', 
            borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0' 
          }]}>
            {phraseWords.map((word, index) => (
              <View key={index} style={styles.wordInputContainer}>
                <Text style={[styles.wordNumber, { color: textColor, opacity: 0.6 }]}>{index + 1}</Text>
                <TextInput
                  style={[styles.wordInput, { 
                    color: textColor, 
                    borderColor: colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0' 
                  }]}
                  value={word}
                  onChangeText={(text) => handleWordChange(index, text)}
                  onPaste={(e) => handlePaste(e.nativeEvent.text)}
                  placeholder="word"
                  placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#8E8E93'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: textColor }]}
            onPress={handleImportPhrase}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={backgroundColor} />
            ) : (
              <Text style={[styles.primaryButtonText, { color: backgroundColor }]}>
                Import Identity
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push('/(auth)/create-identity')}
          >
            <Text style={[styles.linkText, { color: textColor, opacity: 0.6 }]}>
              Create a new identity instead
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

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
            onPress={() => {}}
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
      {step === 'import' && renderImportStep()}
      {step === 'username' && renderUsernameStep()}
      {step === 'notifications' && renderNotificationsStep()}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 60,
  },
  stepContainer: {
    flex: 1,
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
  errorText: {
    color: '#DC3545',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  phraseGrid: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  wordInputContainer: {
    width: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  wordNumber: {
    fontSize: 12,
    width: 20,
  },
  wordInput: {
    flex: 1,
    borderBottomWidth: 1,
    paddingVertical: 4,
    fontSize: 14,
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
  notificationIllustration: {
    alignItems: 'center',
    marginBottom: 32,
  },
  notificationIcon: {
    fontSize: 64,
  },
});
