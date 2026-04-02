import { Platform, StyleSheet, type TextStyle } from 'react-native';
import { useTheme as useBloomThemeHook, type ThemeColors as BloomThemeColors } from '@oxyhq/bloom';
import { fontFamilies } from './fonts';

/**
 * ThemeColors used by services style files.
 * Maps to bloom's ThemeColors, with a few convenience aliases.
 */
export interface ThemeColors {
  text: string;
  background: string;
  inputBackground: string;
  placeholder: string;
  primary: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  secondaryText: string;
}

export interface Theme {
  colors: ThemeColors;
  fonts: {
    title: TextStyle;
    body: TextStyle;
    button: TextStyle;
    label: TextStyle;
  };
}

/**
 * Adapts bloom's ThemeColors into the services ThemeColors shape.
 */
function bloomColorsToThemeColors(bloomColors: BloomThemeColors): ThemeColors {
  return {
    text: bloomColors.text,
    background: bloomColors.background,
    inputBackground: bloomColors.backgroundSecondary,
    placeholder: bloomColors.textTertiary,
    primary: bloomColors.primary,
    border: bloomColors.border,
    error: bloomColors.error,
    success: bloomColors.success,
    warning: bloomColors.warning,
    secondaryText: bloomColors.textSecondary,
  };
}

/** Fallback colors when bloom context is not available */
const fallbackLight: ThemeColors = {
  text: '#000000',
  background: '#FFFFFF',
  inputBackground: '#F5F5F5',
  placeholder: '#999999',
  primary: '#d169e5',
  border: '#E0E0E0',
  error: '#D32F2F',
  success: '#2E7D32',
  warning: '#F57C00',
  secondaryText: '#666666',
};

const fallbackDark: ThemeColors = {
  text: '#FFFFFF',
  background: '#000000',
  inputBackground: '#333333',
  placeholder: '#AAAAAA',
  primary: '#d169e5',
  border: '#444444',
  error: '#EF5350',
  success: '#81C784',
  warning: '#FFB74D',
  secondaryText: '#BBBBBB',
};

const createTheme = (isDark: boolean, colors?: ThemeColors): Theme => {
  const themeColors = colors ?? (isDark ? fallbackDark : fallbackLight);

  return {
    colors: themeColors,
    fonts: {
      title: {
        fontFamily: fontFamilies.interBold,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 34,
      },
      body: {
        fontSize: 16,
        lineHeight: 24,
      },
      button: {
        fontFamily: fontFamilies.interSemiBold,
        fontSize: 16,
        fontWeight: '600',
        color: themeColors.background,
      },
      label: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 8,
      },
    }
  };
};

export const getTheme = (theme: 'light' | 'dark'): Theme => {
  return createTheme(theme === 'dark');
};

/**
 * Returns theme colors from bloom when available, with fallback to local colors.
 * Prefer this hook for new code — it reads from bloom's ThemeProvider.
 */
export const useThemeColors = (theme: 'light' | 'dark'): ThemeColors => {
  try {
    const bloomTheme = useBloomThemeHook();
    return bloomColorsToThemeColors(bloomTheme.colors);
  } catch {
    // Bloom provider not available, fall back to local colors
    return getTheme(theme).colors;
  }
};

// Common styles that can be reused across components
export const createCommonStyles = (theme: 'light' | 'dark') => {
  const themeObj = getTheme(theme);
  const { colors } = themeObj;
  
  return StyleSheet.create({
    container: {
      backgroundColor: colors.background,
    },
    scrollContainer: {
      padding: 10,
    },
    input: {
      height: 48,
      borderRadius: 35,
      paddingHorizontal: 16,
      borderWidth: 1,
      fontSize: 16,
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      color: colors.text,
    },
    button: {
      backgroundColor: colors.primary,
      height: 48,
      borderRadius: 35,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 24,
    },
    buttonText: {
      fontFamily: fontFamilies.interSemiBold,
      fontSize: 16,
      fontWeight: '600',
      color: colors.background,
    },
    errorContainer: {
      backgroundColor: `${colors.error}18`,
      padding: 12,
      borderRadius: 35,
      marginBottom: 16,
    },
    errorText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.error,
    },
  });
};
