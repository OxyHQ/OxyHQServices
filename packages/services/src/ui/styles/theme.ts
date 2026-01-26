import { Platform, StyleSheet, type TextStyle } from 'react-native';
import { fontFamilies } from './fonts';

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

const lightColors: ThemeColors = {
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

const darkColors: ThemeColors = {
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

const createTheme = (isDark: boolean): Theme => {
  const colors = isDark ? darkColors : lightColors;
  
  return {
    colors,
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
        color: '#FFFFFF',
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

export const useThemeColors = (theme: 'light' | 'dark'): ThemeColors => {
  return getTheme(theme).colors;
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
      color: '#FFFFFF',
    },
    errorContainer: {
      backgroundColor: '#FFEBEE',
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
