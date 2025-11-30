import { useMemo } from 'react';

export interface ThemeStyles {
    textColor: string;
    backgroundColor: string;
    secondaryBackgroundColor: string;
    borderColor: string;
    mutedTextColor?: string;
    isDarkTheme: boolean;
}

/**
 * Reusable hook for theme styles
 * Replaces duplicated themeStyles useMemo pattern across multiple screens
 * 
 * @param theme - Theme string ('light' | 'dark')
 * @returns ThemeStyles object with consistent color values
 */
export const useThemeStyles = (theme: string): ThemeStyles => {
    return useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
            mutedTextColor: '#8E8E93', // Same for both themes
            isDarkTheme,
        };
    }, [theme]);
};

