import type React from 'react';
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  interpolateColor,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

// Example component showcasing improved Reanimated usage
const AnimationExample: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);

  // Shared values for better performance
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const rotation = useSharedValue(0);
  const progress = useSharedValue(0);
  const colorProgress = useSharedValue(0);

  // Animated styles with proper interpolation
  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [
        { scale: scale.value },
        { translateX: translateX.value },
        { rotate: `${rotation.value}deg` },
      ],
    };
  });

  const progressStyle = useAnimatedStyle(() => {
    return {
      width: `${progress.value * 100}%`,
      backgroundColor: interpolateColor(
        colorProgress.value,
        [0, 1],
        ['#3498db', '#e74c3c']
      ),
    };
  });

  const backgroundStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: interpolateColor(
        colorProgress.value,
        [0, 1],
        ['#ecf0f1', '#f39c12']
      ),
    };
  });

  // Complex animation sequence
  const animateSequence = () => {
    'worklet';

    // Staggered animations for smooth transitions
    opacity.value = withTiming(0.5, { duration: 200 });
    scale.value = withSpring(0.8, { damping: 15, stiffness: 150 });

    // Delayed follow-up animations
    translateX.value = withDelay(
      100,
      withSpring(50, { damping: 20, stiffness: 100 }, (finished) => {
        if (finished) {
          translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
        }
      })
    );

    // Sequential animations
    rotation.value = withSequence(
      withTiming(10, { duration: 150 }),
      withTiming(-10, { duration: 150 }),
      withTiming(0, { duration: 150 })
    );

    // Progress animation with easing
    progress.value = withTiming(1, {
      duration: 1000,
      easing: Easing.out(Easing.exp)
    }, (finished) => {
      if (finished) {
        runOnJS(setCurrentStep)(currentStep + 1);
      }
    });

    // Color transition
    colorProgress.value = withTiming(1, { duration: 800 });

    // Reset animations
    setTimeout(() => {
      opacity.value = withSpring(1);
      scale.value = withSpring(1);
      progress.value = withTiming(0, { duration: 500 });
      colorProgress.value = withTiming(0, { duration: 500 });
    }, 1500);
  };

  return (
    <Animated.View style={[styles.container, backgroundStyle]}>
      <Text style={styles.title}>Advanced Reanimated Example</Text>
      <Text style={styles.subtitle}>Step: {currentStep}</Text>

      <Animated.View style={[styles.box, animatedStyle]}>
        <Text style={styles.boxText}>Animated Box</Text>
      </Animated.View>

      <View style={styles.progressContainer}>
        <Animated.View style={[styles.progressBar, progressStyle]} />
      </View>

      <TouchableOpacity style={styles.button} onPress={animateSequence}>
        <Text style={styles.buttonText}>Animate Sequence</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#2c3e50',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 30,
    color: '#7f8c8d',
  },
  box: {
    width: 150,
    height: 150,
    backgroundColor: '#3498db',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  boxText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  progressContainer: {
    width: '100%',
    height: 10,
    backgroundColor: '#ecf0f1',
    borderRadius: 5,
    marginBottom: 30,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 5,
  },
  button: {
    backgroundColor: '#e74c3c',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default AnimationExample;
