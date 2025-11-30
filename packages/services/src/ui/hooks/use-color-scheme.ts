import { useThemeContext } from '../context/ThemeContext';

/**
 * Hook to get the current color scheme (theme).
 * Returns the resolved theme from ThemeContext.
 */
export function useColorScheme() {
  const { resolvedTheme } = useThemeContext();
  return resolvedTheme;
}

