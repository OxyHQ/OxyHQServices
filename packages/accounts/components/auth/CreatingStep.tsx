import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing
} from 'react-native-reanimated';
import { CREATING_PROGRESS_MESSAGES, CREATING_SUBTITLE } from '@/constants/auth';
import hedgehogAnimation from '@/assets/lottie/Hedgehog.json';

interface CreatingStepProps {
  progress: number;
  backgroundColor: string;
  textColor: string;
  isSyncing?: boolean;
  isSigningIn?: boolean;
}

const TOTAL_PROGRESS_STEPS = 3; // 0, 1, 2

/**
 * Creating step component showing progress during identity creation, sync, and sign-in
 */
export function CreatingStep({ progress, backgroundColor, textColor, isSyncing, isSigningIn }: CreatingStepProps) {
  // Determine message based on current state
  let currentMessage: string;
  let subtitle: string = CREATING_SUBTITLE;

  if (isSigningIn) {
    currentMessage = 'Signing in...';
    subtitle = 'Almost there!';
  } else if (isSyncing) {
    currentMessage = 'Syncing your identity...';
    subtitle = 'Connecting to Oxy servers';
  } else {
    currentMessage = CREATING_PROGRESS_MESSAGES[progress] || CREATING_PROGRESS_MESSAGES[0];
  }

  const progressValue = useSharedValue(0);

  useEffect(() => {
    // Animate progress from 0 to 1 based on current progress step
    // Progress can be 0, 1, or 2 (3 steps total)
    const targetProgress = Math.min(progress / (TOTAL_PROGRESS_STEPS - 1), 1);
    progressValue.value = withTiming(targetProgress, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, progressValue]);

  const progressBarStyle = useAnimatedStyle(() => {
    const widthPercent = interpolate(
      progressValue.value,
      [0, 1],
      [0, 100],
      'clamp'
    );
    return {
      width: `${widthPercent}%`,
    };
  });

  const progressBarContainerStyle = useAnimatedStyle(() => {
    // Always visible, but slightly more opaque when there's progress
    return {
      opacity: progressValue.value > 0 ? 1 : 0.5,
    };
  });

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.centeredContainer}>
        <LottieView
          source={hedgehogAnimation}
          autoPlay
          loop
          style={styles.lottieAnimation}
        />
        <Animated.View
          key={progress}
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          style={styles.progressMessageContainer}
        >
          <Text style={[styles.creatingTitle, { color: textColor }]}>
            {currentMessage}
          </Text>
        </Animated.View>
        <Text style={[styles.creatingSubtitle, { color: textColor, opacity: 0.6 }]}>
          {subtitle}
        </Text>

        {/* Progress Bar */}
        <Animated.View
          style={[
            styles.progressBarContainer,
            progressBarContainerStyle,
            {
              backgroundColor: backgroundColor === '#000000' || backgroundColor === 'rgba(0, 0, 0, 1)'
                ? 'rgba(255, 255, 255, 0.1)'
                : 'rgba(0, 0, 0, 0.1)'
            }
          ]}
        >
          <Animated.View
            style={[
              styles.progressBar,
              progressBarStyle,
              { backgroundColor: textColor }
            ]}
          />
        </Animated.View>
      </View>
    </View>
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
  lottieAnimation: {
    width: 120,
    height: 120,
  },
  progressMessageContainer: {
    marginTop: 20,
    minHeight: 30,
  },
  creatingTitle: {
    fontSize: 20,
    fontFamily: 'Inter-SemiBold',
    fontWeight: '600',
    marginTop: 20,
    textAlign: 'center',
  },
  creatingSubtitle: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  progressBarContainer: {
    width: '80%',
    maxWidth: 300,
    height: 4,
    borderRadius: 2,
    marginTop: 32,
    overflow: 'hidden',
    // Ensure container is always visible
    minHeight: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
    // Ensure minimum width for visibility even at 0%
    minWidth: 1,
  },
});

