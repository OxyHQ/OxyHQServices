import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { StaggeredText, type StaggeredTextRef } from '@/components/staggered-text';
import { RotatingTextAnimation } from '@/components/staggered-text/rotating-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';

const rotatingTexts = [
  'a secret place',
  'a hidden corner',
  'the back room',
  'the easter egg',
  'nothing important',
  'a quiet spot',
  'the void',
  'a wink from Oxy',
];

export default function EasterEggScreen() {
  const router = useRouter();
  const colors = useColors();

  const backgroundColor = colors.background;
  const textColor = colors.text;

  // Entrance animation values
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(20);
  const rotatingOpacity = useSharedValue(0);
  const footerOpacity = useSharedValue(0);

  // Refs for staggered text
  const titleRef = useRef<StaggeredTextRef>(null);

  // Animated styles
  const entranceTitleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));

  const entranceRotatingStyle = useAnimatedStyle(() => ({
    opacity: rotatingOpacity.value,
  }));

  const footerStyle = useAnimatedStyle(() => ({
    opacity: footerOpacity.value,
  }));

  // Memoize style objects to prevent recreation on every render
  const containerStyle = useMemo(() => ({ backgroundColor }), [backgroundColor]);
  const textStyleMemo = useMemo(() => [styles.text, { color: textColor }], [textColor]);
  const rotatingTextStyleMemo = useMemo(
    () => ({ ...styles.text, color: textColor }),
    [textColor],
  );
  const hintStyleMemo = useMemo(
    () => [styles.hint, { color: textColor }],
    [textColor],
  );

  // Consolidated entrance animation
  useEffect(() => {
    const t1 = setTimeout(() => {
      titleOpacity.value = withTiming(1, { duration: 600 });
      titleTranslateY.value = withTiming(0, { duration: 600 });
      titleRef.current?.reset();
      setTimeout(() => {
        titleRef.current?.animate();
      }, 200);
    }, 200);

    const t2 = setTimeout(() => {
      rotatingOpacity.value = withTiming(1, { duration: 600 });
    }, 800);

    const t3 = setTimeout(() => {
      footerOpacity.value = withTiming(1, { duration: 600 });
    }, 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, containerStyle]}>
        <View style={styles.content}>
          <View style={styles.textContainer}>
            <Animated.View style={entranceTitleStyle}>
              <StaggeredText
                text="You found it"
                ref={titleRef}
                fontSize={48}
                textStyle={textStyleMemo}
              />
            </Animated.View>

            <Animated.View style={entranceRotatingStyle}>
              <RotatingTextAnimation
                texts={rotatingTexts}
                fontSize={48}
                interval={3000}
                duration={600}
                textStyle={rotatingTextStyleMemo}
                containerStyle={styles.rotatingContainer}
              />
            </Animated.View>
          </View>
        </View>

        <Animated.View style={[styles.footer, footerStyle]}>
          <ThemedText style={hintStyleMemo}>
            Long-press the logo to come back
          </ThemedText>

          <Button variant="primary" onPress={handleBack} style={styles.button}>
            Go Back
          </Button>
        </Animated.View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: '100%',
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
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  footer: {
    padding: 42,
    paddingBottom: 60,
  },
  hint: {
    fontSize: 14,
    opacity: 0.6,
    marginBottom: 20,
  },
  button: {
    width: '100%',
  },
});
