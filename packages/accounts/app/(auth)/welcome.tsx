import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Checkbox } from 'expo-checkbox';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StaggeredText, type StaggeredTextRef } from '@/components/staggered-text';
import { RotatingTextAnimation } from '@/components/staggered-text/rotating-text';
import { Button } from '@/components/ui';
import { Colors } from '@/constants/theme';

const rotatingTexts = [
  'human ID',
  'digital identity',
  'privacy-first account',
  'secure identity',
  'gateway to ethical apps',
  'foundation for digital trust',
  'account for the Oxy ecosystem',
  'key to human-first technology',
  'passport to a fair digital world',
  'identity without passwords',
  'trust layer for modern apps',
  'connection to a human network',
  'access to ethical technology',
  'ownership over your data',
  'unique identity for many apps',
];



export default function WelcomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';

  // Memoize color values
  const backgroundColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.background : Colors.light.background),
    [colorScheme]
  );
  const textColor = useMemo(
    () => (colorScheme === 'dark' ? Colors.dark.text : Colors.light.text),
    [colorScheme]
  );

  const [termsAccepted, setTermsAccepted] = useState(false);

  // Entrance animation values
  const oxyOpacity = useSharedValue(0);
  const oxyTranslateY = useSharedValue(20);
  const rotatingOpacity = useSharedValue(0);
  const footerOpacity = useSharedValue(0);

  // Refs for staggered text
  const oxyRef = useRef<StaggeredTextRef>(null);

  // Animated styles
  const entranceOxyStyle = useAnimatedStyle(() => ({
    opacity: oxyOpacity.value,
    transform: [{ translateY: oxyTranslateY.value }],
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
  const rotatingTextStyleMemo = useMemo(() => ({ ...styles.text, color: textColor }), [textColor]);
  const checkboxTextStyleMemo = useMemo(() => [styles.checkboxText, { color: textColor }], [textColor]);

  // Consolidated entrance animation
  useEffect(() => {
    // Start Oxy animation after 200ms
    const t1 = setTimeout(() => {
      oxyOpacity.value = withTiming(1, { duration: 600 });
      oxyTranslateY.value = withTiming(0, { duration: 600 });
      oxyRef.current?.reset();
      // Start staggered text animation after reset
      setTimeout(() => {
        oxyRef.current?.animate();
      }, 200);
    }, 200);

    // Start rotating animation after 800ms
    const t2 = setTimeout(() => {
      rotatingOpacity.value = withTiming(1, { duration: 600 });
    }, 800);

    // Start footer animation after 1500ms
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

  const handleContinue = useCallback(() => {
    if (termsAccepted) {
      router.replace('/(auth)/create-identity');
    }
  }, [termsAccepted, router]);

  const handleDecline = useCallback(() => {
    router.back();
  }, [router]);

  const toggleTermsAccepted = useCallback(() => {
    setTermsAccepted(prev => !prev);
  }, []);

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={styles.content}>
        <View style={styles.textContainer}>
          {/* "Oxy is your" text */}
          <Animated.View style={entranceOxyStyle}>
            <StaggeredText
              text="Oxy is your"
              ref={oxyRef}
              fontSize={38}
              textStyle={textStyleMemo}
            />
          </Animated.View>

          {/* Rotating text with drum effect */}
          <Animated.View style={entranceRotatingStyle}>
            <RotatingTextAnimation
              texts={rotatingTexts}
              fontSize={38}
              interval={3000}
              duration={600}
              textStyle={rotatingTextStyleMemo}
              containerStyle={styles.rotatingContainer}
            />
          </Animated.View>
        </View>
      </View>

      {/* Footer */}
      <Animated.View style={[styles.footer, footerStyle]}>
        <View style={styles.checkboxContainer}>
          <Checkbox
            value={termsAccepted}
            onValueChange={setTermsAccepted}
            style={styles.checkbox}
            color={textColor}
          />
          <TouchableOpacity
            style={styles.checkboxTextContainer}
            onPress={toggleTermsAccepted}
            activeOpacity={0.7}
          >
            <Text style={checkboxTextStyleMemo}>
              I agree with Oxy User Terms And Conditions and acknowledge the Privacy notice
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            variant="secondary"
            onPress={handleDecline}
            style={styles.button}
          >
            Decline
          </Button>

          <Button
            variant="primary"
            onPress={handleContinue}
            disabled={!termsAccepted}
            style={styles.button}
          >
            Accept
          </Button>
        </View>
      </Animated.View>
    </View>
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
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 32,
  },
  checkbox: {
    width: 24,
    height: 24,
    marginRight: 12,
    marginTop: 2,
  },
  checkboxTextContainer: {
    flex: 1,
  },
  checkboxText: {
    fontSize: 14,
    lineHeight: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
  },
});
