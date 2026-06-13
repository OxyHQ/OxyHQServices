import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { Redirect, useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { StaggeredText, type StaggeredTextRef } from '@/components/staggered-text';
import { RotatingTextAnimation } from '@/components/staggered-text/rotating-text';
import { useTranslation } from '@/lib/i18n';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';

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
  const colors = useColors();
  const backgroundColor = colors.background;
  const textColor = colors.text;
  const { t } = useTranslation();
  const { status, hasIdentity } = useOnboardingStatus();

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
    const innerHello: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const innerTap: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    // "Hello" appears first
    const t1 = setTimeout(() => {
      helloOpacity.value = withTiming(1, { duration: 600 });
      helloTranslateY.value = withTiming(0, { duration: 600 });
      helloRef.current?.reset();
      innerHello.current = setTimeout(() => helloRef.current?.animate(), 200);
    }, 200);

    // Human text appears
    const t2 = setTimeout(() => {
      humanOpacity.value = withTiming(1, { duration: 600 });
    }, 800);

    // Footer appears
    const t3 = setTimeout(() => {
      footerOpacity.value = withTiming(1, { duration: 600 });
      tapToContinueRef.current?.reset();
      innerTap.current = setTimeout(() => tapToContinueRef.current?.animate(), 200);
    }, 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      if (innerHello.current) clearTimeout(innerHello.current);
      if (innerTap.current) clearTimeout(innerTap.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = useCallback(() => {
    router.push('./welcome');
  }, [router]);

  // CRITICAL: when an identity already exists on this device but the user
  // has no active session (e.g., they closed and re-opened the app), we
  // MUST NOT show the marketing "Hello / Human / Tap to continue" splash
  // — that screen looks identical to a fresh install and leads users to
  // believe their account is lost. Redirect straight into the create-identity
  // flow, which detects the existing identity, auto-runs syncIdentity(), and
  // routes to the username step or `(tabs)`.
  //
  // This check runs AFTER all hooks above to preserve hook order across
  // renders. We only redirect when status has settled to `'in_progress'`
  // (which implies hasIdentity is true) — never during `'checking'`,
  // because that would race with the identity detection effect.
  //
  // Fully-onboarded users should never land on the marketing splash. But we do
  // NOT redirect to `/(tabs)` from here: the root Stack in `app/_layout.tsx`
  // owns the `(auth)`↔`(tabs)` boundary via `redirect={!needsAuth}` and already
  // performs that group-swap once onboarded. Navigating to `(tabs)` here would
  // create a SECOND navigation authority racing the root swap and can land
  // expo-router on no matching route → blank screen. Render a neutral backdrop
  // and let the root Stack perform the single authoritative swap.
  if (status === 'complete') {
    return <View style={[styles.container, { backgroundColor }]} />;
  }

  // `create-identity` is a route WITHIN the `(auth)` group, so redirecting to it
  // does NOT race the root Stack's cross-group swap — it's safe here.
  if (hasIdentity && status === 'in_progress') {
    return <Redirect href="/(auth)/create-identity" />;
  }

  // While the onboarding status is still resolving on cold start, render a
  // plain backdrop instead of the rotating-text marketing splash. Otherwise
  // returning users see "Hello / Human / Tap to continue" for ~100ms before
  // the Redirect fires above — visually identical to a fresh install and
  // alarming for anyone with an existing identity.
  if (status === 'checking') {
    return <View style={[styles.container, { backgroundColor }]} />;
  }

  return (
    <Pressable
      style={[styles.container, { backgroundColor }]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('auth.indexTapToContinue')}
    >
      <View style={styles.content}>
        <View style={styles.textContainer}>
          {/* "Hello" text with entrance animation */}
          <Animated.View style={entranceHelloStyle}>
            <StaggeredText
              text={t('auth.indexHello')}
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
          text={t('auth.indexTapToContinue')}
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
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  footer: {
    padding: 42,
    paddingBottom: 60,
    alignItems: 'center',
  },
  tapText: {
    fontWeight: '400',
    opacity: 0.6,
  },
});
