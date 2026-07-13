import '../global.css';
import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
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
import { OxyProvider, useOxy } from '@oxyhq/services';
import { BloomThemeProvider, useNavigationTheme } from '@oxyhq/bloom/theme';

import { ScrollProvider } from '@/contexts/scroll-context';
import { ThemeModeProvider, useThemeMode } from '@/contexts/theme-mode-context';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { LocaleProvider, useTranslation } from '@/lib/i18n';
import { MinimalErrorFallback } from '@/components/error-fallback';
import { OXY_CLIENT_ID } from '@/constants/oxy';
import {
  preventNativeSplashAutoHide,
  useHideNativeSplashWhenReady,
} from '@oxyhq/expo-splash';

// NATIVE ONLY: hold the OS splash so the Oxy mark (white silhouette centered on
// the dark brand background, Oxy symbol pinned to the bottom — configured by
// `@oxyhq/expo-splash` in app.config.js) stays visible until the app can paint
// its FIRST real screen. Commons is NATIVE-ONLY (no web build), so the branded
// native OS splash is the single splash. We hold it here and hide it from
// `AppStackContent` (below) once the app is genuinely ready — see the note there
// on why readiness is computed inside the providers, not on frame 1. No-op on
// web (the shared helper guards `Platform.OS === 'web'`).
preventNativeSplashAutoHide();

// Get API URL from environment variable with fallback
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

// Safety net: never let a stalled readiness signal hold the OS splash forever.
// If storage hydration / cold boot haven't settled within this window, reveal
// the app anyway rather than trapping the user behind the splash.
const SPLASH_FALLBACK_MS = 4000;

export const unstable_settings = {
  anchor: '(tabs)',
};

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

  // `AppStackContent` is rendered UNCONDITIONALLY — the held native OS splash
  // covers the RN view until `AppStackContent` hides it once the app is ready.
  // This avoids an intermediate boot shell (which flashed white on the dark
  // brand background) and the blank frame that appeared when the splash dropped
  // before fonts + the query cache were ready.
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
              <AppStackContent />
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

/**
 * Renders the navigation stack and drives the native OS splash hand-off.
 *
 * Readiness is computed HERE, inside the providers, not on frame 1 of
 * `RootLayoutInner`. This component lives UNDER `<BloomThemeProvider>`, whose
 * Bloom `FontLoader` gates its subtree — so by the time `AppStackContent`
 * mounts at all, fonts are already loaded. The only remaining readiness signals
 * are:
 *   - `isStorageReady`: the SDK's persisted query cache has hydrated, so the
 *     first paint serves cached data instead of an empty `#ffffff` boot shell.
 *   - `status !== 'checking'`: the device-first cold boot has settled the
 *     onboarding decision, so the Stack renders the correct group on the FIRST
 *     frame (no `(auth)` ↔ `(tabs)` flash).
 *
 * We hold the branded OS splash (see `preventNativeSplashAutoHide` at module
 * scope) until BOTH resolve, so the transition is: OS splash → first real
 * screen, with no blank frame and no white flash.
 */
function AppStackContent() {
  // Must be called inside OxyProvider (which wraps BloomThemeProvider)
  const navTheme = useNavigationTheme();
  const { isStorageReady } = useOxy();
  const { status, needsAuth } = useOnboardingStatus();

  const appReady = isStorageReady && status !== 'checking';

  // Bounded fallback so a stalled `isStorageReady`/`status` signal can never
  // hang the OS splash forever. Cleaned up on unmount.
  const [fallbackElapsed, setFallbackElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFallbackElapsed(true), SPLASH_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  useHideNativeSplashWhenReady(appReady || fallbackElapsed);

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
