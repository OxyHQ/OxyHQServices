/**
 * Theme utility functions
 */

/**
 * Normalizes a theme value to ensure it's always 'light' | 'dark'
 * @param theme - Theme value (may be 'light' | 'dark' | string | undefined)
 * @returns Normalized 'light' | 'dark' theme (defaults to 'light')
 */
export const normalizeTheme = (theme?: string | null): 'light' | 'dark' => 
    theme === 'light' || theme === 'dark' ? theme : 'light';

/**
 * Normalizes a color scheme value to ensure it's always 'light' or 'dark'
 * Handles null/undefined cases with proper fallback chain
 * 
 * @param colorScheme - The color scheme from useColorScheme() hook (may be null/undefined)
 * @param theme - Optional theme prop as fallback
 * @returns Normalized 'light' | 'dark' color scheme
 * 
 * @example
 * ```ts
 * const colorScheme = normalizeColorScheme(useColorScheme(), theme);
 * ```
 */
export const normalizeColorScheme = (
    colorScheme?: string | null,
    theme?: string
): 'light' | 'dark' => {
    // First try the colorScheme from hook
    if (colorScheme === 'light' || colorScheme === 'dark') {
        return colorScheme;
    }
    
    // Fallback to theme prop
    if (theme === 'light' || theme === 'dark') {
        return theme;
    }
    
    // Default to light
    return 'light';
};

