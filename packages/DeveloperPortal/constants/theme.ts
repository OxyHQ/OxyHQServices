/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * Matched with the OxyHQ Services theme for consistency.
 */

import { Platform } from 'react-native';

// Primary brand color matching services package
const primaryColor = '#d169e5';
const tintColorLight = primaryColor;
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#000000',
    background: '#f2f2f7', // Light gray background like iOS Settings
    tint: tintColorLight,
    icon: '#666666',
    tabIconDefault: '#999999',
    tabIconSelected: tintColorLight,
    border: '#E0E0E0',
    inputBackground: '#F5F5F5',
    placeholder: '#999999',
    secondaryText: '#666666',
    error: '#D32F2F',
    success: '#2E7D32',
    warning: '#F57C00',
    card: '#FFFFFF',
  },
  dark: {
    text: '#FFFFFF',
    background: '#000000', // Pure black for dark mode
    tint: tintColorDark,
    icon: '#BBBBBB',
    tabIconDefault: '#AAAAAA',
    tabIconSelected: tintColorDark,
    border: '#444444',
    inputBackground: '#1C1C1E',
    placeholder: '#AAAAAA',
    secondaryText: '#BBBBBB',
    error: '#EF5350',
    success: '#81C784',
    warning: '#FFB74D',
    card: '#1C1C1E',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
