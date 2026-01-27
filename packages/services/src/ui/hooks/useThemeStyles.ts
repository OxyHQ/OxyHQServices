import { useMemo } from 'react';
import { useColorScheme } from './useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme } from '../utils/themeUtils';

export interface ThemeStyles {
    textColor: string;
    backgroundColor: string;
    secondaryBackgroundColor: string;
    borderColor: string;
    mutedTextColor: string;
    isDarkTheme: boolean;
    // Common semantic colors used across screens
    primaryColor: string;
    dangerColor: string;
    successColor: string;
    // Normalized color scheme and theme colors
    colorScheme: 'light' | 'dark';
    colors: typeof Colors.light;
}

/**
 * Reusable hook for theme styles
 * Replaces duplicated themeStyles useMemo pattern across multiple screens
 * 
 * Provides consistent theme colors across all service screens:
 * - Base colors (text, background, borders)
 * - Semantic colors (primary, danger, success)
 * - Theme-aware calculations
 * - Normalized color scheme and Colors object
 * 
 * @param theme - Theme string ('light' | 'dark')
 * @param colorSchemeFromHook - Optional color scheme from useColorScheme() hook. If not provided, will call useColorScheme() internally.
 * @returns ThemeStyles object with consistent color values
 * 
 * @example
 * ```tsx
 * const themeStyles = useThemeStyles(theme);
 * <View style={{ backgroundColor: themeStyles.backgroundColor }}>
 *   <Text style={{ color: themeStyles.textColor }}>Hello</Text>
 * </View>
 * ```
 * 
 * @example
 * ```tsx
 * const colorScheme = useColorScheme();
 * const themeStyles = useThemeStyles(theme, colorScheme);
 * const iconColor = themeStyles.colors.iconSecurity;
 * ```
 */
export const useThemeStyles = (
    theme: string,
    colorSchemeFromHook?: string | null
): ThemeStyles => {
    const hookColorScheme = useColorScheme();
    const colorSchemeToUse = colorSchemeFromHook ?? hookColorScheme;
    
    return useMemo(() => {
        const colorScheme = normalizeColorScheme(colorSchemeToUse, theme);
        const isDarkTheme = colorScheme === 'dark';
        const colors = Colors[colorScheme];
        
        return {
            // Base colors
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
            mutedTextColor: '#8E8E93', // Same for both themes
            
            // Semantic colors (consistent across themes)
            primaryColor: '#007AFF',
            dangerColor: '#FF3B30',
            successColor: '#34C759',
            
            // Theme flag
            isDarkTheme,
            
            // Normalized color scheme and theme colors
            colorScheme,
            colors,
        };
    }, [theme, colorSchemeToUse]);
};

