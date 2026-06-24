import * as Linking from 'expo-linking';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OxyProvider } from '@oxyhq/services';
import { BloomThemeProvider, useNavigationTheme } from '@oxyhq/bloom/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
const AUTH_REDIRECT_URI = Linking.createURL('/');

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    // BloomThemeProvider owns the theme. OxyProvider does NOT mount its own
    // (by design, to avoid duplicate contexts), so this wraps the tree —
    // services UI like OxySignInButton calls bloom's useTheme().
    <SafeAreaProvider>
      <BloomThemeProvider mode="system">
        <OxyProvider baseURL={API_URL} authRedirectUri={AUTH_REDIRECT_URI}>
          <RootNavigator />
        </OxyProvider>
      </BloomThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const navTheme = useNavigationTheme();
  return (
    // expo-router's ThemeProvider is the react-navigation theme — distinct from
    // BloomThemeProvider. It colors the navigator chrome (Stack headers, screen
    // backgrounds, modal). We feed it Bloom's resolved colors so Bloom remains
    // the single source of truth, instead of raw DarkTheme/DefaultTheme.
    <ThemeProvider value={navTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
