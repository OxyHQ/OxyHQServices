import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { LoadingSpinner } from '@/components/ui/Loading';
import { CREATING_PROGRESS_MESSAGES, CREATING_SUBTITLE } from '../_constants';

interface CreatingStepProps {
  progress: number;
  backgroundColor: string;
  textColor: string;
}

/**
 * Creating step component showing progress during identity creation
 */
export function CreatingStep({ progress, backgroundColor, textColor }: CreatingStepProps) {
  const currentMessage = CREATING_PROGRESS_MESSAGES[progress] || CREATING_PROGRESS_MESSAGES[0];

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.centeredContainer}>
        <LoadingSpinner iconSize={48} color={textColor} />
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
          {CREATING_SUBTITLE}
        </Text>
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
  progressMessageContainer: {
    marginTop: 20,
    minHeight: 30,
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
});

