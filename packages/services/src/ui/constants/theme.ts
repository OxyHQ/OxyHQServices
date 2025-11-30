/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    card: '#F2F2F7',
    border: '#E5E5EA',
    secondaryText: '#8E8E93',
    avatarBackground: '#0a7ea4',
    avatarText: '#FFFFFF',
    sidebarBackground: '#F8F9FA',
    sidebarItemActiveBackground: '#E8F0FE',
    sidebarItemActiveText: '#1A73E8',
    sidebarIconHome: '#1A73E8',
    sidebarIconPersonalInfo: '#34A853',
    sidebarIconSecurity: '#4285F4',
    sidebarIconPassword: '#4285F4',
    sidebarIconDevices: '#4285F4',
    sidebarIconData: '#9C27B0',
    sidebarIconSharing: '#EA4335',
    sidebarIconFamily: '#EA4335',
    sidebarIconPayments: '#FBBC04',
    sidebarIconStorage: '#FF9800',
  },
  dark: {
    text: '#ECEDEE',
    background: '#000000',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    card: '#1C1C1E',
    border: '#2C2C2E',
    secondaryText: '#8E8E93',
    avatarBackground: '#0a7ea4',
    avatarText: '#FFFFFF',
    sidebarBackground: '#1C1C1E',
    sidebarItemActiveBackground: '#2D2E30',
    sidebarItemActiveText: '#8AB4F8',
    sidebarIconHome: '#8AB4F8',
    sidebarIconPersonalInfo: '#81C995',
    sidebarIconSecurity: '#8AB4F8',
    sidebarIconPassword: '#8AB4F8',
    sidebarIconDevices: '#8AB4F8',
    sidebarIconData: '#CE93D8',
    sidebarIconSharing: '#F28B82',
    sidebarIconFamily: '#F28B82',
    sidebarIconPayments: '#FDD663',
    sidebarIconStorage: '#FFB74D',
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

