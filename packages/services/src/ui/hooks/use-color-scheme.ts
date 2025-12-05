import { useThemeContext } from '../context/ThemeContext';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * Hook to get the current color scheme (theme).
 * Returns the resolved theme from ThemeContext if available, otherwise falls back to React Native's useColorScheme.
 */
export function useColorScheme(): 'light' | 'dark' {
  try {
    const { resolvedTheme } = useThemeContext();
    return resolvedTheme;
  } catch (error) {
    // ThemeProvider not available, fall back to React Native's color scheme detection
    const rnColorScheme = useRNColorScheme();
    return (rnColorScheme ?? 'light') as 'light' | 'dark';
  }
}

