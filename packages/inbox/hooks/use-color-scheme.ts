/**
 * Returns the resolved color scheme ('light' | 'dark').
 *
 * Delegates to Bloom's theme system via the ThemeContext bridge.
 * Backward-compatible: components using `const colorScheme = useColorScheme()`
 * continue to work unchanged.
 */

import { useTheme } from '@oxyhq/bloom/theme';

export function useColorScheme(): 'light' | 'dark' {
  const { mode } = useTheme();
  return mode;
}
