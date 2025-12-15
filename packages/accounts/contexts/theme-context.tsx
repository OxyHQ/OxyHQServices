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

const THEME_STORAGE_KEY = 'oxy_theme_preference';

// Get system theme synchronously on web (to prevent flash)
const getSystemThemeSync = (): ResolvedTheme => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      // Check if user prefers dark mode via CSS media query
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (error) {
      // Fallback if matchMedia is not available
    }
  }
  return 'light';
};

// Load theme synchronously for web (to prevent flash)
const loadThemeSync = (): ThemePreference => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored as ThemePreference;
      }
    } catch (error) {
      console.error('Error loading theme from localStorage:', error);
    }
  }
  return 'system';
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useRNColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemeSync());
  const [isLoaded, setIsLoaded] = useState(Platform.OS === 'web');
  
  // For web, use synchronous detection initially, then sync with systemColorScheme
  // For native, use systemColorScheme directly
  const [webSystemTheme, setWebSystemTheme] = useState<ResolvedTheme>(() => 
    Platform.OS === 'web' ? getSystemThemeSync() : 'light'
  );
  
  // Update web system theme when React Native's useColorScheme updates (after hydration)
  useEffect(() => {
    if (Platform.OS === 'web' && systemColorScheme) {
      setWebSystemTheme(systemColorScheme);
    }
  }, [systemColorScheme]);
  
  // Get system theme - use state for web (initialized synchronously), useColorScheme for native
  const systemTheme: ResolvedTheme = Platform.OS === 'web' 
    ? webSystemTheme
    : (systemColorScheme ?? 'light');

  // Resolve the actual theme to use
  const resolvedTheme: ResolvedTheme = 
    themePreference === 'system' 
      ? systemTheme
      : themePreference;

  // Load theme preference on mount (for native) and listen to system theme changes (for web)
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Already loaded synchronously
      setIsLoaded(true);
      
      // Listen to system theme changes on web
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
          // Update system theme state when system preference changes
          const isDark = e.matches || (e as MediaQueryList).matches;
          setWebSystemTheme(isDark ? 'dark' : 'light');
        };
        
        // Set initial value
        handleChange(mediaQuery);
        
        // Modern browsers
        if (mediaQuery.addEventListener) {
          mediaQuery.addEventListener('change', handleChange);
          return () => mediaQuery.removeEventListener('change', handleChange);
        } 
        // Legacy browsers
        else if (mediaQuery.addListener) {
          mediaQuery.addListener(handleChange);
          return () => mediaQuery.removeListener(handleChange);
        }
      }
      return;
    }

    // For native, load from AsyncStorage
    const loadTheme = async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
          m => m.default
        );
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setThemePreference(stored as ThemePreference);
        }
      } catch (error) {
        console.error('Error loading theme from AsyncStorage:', error);
      } finally {
        setIsLoaded(true);
      }
    };

    loadTheme();
  }, []);

  // Save theme preference when it changes
  useEffect(() => {
    if (!isLoaded) return;

    const saveTheme = async () => {
      try {
        if (Platform.OS === 'web') {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
          }
        } else {
          const AsyncStorage = await import('@react-native-async-storage/async-storage').then(
            m => m.default
          );
          await AsyncStorage.setItem(THEME_STORAGE_KEY, themePreference);
        }
      } catch (error) {
        console.error('Error saving theme preference:', error);
      }
    };

    saveTheme();
  }, [themePreference, isLoaded]);

  const toggleColorScheme = useCallback(() => {
    setThemePreference((current) => {
      // Toggle between light and dark based on the *resolved* theme.
      // If current is system, use the system theme to decide the next value.
      const isDark = current === 'dark' || (current === 'system' && systemTheme === 'dark');
      return isDark ? 'light' : 'dark';
    });
  }, [systemTheme]);

  return (
    <ThemeContext.Provider
      value={{
        themePreference,
        resolvedTheme,
        toggleColorScheme,
        isLoaded,
      }}
    >
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

