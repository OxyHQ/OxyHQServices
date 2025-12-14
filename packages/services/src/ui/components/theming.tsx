import { useThemeColors, getTheme } from '../styles';
import type { InternalTheme } from './types';

/**
 * Adapter to convert services theming to react-native-paper's InternalTheme format
 */
export const useInternalTheme = (
  themeOverrides?: Partial<InternalTheme> & { dark?: boolean } | 'light' | 'dark'
): InternalTheme => {
  // Handle string theme prop (for compatibility with services theme system)
  let theme: 'light' | 'dark' = 'light';
  if (typeof themeOverrides === 'string') {
    theme = themeOverrides;
  } else if (themeOverrides && typeof themeOverrides === 'object' && themeOverrides.dark) {
    theme = 'dark';
  }

  const colors = useThemeColors(theme);
  const themeObj = getTheme(theme);

  // Create InternalTheme compatible object
  const internalTheme: InternalTheme = {
    version: 3,
    isV3: true,
    dark: theme === 'dark',
    mode: 'adaptive',
    roundness: 4,
    animation: {
      scale: 1,
    },
    colors: {
      primary: colors.primary,
      primaryContainer: colors.primary + '20',
      secondary: colors.secondaryText,
      secondaryContainer: colors.secondaryText + '20',
      tertiary: colors.primary,
      tertiaryContainer: colors.primary + '20',
      surface: colors.background,
      surfaceVariant: colors.inputBackground,
      surfaceDisabled: colors.secondaryText + '40',
      background: colors.background,
      error: colors.error,
      errorContainer: colors.error + '20',
      onPrimary: '#FFFFFF',
      onPrimaryContainer: colors.primary,
      onSecondary: '#FFFFFF',
      onSecondaryContainer: colors.secondaryText,
      onTertiary: '#FFFFFF',
      onTertiaryContainer: colors.primary,
      onSurface: colors.text,
      onSurfaceVariant: colors.secondaryText,
      onSurfaceDisabled: colors.secondaryText + '60',
      onError: '#FFFFFF',
      onErrorContainer: colors.error,
      onBackground: colors.text,
      outline: colors.border,
      outlineVariant: colors.border + '80',
      inverseSurface: theme === 'dark' ? '#FFFFFF' : '#000000',
      inverseOnSurface: theme === 'dark' ? '#000000' : '#FFFFFF',
      inversePrimary: colors.primary,
      shadow: '#000000',
      scrim: '#000000',
      backdrop: '#00000080',
      elevation: {
        level0: 'transparent',
        level1: theme === 'dark' ? '#1E1E1E' : '#F5F5F5',
        level2: theme === 'dark' ? '#2A2A2A' : '#EEEEEE',
        level3: theme === 'dark' ? '#363636' : '#E0E0E0',
        level4: theme === 'dark' ? '#404040' : '#D5D5D5',
        level5: theme === 'dark' ? '#4A4A4A' : '#CCCCCC',
      },
    },
    fonts: {
      displayLarge: themeObj.fonts.title,
      displayMedium: themeObj.fonts.title,
      displaySmall: themeObj.fonts.title,
      headlineLarge: themeObj.fonts.title,
      headlineMedium: themeObj.fonts.title,
      headlineSmall: themeObj.fonts.title,
      titleLarge: themeObj.fonts.title,
      titleMedium: themeObj.fonts.title,
      titleSmall: themeObj.fonts.title,
      labelLarge: themeObj.fonts.label,
      labelMedium: themeObj.fonts.label,
      labelSmall: themeObj.fonts.label,
      bodyLarge: themeObj.fonts.body,
      bodyMedium: themeObj.fonts.body,
      bodySmall: themeObj.fonts.body,
      default: {
        fontFamily: themeObj.fonts.body.fontFamily || undefined,
        fontWeight: themeObj.fonts.body.fontWeight || 'normal',
        letterSpacing: 0,
      },
    },
  };

  // Merge with overrides if provided (only if it's an object, not a string)
  if (themeOverrides && typeof themeOverrides === 'object') {
    return {
      ...internalTheme,
      ...themeOverrides,
      colors: {
        ...internalTheme.colors,
        ...(themeOverrides.colors || {}),
      },
      fonts: {
        ...internalTheme.fonts,
        ...(themeOverrides.fonts || {}),
      },
    } as InternalTheme;
  }

  return internalTheme;
};
