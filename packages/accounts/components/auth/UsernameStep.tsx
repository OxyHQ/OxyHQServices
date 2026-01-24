import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import LottieView from 'lottie-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, KeyboardAwareScrollViewWrapper } from '@/components/ui';
import { useUsernameValidation } from '@/hooks/auth/useUsernameValidation';
import { sanitizeUsernameInput } from '@/utils/auth/usernameUtils';
import type { OxyServices } from '@oxyhq/services';
import telescopeAnimation from '@/assets/lottie/telescope.json';

interface UsernameStepProps {
  username: string;
  onUsernameChange: (username: string) => void;
  onContinue: () => void;
  onSkip?: () => void; // Optional - username is mandatory when online
  isOffline: boolean;
  oxyServices: OxyServices | null;
  backgroundColor: string;
  textColor: string;
  colorScheme: 'light' | 'dark';
  isUpdating?: boolean;
  updateError?: string | null;
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
  isUpdating = false,
  updateError = null,
}: UsernameStepProps) {
  const insets = useSafeAreaInsets();
  const validation = useUsernameValidation(username, oxyServices);
  const lottieRef = useRef<LottieView>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [shouldLoop, setShouldLoop] = useState(false);
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(true); // Start as true since autoPlay will start it

  const isUsernameValid = validation.isValid;

  // Play animation when checking username availability
  useEffect(() => {
    if (validation.isChecking && lottieRef.current) {
      setShouldLoop(true);
      setIsAnimationPlaying(true);
      lottieRef.current.reset();
      lottieRef.current.play();
    } else if (!validation.isChecking && !isConfirming) {
      setShouldLoop(false);
    }
  }, [validation.isChecking, isConfirming]);

  // Handle animation finish
  const handleAnimationFinish = () => {
    // Only mark as finished if not looping
    if (!shouldLoop && !validation.isChecking && !isConfirming) {
      setIsAnimationPlaying(false);
    }
  };

  // Handle tap on animation - only allow when animation has ended
  const handleAnimationPress = () => {
    // Only allow tap when animation is not playing and not looping
    if (!isAnimationPlaying && !shouldLoop && !validation.isChecking && !isConfirming) {
      if (lottieRef.current) {
        setIsAnimationPlaying(true);
        lottieRef.current.reset();
        lottieRef.current.play();
      }
    }
  };

  // Can continue if:
  // 1. Username is valid AND
  // 2. Either: available === true, available === null (not checked yet), or offline AND
  // 3. Not currently checking availability
  const canContinue = isUsernameValid && (
    validation.isAvailable === true ||
    validation.isAvailable === null ||
    isOffline
  ) && !validation.isChecking && !isConfirming;

  const handleTextChange = (text: string) => {
    const sanitized = sanitizeUsernameInput(text);
    onUsernameChange(sanitized);
  };

  const handleContinue = () => {
    // Validate username format
    if (!isUsernameValid) {
      return;
    }

    // Don't proceed if username is explicitly unavailable or currently being checked
    if (validation.isAvailable === false || validation.isChecking) {
      return;
    }

    // Start confirmation animation
    setIsConfirming(true);
    setShouldLoop(true);
    setIsAnimationPlaying(true);

    // Reset and play animation from start
    if (lottieRef.current) {
      lottieRef.current.reset();
      lottieRef.current.play();
    }

    // Wait 4 seconds before proceeding to next step
    setTimeout(() => {
      setShouldLoop(false);
      onContinue();
    }, 4000);
  };

  return (
    <View style={[styles.container, { backgroundColor, paddingTop: insets.top }]}>
      <KeyboardAwareScrollViewWrapper contentContainerStyle={styles.stepContainer}>
        <View style={styles.animationContainer}>
          <TouchableOpacity
            onPress={handleAnimationPress}
            activeOpacity={0.8}
            disabled={isAnimationPlaying || shouldLoop || validation.isChecking || isConfirming}
          >
            <LottieView
              ref={lottieRef}
              source={telescopeAnimation}
              autoPlay
              loop={shouldLoop || validation.isChecking}
              style={styles.lottieAnimation}
              onAnimationFinish={handleAnimationFinish}
            />
          </TouchableOpacity>
        </View>
        <Text style={[styles.title, { color: textColor }]}>Choose your username</Text>
        <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
          {isOffline
            ? 'You\'re offline. You can set your username later when online.'
            : 'Your username is required. You can change this later in settings.'}
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

        {(validation.error || updateError) && (
          <Text style={styles.errorText}>{validation.error || updateError}</Text>
        )}

        <Button
          variant="primary"
          onPress={handleContinue}
          disabled={(!canContinue && !isOffline) || isUpdating || isConfirming}
          loading={isUpdating || isConfirming}
          style={styles.primaryButton}
        >
          {isUpdating ? 'Saving...' : isConfirming ? 'Confirming...' : 'Confirm'}
        </Button>

        {/* Only show skip button if offline and onSkip is provided (for offline fallback) */}
        {isOffline && onSkip && (
          <Button
            variant="ghost"
            onPress={onSkip}
            style={styles.skipButton}
            disabled={isUpdating}
          >
            Skip for now
          </Button>
        )}

        {!isOffline && (
          <Button
            variant="ghost"
            onPress={() => { }}
            disabled={isUpdating}
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
  animationContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  lottieAnimation: {
    width: 150,
    height: 150,
  },
  title: {
    fontSize: 38,
    fontFamily: 'Inter-SemiBold',
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

