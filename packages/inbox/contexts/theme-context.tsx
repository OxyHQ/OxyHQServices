/**
 * Theme context that delegates to Bloom's theme system.
 *
 * Provides backward-compatible `useThemeContext()` for existing components
 * while using BloomThemeProvider under the hood. The `toggleColorScheme`
 * and `themePreference` APIs are preserved for the settings UI.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { BloomThemeProvider } from '@oxyhq/bloom/theme';
import type { ThemeMode } from '@oxyhq/bloom/theme';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  toggleColorScheme: () => void;
  setThemePreference: (pref: ThemePreference) => void;
  isLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'inbox_theme_preference';

const getSystemThemeSync = (): ResolvedTheme => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {}
  }
  return 'light';
};

const loadThemeSync = (): ThemePreference => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored as ThemePreference;
      }
    } catch {}
  }
  return 'system';
};

/** Map our ThemePreference to Bloom's ThemeMode */
function toBloomMode(pref: ThemePreference): ThemeMode {
  return pref; // Bloom accepts 'light' | 'dark' | 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemeSync());
  const [isLoaded, setIsLoaded] = useState(Platform.OS === 'web');
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    Platform.OS === 'web' ? getSystemThemeSync() : 'light',
  );

  // Listen for system theme changes on web
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent | MediaQueryList) => {
        setSystemTheme(e.matches ? 'dark' : 'light');
      };
      handler(mq);
      mq.addEventListener?.('change', handler);
      return () => mq.removeEventListener?.('change', handler);
    }

    // Native: load from AsyncStorage
    const loadTheme = async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
          (m) => m.default,
        );
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setThemePreference(stored as ThemePreference);
        }
      } catch {
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  // Persist preference
  useEffect(() => {
    if (!isLoaded) return;
    const save = async () => {
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
    };
    save();
  }, [themePreference, isLoaded]);

  const resolvedTheme: ResolvedTheme =
    themePreference === 'system' ? systemTheme : themePreference;

  const toggleColorScheme = useCallback(() => {
    setThemePreference((current) => {
      const isDark = current === 'dark' || (current === 'system' && systemTheme === 'dark');
      return isDark ? 'light' : 'dark';
    });
  }, [systemTheme]);

  const bloomMode = toBloomMode(themePreference);

  return (
    <ThemeContext.Provider
      value={{ themePreference, resolvedTheme, toggleColorScheme, setThemePreference, isLoaded }}
    >
      <BloomThemeProvider mode={bloomMode} colorPreset="oxy">
        {children}
      </BloomThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}
