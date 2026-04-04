import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { ThemeMode } from '@oxyhq/bloom/theme';

interface ThemeModeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

const STORAGE_KEY = 'oxy_theme_preference';

function loadPersistedMode(): ThemeMode {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  }
  return 'system';
}

function persistMode(mode: ThemeMode) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, mode);
    return;
  }
  // Native: async persist
  import('@react-native-async-storage/async-storage')
    .then((m) => m.default.setItem(STORAGE_KEY, mode))
    .catch(() => {});
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(loadPersistedMode);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    persistMode(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((current) => {
      // If system, check what the system resolves to and go opposite
      if (current === 'system') {
        const isDark =
          Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
            : false;
        const next = isDark ? 'light' : 'dark';
        persistMode(next);
        return next;
      }
      const next = current === 'dark' ? 'light' : 'dark';
      persistMode(next);
      return next;
    });
  }, []);

  return (
    <ThemeModeContext.Provider value={{ themeMode, setThemeMode, toggleTheme }}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within ThemeModeProvider');
  }
  return ctx;
}
