/**
 * Theme colors for the inbox app.
 *
 * Provides the `Colors` constant (light/dark palettes) and `useColors()` hook
 * that merges Bloom's dynamic theme colors with inbox-specific domain colors.
 *
 * Components that already use `Colors[colorScheme]` continue to work.
 * New components should prefer `useColors()` for dynamic Bloom integration.
 */

import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';

// ── Inbox-specific domain colors (not in Bloom) ────────────────────

const InboxDomainColors = {
  light: {
    // Gmail-style colors
    primaryContainer: '#D2E3FC',
    unread: '#202124',
    read: '#5F6368',
    starred: '#F4B400',
    // Mailbox sidebar
    sidebarBackground: '#FFFFFF',
    sidebarItemActive: '#D2E3FC',
    sidebarItemActiveText: '#1967D2',
    sidebarText: '#202124',
    // Compose
    composeFab: '#C2E7FF',
    composeFabText: '#001D35',
    composeFabIcon: '#001D35',
    // Search
    searchBackground: '#EAF1FB',
    searchText: '#202124',
    searchPlaceholder: '#5F6368',
    // Avatar
    avatarColors: ['#1A73E8', '#34A853', '#EA4335', '#FBBC04', '#9334E6', '#E8710A'],
    // Semantic
    danger: '#D93025',
    success: '#1E8E3E',
    warning: '#F9AB00',
    // Swipe
    swipeArchive: '#1E8E3E',
    swipeDelete: '#D93025',
    selectedRow: '#E8F0FE',
  },
  dark: {
    primaryContainer: '#004A77',
    unread: '#E8EAED',
    read: '#9AA0A6',
    starred: '#FDD663',
    sidebarBackground: '#1F1F1F',
    sidebarItemActive: '#004A77',
    sidebarItemActiveText: '#8AB4F8',
    sidebarText: '#E8EAED',
    composeFab: '#004A77',
    composeFabText: '#C2E7FF',
    composeFabIcon: '#C2E7FF',
    searchBackground: '#303134',
    searchText: '#E8EAED',
    searchPlaceholder: '#9AA0A6',
    avatarColors: ['#8AB4F8', '#81C995', '#F28B82', '#FDD663', '#C58AF9', '#FCAD70'],
    danger: '#F28B82',
    success: '#81C995',
    warning: '#FDD663',
    swipeArchive: '#81C995',
    swipeDelete: '#F28B82',
    selectedRow: '#1A3A5C',
  },
} as const;

// ── Static Colors constant (backward compat) ───────────────────────
// Components that do `const colors = Colors[colorScheme]` still work.
// These are fallback values; prefer `useColors()` for Bloom-aware colors.

export const Colors = {
  light: {
    text: '#202124',
    background: '#FFFFFF',
    surface: '#F8F9FA',
    surfaceVariant: '#F1F3F4',
    tint: '#1A73E8',
    icon: '#5F6368',
    border: '#DADCE0',
    secondaryText: '#5F6368',
    primary: '#1A73E8',
    error: '#D93025',
    ...InboxDomainColors.light,
  },
  dark: {
    text: '#E8EAED',
    background: '#000000',
    surface: '#1F1F1F',
    surfaceVariant: '#2D2D2D',
    tint: '#8AB4F8',
    icon: '#9AA0A6',
    border: '#3C4043',
    secondaryText: '#9AA0A6',
    primary: '#8AB4F8',
    error: '#F28B82',
    ...InboxDomainColors.dark,
  },
};

// ── useColors() hook (Bloom-aware) ──────────────────────────────────
// Merges Bloom's dynamic theme colors with inbox domain colors.

export function useColors() {
  const { mode, colors: bloom } = useTheme();

  return useMemo(() => {
    const domain = InboxDomainColors[mode];
    return {
      // Map Bloom's semantic tokens to the inbox color keys
      text: bloom.text,
      background: bloom.background,
      surface: bloom.backgroundSecondary,
      surfaceVariant: bloom.backgroundTertiary,
      tint: bloom.primary,
      icon: bloom.icon,
      border: bloom.border,
      secondaryText: bloom.textSecondary,
      primary: bloom.primary,
      error: bloom.error,
      // Inbox-specific domain colors
      ...domain,
    };
  }, [mode, bloom]);
}

// ── Fonts ───────────────────────────────────────────────────────────

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
