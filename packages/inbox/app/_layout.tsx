import { Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider, toast } from '@oxyhq/services';
import { QueryClientProvider } from '@tanstack/react-query';
import { BloomThemeProvider, useTheme } from '@oxyhq/bloom/theme';
import type { ThemeMode } from '@oxyhq/bloom/theme';
import { Provider as PortalProvider, Outlet as PortalOutlet } from '@oxyhq/bloom/portal';

import { queryClient } from '@/hooks/queries/queryClient';
import { ThemeProvider as AppThemeProvider, useThemeContext } from '@/contexts/theme-context';
import { InboxPrefsProvider } from '@/contexts/inbox-prefs-context';
import { LocaleProvider, useTranslation } from '@/lib/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthGate } from '@/components/AuthGate';
import { registerServiceWorker } from '@/utils/registerServiceWorker';
import { onConnectivityChange, flushQueue } from '@/utils/offlineQueue';
import * as SplashScreen from 'expo-splash-screen';

// Hide the native splash immediately on import. `BloomThemeProvider` configures
// the Inter font synchronously via `Text.defaultProps`, and `OxyProvider`'s
// internal `FontLoader` loads custom font weights in the background without
// blocking children (system font is used as fallback). No artificial wait is
// required before unhiding the splash.
SplashScreen.hideAsync().catch(() => {
  // hideAsync rejects if the splash has already been hidden (e.g. during a
  // fast-refresh re-import). The state is idempotent, so swallow this case.
});

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <Head.Provider>
        <AppThemeProvider>
          <InboxPrefsProvider>
            <ThemedRoot />
          </InboxPrefsProvider>
        </AppThemeProvider>
      </Head.Provider>
    </ErrorBoundary>
  );
}

/**
 * Reads the persisted theme preferences from `AppThemeProvider` and threads
 * them into BOTH `BloomThemeProvider` (used by `useNavigationTheme` to build
 * the react-navigation theme) AND `OxyProvider` (which mounts its own inner
 * `BloomThemeProvider` that shadows this one, so the prop must be passed
 * along). Keeping the two trees in sync ensures the entire UI — chrome and
 * content — tracks the user's selection in real time.
 */
function ThemedRoot() {
  const { themePreference, colorPreset } = useThemeContext();
  const themeMode = themePreference as ThemeMode;
  return (
    <BloomThemeProvider mode={themeMode} colorPreset={colorPreset}>
      <RootLayoutContent themeMode={themeMode} colorPreset={colorPreset} />
    </BloomThemeProvider>
  );
}

/**
 * Build the react-navigation theme from Bloom's resolved colors so we don't
 * have to import DarkTheme/DefaultTheme constants from `@react-navigation/*`
 * (expo-router v56 rejects direct react-navigation imports).
 */
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
      fonts: {
        regular: { fontFamily: 'System', fontWeight: '400' as const },
        medium: { fontFamily: 'System', fontWeight: '500' as const },
        bold: { fontFamily: 'System', fontWeight: '700' as const },
        heavy: { fontFamily: 'System', fontWeight: '900' as const },
      },
    }),
    [mode, colors],
  );
}

interface RootLayoutContentProps {
  themeMode: ThemeMode;
  colorPreset: ReturnType<typeof useThemeContext>['colorPreset'];
}

function RootLayoutContent({ themeMode, colorPreset }: RootLayoutContentProps) {
  const navTheme = useNavigationTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <KeyboardProvider>
        {/*
          OxyProvider mounts its own internal BloomThemeProvider that shadows
          any outer one — so we MUST forward themeMode + colorPreset here, or
          the entire UI under OxyProvider falls back to Bloom's default
          `oxy` preset, no matter what the outer BloomThemeProvider sees.

          LocaleProvider sits INSIDE OxyProvider so it can read the signed-in
          user's `language` preference via `useOxy()` and seed the initial
          locale accordingly. Persisted overrides flow through AsyncStorage.
        */}
        <OxyProvider baseURL={API_URL} themeMode={themeMode} colorPreset={colorPreset}>
          <LocaleProvider>
            <SafeAreaProvider>
              <PortalProvider>
                <ThemeProvider value={navTheme}>
                  <RootEffects />
                  <Stack>
                    <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
                    <Stack.Screen name="+not-found" options={{ headerShown: false }} />
                  </Stack>
                  <StatusBar style="auto" />
                  {/*
                    Global, non-dismissible auth gate. Renders ABOVE the entire
                    app tree whenever the user is signed-out (after the initial
                    auth restore completes). Unmounts cleanly the moment auth
                    flips to true, leaving the user wherever they were.
                  */}
                  <AuthGate />
                </ThemeProvider>
                <PortalOutlet />
              </PortalProvider>
            </SafeAreaProvider>
          </LocaleProvider>
        </OxyProvider>
      </KeyboardProvider>
    </QueryClientProvider>
  );
}

/**
 * Renders no UI — runs the web-only side effects (service worker registration,
 * offline-queue flush listener, Bloom Dialog keyframes) inside `LocaleProvider`
 * so that translated toast strings are available when those handlers fire.
 */
function RootEffects() {
  const { t } = useTranslation();

  // Register service worker on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    registerServiceWorker(() => {
      toast.info(t('inbox.toast.newVersionAvailable'));
    });

    // Flush offline queue when connectivity returns
    const unsubscribe = onConnectivityChange((online) => {
      if (online) {
        flushQueue().then((count) => {
          if (count > 0) {
            toast.success(t('inbox.toast.offlineSync', { count }));
          }
        }).catch(() => {
          // Sync failure is non-fatal; queued actions will retry on next
          // connectivity-change event. Surface nothing to the user.
        });
      }
    });

    return unsubscribe;
  }, [t]);

  // Inject Bloom Dialog CSS keyframe animations on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = [
      '@keyframes bloomDialogFadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes bloomDialogFadeOut { from { opacity: 1; } to { opacity: 0; } }',
      '@keyframes bloomDialogZoomFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }',
      '@keyframes bloomDialogZoomFadeOut { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.95); } }',
    ].join('\n');
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  return null;
}
