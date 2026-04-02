import { useMemo } from 'react';
import { useTheme } from '@oxyhq/bloom/theme';
import { Colors } from '../constants/theme';

/**
 * Returns theme colors based on current color scheme.
 * Delegates to bloom's useTheme() and maps to the Colors shape
 * for backward compatibility with existing screens.
 */
export const useThemeColors = () => {
  const theme = useTheme();

  return useMemo(() => {
    const base = Colors[theme.isDark ? 'dark' : 'light'];
    // Merge bloom colors over the local constants so bloom's
    // dynamic colors (from scoped CSS vars) take precedence.
    return {
      ...base,
      background: theme.colors.background,
      text: theme.colors.text,
      border: theme.colors.border,
      tint: theme.colors.primary,
      card: theme.colors.card,
      primary: theme.colors.primary,
    };
  }, [theme]);
};
