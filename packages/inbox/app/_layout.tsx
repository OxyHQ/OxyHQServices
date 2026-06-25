import { Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { OxyProvider, useOxy } from '@oxyhq/services';
import { toast } from '@oxyhq/bloom';
import { ImageResolverProvider } from '@oxyhq/bloom/image-resolver';
import type { ImageResolver } from '@oxyhq/bloom/image-resolver';
import { QueryClientProvider } from '@tanstack/react-query';
import { BloomThemeProvider, useNavigationTheme } from '@oxyhq/bloom/theme';
import type { ThemeMode } from '@oxyhq/bloom/theme';
import { Provider as PortalProvider, Outlet as PortalOutlet } from '@oxyhq/bloom/portal';

import { queryClient } from '@/hooks/queries/queryClient';
import { ThemeProvider as AppThemeProvider, useThemeContext } from '@/contexts/theme-context';
import { InboxPrefsProvider } from '@/contexts/inbox-prefs-context';
import { LocaleProvider, useTranslation } from '@/lib/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthGate } from '@/components/AuthGate';
import { useInboxSocket } from '@/hooks/useInboxSocket';
import { useEmailStore } from '@/hooks/useEmail';
import { registerServiceWorker } from '@/utils/registerServiceWorker';
import { onConnectivityChange, flushQueue } from '@/utils/offlineQueue';
import { OXY_CLIENT_ID } from '@/constants/oxy';
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
 * Reads the persisted theme preferences from `AppThemeProvider` and feeds
 * them into `BloomThemeProvider`, which owns the react-navigation theme
 * (via `useNavigationTheme`) AND the resolved colors consumed throughout
 * the tree. `OxyProvider` does NOT mount its own `BloomThemeProvider`
 * (see `packages/services/src/ui/components/OxyProvider.tsx`), so this is
 * the single source of truth.
 */
function ThemedRoot() {
  const { themePreference, colorPreset } = useThemeContext();
  const themeMode = themePreference as ThemeMode;
  return (
    <BloomThemeProvider mode={themeMode} colorPreset={colorPreset}>
      <RootLayoutContent />
    </BloomThemeProvider>
  );
}

function RootLayoutContent() {
  const navTheme = useNavigationTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <KeyboardProvider>
        {/*
          LocaleProvider sits INSIDE OxyProvider so it can read the signed-in
          user's `language` preference via `useOxy()` and seed the initial
          locale accordingly. Persisted overrides flow through AsyncStorage.
        */}
        <OxyProvider baseURL={API_URL} clientId={OXY_CLIENT_ID}>
          <BloomImageResolver>
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
          </BloomImageResolver>
        </OxyProvider>
      </KeyboardProvider>
    </QueryClientProvider>
  );
}

/**
 * Registers the single Bloom `ImageResolver` for the app. Bloom `Avatar`s
 * (and any other Bloom media surface) that receive a bare Oxy file ID in
 * `source` resolve it through `oxyServices.getFileDownloadUrl(id, variant)` —
 * the one chokepoint where the canonical `cloud.oxy.so`/signed URL is built.
 * Lives inside `OxyProvider` so `useOxy()` is available.
 */
function BloomImageResolver({ children }: { children: ReactNode }) {
  const { oxyServices } = useOxy();
  const resolve = useCallback<ImageResolver>(
    (id, variant) => oxyServices.getFileDownloadUrl(id, variant),
    [oxyServices],
  );
  return <ImageResolverProvider value={resolve}>{children}</ImageResolverProvider>;
}

/**
 * Renders no UI — runs the web-only side effects (service worker registration,
 * offline-queue flush listener, Bloom Dialog keyframes) inside `LocaleProvider`
 * so that translated toast strings are available when those handlers fire.
 */
function RootEffects() {
  const { t } = useTranslation();
  const { user } = useOxy();
  const userId = user?.id ?? null;
  const previousUserIdRef = useRef<string | null>(null);

  // Private email query data is scoped by user id, and cache/UI state is also
  // cleared whenever the authenticated Oxy identity changes so a shared app
  // instance cannot show the prior user's cached mail during account switches.
  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    if (previousUserId !== userId) {
      queryClient.clear();
      useEmailStore.getState().resetAccountScopedState();
      previousUserIdRef.current = userId;
    }
  }, [userId]);

  // Real-time inbox updates. The hook is a no-op until a user is signed in
  // and tears the socket down on sign-out or user switch; cache/state
  // invalidation above prevents cross-user inbox data reuse.
  useInboxSocket({ baseURL: API_URL });

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
