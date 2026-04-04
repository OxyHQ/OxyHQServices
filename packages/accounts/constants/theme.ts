/**
 * Domain-specific colors unique to the accounts app (sidebar icons, banners,
 * identity badges, avatars).  Generic UI tokens (background, text, border, etc.)
 * come from Bloom's ThemeColors via `useColors()`.
 */

import { Platform } from 'react-native';

export const DomainColors = {
  light: {
    // Avatar
    avatarBackground: '#0a7ea4',
    avatarText: '#FFFFFF',
    // Sidebar icon tints
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
    // Banner colors
    bannerWarningBackground: '#FEF3C7',
    bannerWarningBorder: '#FCD34D',
    bannerWarningIcon: '#D97706',
    bannerWarningText: '#92400E',
    bannerWarningSubtext: '#B45309',
    bannerWarningButton: '#D97706',
    bannerInfoBackground: '#E0E7FF',
    bannerInfoBorder: '#C7D2FE',
    bannerInfoIcon: '#4F46E5',
    bannerInfoText: '#312E81',
    bannerInfoSubtext: '#4338CA',
    // Identity icon colors
    identityIconSelfCustody: '#10B981',
    identityIconPublicKey: '#8B5CF6',
  },
  dark: {
    // Avatar
    avatarBackground: '#0a7ea4',
    avatarText: '#FFFFFF',
    // Sidebar icon tints
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
    // Banner colors
    bannerWarningBackground: '#78350F',
    bannerWarningBorder: '#92400E',
    bannerWarningIcon: '#FCD34D',
    bannerWarningText: '#FEF3C7',
    bannerWarningSubtext: '#FDE68A',
    bannerWarningButton: '#F59E0B',
    bannerInfoBackground: '#1E1B4B',
    bannerInfoBorder: '#312E81',
    bannerInfoIcon: '#818CF8',
    bannerInfoText: '#C7D2FE',
    bannerInfoSubtext: '#A5B4FC',
    // Identity icon colors
    identityIconSelfCustody: '#34D399',
    identityIconPublicKey: '#A78BFA',
  },
} as const;

export type DomainColorKey = keyof typeof DomainColors.light;

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
