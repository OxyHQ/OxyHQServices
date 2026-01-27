import { useContext } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

/**
 * Hook to get the current color scheme (theme).
 * Returns the resolved theme from ThemeContext if available, otherwise falls back to React Native's useColorScheme.
 * 
 * Always calls hooks in the same order to maintain React hook rules.
 */
export function useColorScheme(): 'light' | 'dark' {
  // Always call hooks in the same order - never conditionally
  const rnColorScheme = useRNColorScheme();
  const themeContext = useContext(ThemeContext);
  
  // If ThemeContext is available, use it; otherwise fall back to React Native's color scheme
  if (themeContext?.resolvedTheme) {
    return themeContext.resolvedTheme;
  }
  
  // Fall back to React Native's color scheme detection
  return (rnColorScheme ?? 'light') as 'light' | 'dark';
}

