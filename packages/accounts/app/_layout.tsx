import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'react-native-reanimated';
import { configureReanimatedLogger, ReanimatedLogLevel } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Reanimated 4 ships with a strict logger that surfaces `.value` reads during
// render as runtime warnings. Several deeply nested third-party components in
// this app trip it; lowering the level to `warn` (without strict mode) keeps
// real errors visible while silencing the false-positive cascade.
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider, ActingAsBanner } from '@oxyhq/services';
import { BloomThemeProvider, useTheme } from '@oxyhq/bloom/theme';

import { ScrollProvider } from '@/contexts/scroll-context';
import { ThemeModeProvider, useThemeMode } from '@/contexts/theme-mode-context';
import AppSplashScreen from '@/components/AppSplashScreen';
import { AppInitializer } from '@/lib/appInitializer';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { LocaleProvider, useTranslation } from '@/lib/i18n';
import { MinimalErrorFallback } from '@/components/error-fallback';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete
SplashScreen.preventAutoHideAsync();

// Get API URL from environment variable with fallback
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export const unstable_settings = {
  anchor: '(tabs)',
};

interface SplashState {
  initializationComplete: boolean;
  startFade: boolean;
  fadeComplete: boolean;
}

export default function RootLayout() {
  return (
    <ThemeModeProvider>
      <RootLayoutInner />
    </ThemeModeProvider>
  );
}

/**
 * Top-level error boundary. expo-router renders this whenever a render
 * error escapes any nested route, so an unexpected crash falls back to a
 * branded retry screen instead of an opaque white screen. Uses
 * `MinimalErrorFallback` so it works even if the Bloom theme provider
 * itself is the source of the crash.
 */
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <MinimalErrorFallback {...props} />;
}

function RootLayoutInner() {
  const { themeMode } = useThemeMode();

  const [splashState, setSplashState] = useState<SplashState>({
    initializationComplete: false,
    startFade: false,
    fadeComplete: false,
  });

  const handleSplashFadeComplete = useCallback(() => {
    setSplashState((prev) => ({ ...prev, fadeComplete: true }));
  }, []);

  const initializeApp = useCallback(async () => {
    const result = await AppInitializer.initializeApp(true);
    // Always mark complete (even on error) to unblock the app
    setSplashState((prev) => ({ ...prev, initializationComplete: true }));
    return result;
  }, []);

  // Derive splash progression from state
  const startFade = splashState.initializationComplete;
  const appIsReady = splashState.initializationComplete && splashState.fadeComplete;

  // Fire-and-forget initializer once per mount. A ref guard is required for
  // React 19 Strict Mode, which intentionally double-invokes effects in
  // development to surface side-effect bugs.
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    initializeApp();
  }, [initializeApp]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        {/* OxyProvider does NOT wrap a BloomThemeProvider — by design, to
            avoid duplicate contexts when an app already ships its own (see
            packages/services/src/ui/components/OxyProvider.tsx). The consumer
            (this app) owns the BloomThemeProvider and feeds it the resolved
            theme mode from ThemeModeProvider. */}
        <BloomThemeProvider mode={themeMode}>
          <OxyProvider baseURL={API_URL}>
            <LocaleProvider>
              <AppHead />
              {!appIsReady ? (
                <AppSplashScreen
                  startFade={startFade}
                  onFadeComplete={handleSplashFadeComplete}
                />
              ) : (
                <AppStackContent />
              )}
            </LocaleProvider>
          </OxyProvider>
        </BloomThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/** Document head with translated title/description. Lives inside <LocaleProvider>. */
function AppHead() {
  const { t } = useTranslation();
  return (
    <Head>
      <title>{t('head.title')}</title>
      <meta name="description" content={t('head.description')} />
    </Head>
  );
}

/** Build the react-navigation theme from Bloom's resolved colors. */
function useNavigationTheme() {
  const { mode, colors } = useTheme();
  return useMemo(
    () => ({
      dark: mode === 'dark',
      colors: {
        primary: colors.primary,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        notification: colors.error,
      },
      // `fonts` is required by the navigation theme type but every screen in
      // this stack opts out of the native header (`headerShown: false`), so
      // the values are never rendered. We delegate to React Navigation's
      // built-in defaults rather than declaring our own — Bloom owns the
      // app-wide typography via `Text.defaultProps`, not the nav theme.
      fonts: DefaultTheme.fonts,
    }),
    [mode, colors],
  );
}

/** Renders the navigation stack once the app is ready. */
function AppStackContent() {
  // Must be called inside OxyProvider (which wraps BloomThemeProvider)
  const navTheme = useNavigationTheme();
  const { needsAuth } = useOnboardingStatus();

  return (
    <SafeAreaProvider>
      <ScrollProvider>
        <ThemeProvider value={navTheme}>
          <ActingAsBanner />
          <Stack>
            {/*
              Bidirectional onboarding guard.

              `needsAuth` is true when the user has no identity OR an identity
              but no username yet (e.g. they completed `register()` but skipped
              the username step). We must:
                - Redirect AWAY from `(tabs)` when onboarding is incomplete,
                  otherwise the user lands on the home tab as "@unknown" and
                  every account row shows "Unknown User".
                - Redirect AWAY from `(auth)` when onboarding is complete.

              Expo Router resolves redirects to the first non-redirecting
              sibling, so exactly one is true at any time. `needsAuth` is
              PLATFORM-AGNOSTIC by design: an earlier web-only clamp to `false`
              parked unauthenticated web visitors on `(tabs)`, whose own guard
              bounced them back to `(auth)`, deadlocking on a blank screen.

              The native/web split lives INSIDE the `(auth)` group instead: the
              native `(auth)/index.tsx` shows the create-identity welcome, while
              the web `(auth)/index.web.tsx` routes to a SIGN-IN screen (web is
              a management surface for an account created on native — identity
              creation is forbidden in the browser). So for an unauthenticated
              web visitor, `needsAuth` is true → `(auth)` renders → sign-in. No
              loop, no blank screen.
            */}
            <Stack.Screen name="(tabs)" redirect={needsAuth} options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" redirect={!needsAuth} options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ScrollProvider>
    </SafeAreaProvider>
  );
}
