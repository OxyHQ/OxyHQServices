import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useColorScheme as useRNColorScheme, Platform } from 'react-native';

type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  toggleColorScheme: () => void;
  isLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'inbox_theme_preference';

const getSystemThemeSync = (): ResolvedTheme => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useRNColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemeSync());
  const [isLoaded, setIsLoaded] = useState(Platform.OS === 'web');
  const [webSystemTheme, setWebSystemTheme] = useState<ResolvedTheme>(() =>
    Platform.OS === 'web' ? getSystemThemeSync() : 'light',
  );

  useEffect(() => {
    if (Platform.OS === 'web' && systemColorScheme) {
      setWebSystemTheme(systemColorScheme);
    }
  }, [systemColorScheme]);

  const systemTheme: ResolvedTheme =
    Platform.OS === 'web' ? webSystemTheme : (systemColorScheme ?? 'light');

  const resolvedTheme: ResolvedTheme =
    themePreference === 'system' ? systemTheme : themePreference;

  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsLoaded(true);
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e: MediaQueryListEvent | MediaQueryList) => {
          setWebSystemTheme(e.matches ? 'dark' : 'light');
        };
        handler(mq);
        if (mq.addEventListener) {
          mq.addEventListener('change', handler);
          return () => mq.removeEventListener('change', handler);
        }
      }
      return;
    }

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

  const toggleColorScheme = useCallback(() => {
    setThemePreference((current) => {
      const isDark = current === 'dark' || (current === 'system' && systemTheme === 'dark');
      return isDark ? 'light' : 'dark';
    });
  }, [systemTheme]);

  return (
    <ThemeContext.Provider value={{ themePreference, resolvedTheme, toggleColorScheme, isLoaded }}>
      {children}
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
