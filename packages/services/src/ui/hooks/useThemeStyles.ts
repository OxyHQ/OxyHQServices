import { useMemo } from 'react';
import { useTheme } from '@oxyhq/bloom/theme';
import { Colors } from '../constants/theme';

export interface ThemeStyles {
    textColor: string;
    backgroundColor: string;
    secondaryBackgroundColor: string;
    borderColor: string;
    mutedTextColor: string;
    isDarkTheme: boolean;
    primaryColor: string;
    dangerColor: string;
    successColor: string;
    colorScheme: 'light' | 'dark';
    colors: typeof Colors.light;
}

/**
 * Returns theme styles for service screens.
 * Delegates to bloom's useTheme() for all color values.
 * The `theme` param is kept for backward compatibility but ignored —
 * bloom's resolved mode (from BloomThemeProvider) is used instead.
 */
export const useThemeStyles = (
    _theme?: string,
    _colorSchemeFromHook?: string | null
): ThemeStyles => {
    const bloomTheme = useTheme();

    return useMemo(() => {
        const isDarkTheme = bloomTheme.isDark;
        const colorScheme = isDarkTheme ? 'dark' : 'light';
        const colors = Colors[colorScheme];

        return {
            textColor: bloomTheme.colors.text,
            backgroundColor: bloomTheme.colors.background,
            secondaryBackgroundColor: bloomTheme.colors.backgroundSecondary,
            borderColor: bloomTheme.colors.border,
            mutedTextColor: bloomTheme.colors.textSecondary,
            primaryColor: bloomTheme.colors.primary,
            dangerColor: bloomTheme.colors.error,
            successColor: bloomTheme.colors.success,
            isDarkTheme,
            colorScheme,
            colors,
        };
    }, [bloomTheme]);
};
