import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { OxyProvider } from '@oxyhq/services';
import { BloomThemeProvider, useNavigationTheme } from '@oxyhq/bloom/theme';

import { ScrollProvider } from '@/contexts/scroll-context';
import { ThemeModeProvider, useThemeMode } from '@/contexts/theme-mode-context';
import AppSplashScreen from '@/components/AppSplashScreen';
import { AppInitializer } from '@/lib/appInitializer';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { LocaleProvider, useTranslation } from '@/lib/i18n';
import { MinimalErrorFallback } from '@/components/error-fallback';
import { OXY_CLIENT_ID } from '@/constants/oxy';
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
    const result = await AppInitializer.initializeApp();
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
          <OxyProvider baseURL={API_URL} clientId={OXY_CLIENT_ID}>
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

/** Renders the navigation stack once the app is ready. */
function AppStackContent() {
  // Must be called inside OxyProvider (which wraps BloomThemeProvider)
  const navTheme = useNavigationTheme();
  const { needsAuth } = useOnboardingStatus();

  return (
    <SafeAreaProvider>
      <ScrollProvider>
        <ThemeProvider value={navTheme}>
          <Stack>
            {/*
              Bidirectional onboarding guard.

              Commons legitimately OWNS the `hasIdentity` gate — it is the
              key vault. `needsAuth` is true when this device has no local
              identity yet OR has one but no username/session. We must:
                - Redirect AWAY from `(tabs)` (the post-auth tab shell) when
                  onboarding is incomplete.
                - Redirect AWAY from `(auth)` when onboarding is complete.

              Expo Router resolves redirects to the first non-redirecting
              sibling, so exactly one is true at any time. Commons is a
              NATIVE-ONLY app (iOS/Android — see `platforms` in app.json):
              `(auth)/index.tsx` is the create-identity welcome (Hello Human)
              and there is no web build, because the key vault never leaves the
              device.
            */}
            <Stack.Screen name="(tabs)" redirect={needsAuth} options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" redirect={!needsAuth} options={{ headerShown: false }} />
            {/*
              The QR scanner is an ACTION, not a tab. It lives at the root as a
              full-screen presented modal (pushed from the ID landing FAB via
              `router.push('/(scan)')`) so the CameraView covers the tab bar.
              Declared LAST and guarded by the same `needsAuth` redirect as
              `(tabs)`: only an authenticated user can open it, and an
              unauthenticated `oxycommons://approve` / `oxycommons://attest`
              deep link (which resolve to `(scan)/approve` / `(scan)/attest`) is
              bounced to onboarding. Route groups are URL-transparent, so the
              `/approve` and `/attest` deep-link paths are unchanged by this move.
            */}
            <Stack.Screen
              name="(scan)"
              redirect={needsAuth}
              options={{ headerShown: false, presentation: 'fullScreenModal' }}
            />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </ScrollProvider>
    </SafeAreaProvider>
  );
}
