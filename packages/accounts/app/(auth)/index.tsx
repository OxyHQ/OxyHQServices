import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StaggeredText, type StaggeredTextRef } from '@/components/staggered-text';
import { RotatingTextAnimation } from '@/components/staggered-text/rotating-text';
import { Colors } from '@/constants/theme';

const humanTranslations = [
  'Human',
  'Humano',
  'Humain',
  'Mensch',
  '人类',
  '人間',
  'إنسان',
];

export default function AuthIndexScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  // Entrance animation values
  const helloOpacity = useSharedValue(0);
  const helloTranslateY = useSharedValue(20);
  const humanOpacity = useSharedValue(0);
  const footerOpacity = useSharedValue(0);

  // Refs for staggered text
  const helloRef = useRef<StaggeredTextRef>(null);
  const tapToContinueRef = useRef<StaggeredTextRef>(null);

  const entranceHelloStyle = useAnimatedStyle(() => ({
    opacity: helloOpacity.value,
    transform: [{ translateY: helloTranslateY.value }],
  }));

  const entranceHumanStyle = useAnimatedStyle(() => ({
    opacity: humanOpacity.value,
  }));

  const footerStyle = useAnimatedStyle(() => ({
    opacity: footerOpacity.value,
  }));

  // Initial entrance animation
  useEffect(() => {
    // "Hello" appears first
    const t1 = setTimeout(() => {
      helloOpacity.value = withTiming(1, { duration: 600 });
      helloTranslateY.value = withTiming(0, { duration: 600 });
      helloRef.current?.reset();
      setTimeout(() => helloRef.current?.animate(), 200);
    }, 200);

    // Human text appears
    const t2 = setTimeout(() => {
      humanOpacity.value = withTiming(1, { duration: 600 });
    }, 800);

    // Footer appears
    const t3 = setTimeout(() => {
      footerOpacity.value = withTiming(1, { duration: 600 });
      tapToContinueRef.current?.reset();
      setTimeout(() => tapToContinueRef.current?.animate(), 200);
    }, 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = useCallback(() => {
    router.push('./welcome');
  }, [router]);

  return (
    <Pressable style={[styles.container, { backgroundColor }]} onPress={handlePress}>
      <View style={styles.content}>
        <View style={styles.textContainer}>
          {/* "Hello" text with entrance animation */}
          <Animated.View style={entranceHelloStyle}>
            <StaggeredText
              text="Hello"
              ref={helloRef}
              fontSize={48}
              textStyle={[styles.text, { color: textColor }]}
            />
          </Animated.View>

          {/* Rotating human text with drum effect */}
          <Animated.View style={entranceHumanStyle}>
            <RotatingTextAnimation
              texts={humanTranslations}
              fontSize={48}
              interval={3000}
              duration={600}
              textStyle={{ ...styles.text, color: textColor }}
              containerStyle={styles.rotatingContainer}
            />
          </Animated.View>
        </View>
      </View>

      {/* Footer */}
      <Animated.View style={[styles.footer, footerStyle]}>
        <StaggeredText
          text="Tap to continue"
          ref={tapToContinueRef}
          fontSize={16}
          textStyle={[styles.tapText, { color: textColor }]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  textContainer: {
    alignItems: 'flex-start',
    gap: -16,
    width: '100%',
  },
  rotatingContainer: {
    width: '100%',
  },
  text: {
    fontFamily: 'Phudu-SemiBold',
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  footer: {
    padding: 42,
    paddingBottom: 60,
    alignItems: 'center',
  },
  tapText: {
    fontFamily: 'Phudu-Regular',
    fontWeight: '400',
    opacity: 0.6,
  },
});
