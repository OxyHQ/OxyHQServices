import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, KeyboardAwareScrollViewWrapper } from '@/components/ui';
import { useUsernameValidation } from '../hooks/useUsernameValidation';
import { sanitizeUsernameInput, USERNAME_INVALID_ERROR } from '../utils/usernameUtils';
import type { OxyServices } from '@oxyhq/services';

interface UsernameStepProps {
  username: string;
  onUsernameChange: (username: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  isOffline: boolean;
  oxyServices: OxyServices | null;
  backgroundColor: string;
  textColor: string;
  colorScheme: 'light' | 'dark';
}

/**
 * Username step component for choosing a username
 */
export function UsernameStep({
  username,
  onUsernameChange,
  onContinue,
  onSkip,
  isOffline,
  oxyServices,
  backgroundColor,
  textColor,
  colorScheme,
}: UsernameStepProps) {
  const insets = useSafeAreaInsets();
  const validation = useUsernameValidation(username, oxyServices);

  const isUsernameValid = validation.isValid;
  const canContinue = isUsernameValid && (
    validation.isAvailable === true ||
    validation.isAvailable === null ||
    isOffline
  ) && !validation.isChecking;

  const handleTextChange = (text: string) => {
    const sanitized = sanitizeUsernameInput(text);
    onUsernameChange(sanitized);
  };

  const handleContinue = () => {
    if (!isUsernameValid) {
      return;
    }
    if (validation.isAvailable === false || validation.isChecking) {
      return;
    }
    onContinue();
  };

  return (
    <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
      <KeyboardAwareScrollViewWrapper contentContainerStyle={styles.stepContainer}>
        <Text style={[styles.title, { color: textColor }]}>Choose your username</Text>
        <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
          {isOffline
            ? 'You\'re offline. You can skip this step and set your username later.'
            : 'You can change this later in the settings'}
        </Text>

        <View style={styles.inputWrapper}>
          <TextInput
            style={[styles.usernameInput, {
              color: textColor,
              backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
              borderColor: validation.error ? '#DC3545' : (colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0')
            }]}
            placeholder="Username"
            placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#8E8E93'}
            value={username}
            onChangeText={handleTextChange}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>

        <Text style={[styles.inputHint, { color: textColor, opacity: 0.6 }]}>
          You can use a-z, 0-9. Minimum length is 4 characters.
        </Text>

        {validation.isChecking && (
          <Text style={[styles.checkingText, { color: textColor, opacity: 0.6 }]}>
            Checking availability...
          </Text>
        )}

        {validation.isAvailable === true && !validation.isChecking && (
          <Text style={[styles.availableText, { color: '#28A745' }]}>
            ✓ Username is available
          </Text>
        )}

        {validation.error && (
          <Text style={styles.errorText}>{validation.error}</Text>
        )}

        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={!canContinue && !isOffline}
          style={styles.primaryButton}
        >
          Confirm
        </Button>

        {isOffline && (
          <Button
            variant="ghost"
            onPress={onSkip}
            style={styles.skipButton}
          >
            Skip for now
          </Button>
        )}

        {!isOffline && (
          <Button
            variant="ghost"
            onPress={() => { }}
          >
            Learn more about usernames
          </Button>
        )}
      </KeyboardAwareScrollViewWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    marginTop: 32,
  },
  skipButton: {
    marginTop: 12,
  },
});

