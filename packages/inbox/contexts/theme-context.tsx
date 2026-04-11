/**
 * Theme preference persistence + BloomThemeProvider wrapper.
 *
 * Manages the user's light/dark/system preference (persisted to
 * localStorage on web, AsyncStorage on native) and wraps children
 * in Bloom's BloomThemeProvider.
 *
 * Components access theme via `useTheme()` from '@oxyhq/bloom/theme'.
 * Only the Settings page needs `useThemeContext()` for preference management.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { BloomThemeProvider } from '@oxyhq/bloom/theme';
import type { ThemeMode } from '@oxyhq/bloom/theme';

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'inbox_theme_preference';

function loadThemeSync(): ThemePreference {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {}
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemeSync);
  const [isLoaded, setIsLoaded] = useState(Platform.OS === 'web');

  // Native: load persisted preference from AsyncStorage
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
          (m) => m.default,
        );
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setThemePreference(stored);
        }
      } catch {
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // Persist preference changes
  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          window.localStorage?.setItem(THEME_STORAGE_KEY, themePreference);
        } else {
          const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
            (m) => m.default,
          );
          await AsyncStorage.setItem(THEME_STORAGE_KEY, themePreference);
        }
      } catch {}
    })();
  }, [themePreference, isLoaded]);

  const handleSetPreference = useCallback((pref: ThemePreference) => {
    setThemePreference(pref);
  }, []);

  return (
    <ThemeContext.Provider value={{ themePreference, setThemePreference: handleSetPreference }}>
      <BloomThemeProvider mode={themePreference as ThemeMode} colorPreset="oxy">
        {children}
      </BloomThemeProvider>
    </ThemeContext.Provider>
  );
}

/** Only needed in Settings for theme preference management. */
export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}
