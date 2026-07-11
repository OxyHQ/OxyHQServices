import '../global.css';
import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
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
import {
  preventNativeSplashAutoHide,
  useHideNativeSplashWhenReady,
} from '@oxyhq/expo-splash';

// NATIVE ONLY: hold the OS splash so it stays visible until the app has finished
// running init, then hide it once `appIsReady` flips (via
// `useHideNativeSplashWhenReady`). This makes the native OS splash the SINGLE
// splash on native — the Oxy mark (white silhouette) centered on the dark brand
// background with the Oxy symbol pinned to the bottom (configured by
// `@oxyhq/expo-splash` in app.config.js). Commons is NATIVE-ONLY (no web build),
// so the custom `AppSplashScreen` — gated to web only below for structural
// parity with Accounts — is effectively never rendered here; native readiness
// flips from init alone. No-op on web (the shared helper guards
// `Platform.OS === 'web'`).
preventNativeSplashAutoHide();

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

  // Derive the web splash fade trigger from state. `startFade` is fully derived
  // from initialization completing — there is no other trigger. (Commons is
  // native-only, so this drives no visible splash; kept for parity with
  // Accounts.)
  const startFade = splashState.initializationComplete;

  const [appIsReady, setAppIsReady] = useState(false);

  // Readiness gate.
  // - WEB keeps the fade-gated flow: the custom <AppSplashScreen> renders, fades
  //   out when init completes, and its `onFadeComplete` sets `fadeComplete`, so
  //   web readiness = init complete AND the custom splash finished fading.
  // - NATIVE renders NO custom splash (the held OS splash covers the screen), so
  //   `onFadeComplete` never fires; native readiness = init complete ONLY, else
  //   the OS splash would hang forever. Commons is native-only, so this is the
  //   path that always runs.
  useEffect(() => {
    if (appIsReady) return;
    const ready =
      Platform.OS === 'web'
        ? splashState.initializationComplete && splashState.fadeComplete
        : splashState.initializationComplete;
    if (ready) {
      setAppIsReady(true);
    }
  }, [splashState.initializationComplete, splashState.fadeComplete, appIsReady]);

  // NATIVE ONLY: once ready, hide the held OS splash. The shared helper is a
  // no-op on web (the OS splash was never held; the custom overlay handles the
  // transition there).
  useHideNativeSplashWhenReady(appIsReady);

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
                // WEB: the custom splash covers init and fades out; its
                // `onFadeComplete` gates `appIsReady`. NATIVE renders null here
                // — the held OS splash is on top. Commons is native-only, so
                // this branch renders null in practice; kept gated for parity
                // with Accounts.
                Platform.OS === 'web' ? (
                  <AppSplashScreen
                    startFade={startFade}
                    onFadeComplete={handleSplashFadeComplete}
                  />
                ) : null
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
