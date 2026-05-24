/**
 * Theme preference store.
 *
 * Holds the user's light/dark/system preference AND the active Bloom
 * color preset (e.g. `blue`, `oxy`, `green`...). Both preferences are
 * persisted to localStorage on web and AsyncStorage on native.
 *
 * The actual `BloomThemeProvider` is mounted by `OxyProvider`
 * (`@oxyhq/services`) which shadows any outer Bloom context. Consumers
 * pass these preferences into `OxyProvider` via its `themeMode` and
 * `colorPreset` props so the inbox tracks the user's selection in real
 * time. Components read the resolved theme through `useTheme()` from
 * `@oxyhq/bloom/theme`. The Settings page reads/writes the preferences
 * through `useThemeContext()`.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { APP_COLOR_NAMES } from '@oxyhq/bloom/theme';
import type { AppColorName } from '@oxyhq/bloom/theme';

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
  colorPreset: AppColorName;
  setColorPreset: (preset: AppColorName) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'inbox_theme_preference';
const COLOR_PRESET_STORAGE_KEY = 'inbox_color_preset';
const DEFAULT_COLOR_PRESET: AppColorName = 'blue';

function isAppColorName(value: string): value is AppColorName {
  return (APP_COLOR_NAMES as readonly string[]).includes(value);
}

function loadThemeSync(): ThemePreference {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch (err) {
      // localStorage access can throw in private mode / sandboxed iframes;
      // fall through to the default. No user-visible action required.
      console.warn('[theme-context] failed to read theme preference', err);
    }
  }
  return 'system';
}

function loadColorPresetSync(): AppColorName {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(COLOR_PRESET_STORAGE_KEY);
      if (stored && isAppColorName(stored)) {
        return stored;
      }
    } catch (err) {
      console.warn('[theme-context] failed to read color preset', err);
    }
  }
  return DEFAULT_COLOR_PRESET;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemeSync);
  const [colorPreset, setColorPresetState] = useState<AppColorName>(loadColorPresetSync);
  const [isLoaded, setIsLoaded] = useState(Platform.OS === 'web');

  // Native: load persisted preferences from AsyncStorage
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
          (m) => m.default,
        );
        const [storedMode, storedPreset] = await Promise.all([
          AsyncStorage.getItem(THEME_STORAGE_KEY),
          AsyncStorage.getItem(COLOR_PRESET_STORAGE_KEY),
        ]);
        if (storedMode === 'light' || storedMode === 'dark' || storedMode === 'system') {
          setThemePreference(storedMode);
        }
        if (storedPreset && isAppColorName(storedPreset)) {
          setColorPresetState(storedPreset);
        }
      } catch (err) {
        console.warn('[theme-context] failed to load preferences', err);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // Persist mode preference changes
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
      } catch (err) {
        console.warn('[theme-context] failed to persist theme preference', err);
      }
    })();
  }, [themePreference, isLoaded]);

  // Persist color preset changes
  useEffect(() => {
    if (!isLoaded) return;
    (async () => {
      try {
        if (Platform.OS === 'web') {
          window.localStorage?.setItem(COLOR_PRESET_STORAGE_KEY, colorPreset);
        } else {
          const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
            (m) => m.default,
          );
          await AsyncStorage.setItem(COLOR_PRESET_STORAGE_KEY, colorPreset);
        }
      } catch (err) {
        console.warn('[theme-context] failed to persist color preset', err);
      }
    })();
  }, [colorPreset, isLoaded]);

  const handleSetPreference = useCallback((pref: ThemePreference) => {
    setThemePreference(pref);
  }, []);

  const handleSetColorPreset = useCallback((preset: AppColorName) => {
    setColorPresetState(preset);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        themePreference,
        setThemePreference: handleSetPreference,
        colorPreset,
        setColorPreset: handleSetColorPreset,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/** Read the persisted theme preferences. */
export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}
