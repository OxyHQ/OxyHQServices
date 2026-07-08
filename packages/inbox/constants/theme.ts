/**
 * Theme colors for the inbox app.
 *
 * Provides the `useColors()` hook that merges Bloom's dynamic theme colors
 * (driven by the active `colorPreset` — Oxy purple by default) with a small set
 * of inbox-specific domain tokens for things Bloom doesn't model directly
 * (read/unread row state, starred yellow, swipe action colors, etc.).
 *
 * Brand colors (primary, active states, FABs, search bg) come from Bloom so
 * the inbox automatically follows the user's selected accent.
 */

import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';

// ── Inbox-specific domain tokens (not modeled by Bloom) ───────────
// Reduced to truly app-specific values: read/unread row text, starred yellow,
// the swipe action greens/reds, and a per-account avatar palette. Everything
// brand-tinted (primary, sidebar active, FAB, search bg) is derived from the
// active Bloom preset in `useColors()` below.

const InboxDomainColors = {
  light: {
    unread: '#202124',
    read: '#5F6368',
    starred: '#F4B400',
    sidebarText: '#202124',
    searchText: '#202124',
    searchPlaceholder: '#5F6368',
    // Avatar — neutral, brand-agnostic
    avatarColors: ['#5F6368', '#34A853', '#EA4335', '#FBBC04', '#9334E6', '#E8710A'],
    danger: '#D93025',
    success: '#1E8E3E',
    warning: '#F9AB00',
    swipeArchive: '#1E8E3E',
    swipeDelete: '#D93025',
    swipeRead: '#1A73E8',
    swipeSnooze: '#F9AB00',
  },
  dark: {
    unread: '#E8EAED',
    read: '#9AA0A6',
    starred: '#FDD663',
    sidebarText: '#E8EAED',
    searchText: '#E8EAED',
    searchPlaceholder: '#9AA0A6',
    avatarColors: ['#9AA0A6', '#81C995', '#F28B82', '#FDD663', '#C58AF9', '#FCAD70'],
    danger: '#F28B82',
    success: '#81C995',
    warning: '#FDD663',
    swipeArchive: '#81C995',
    swipeDelete: '#F28B82',
    swipeRead: '#8AB4F8',
    swipeSnooze: '#FDD663',
  },
} as const;

// ── useColors() hook (Bloom-aware) ──────────────────────────────────
// All brand-tinted tokens (primary container, sidebar active, FAB, search bg,
// selected row) are derived from Bloom so they track the active color preset.

export function useColors() {
  const { mode, colors: bloom } = useTheme();

  return useMemo(() => {
    const domain = InboxDomainColors[mode];

    // Bloom-derived, brand-aware tokens — replace Gmail blues with the
    // active preset (Oxy purple by default).
    const primaryContainer = bloom.primarySubtle;
    const sidebarItemActive = bloom.primarySubtle;
    const sidebarItemActiveText = bloom.primarySubtleForeground;
    const composeFab = bloom.primarySubtle;
    const composeFabText = bloom.primarySubtleForeground;
    const composeFabIcon = bloom.primarySubtleForeground;
    const searchBackground = bloom.backgroundSecondary;
    const selectedRow = bloom.primarySubtle;
    const sidebarBackground = mode === 'dark' ? bloom.backgroundSecondary : bloom.background;

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
      // Brand-aware (was Gmail blue) — now follows the active preset
      primaryContainer,
      sidebarBackground,
      sidebarItemActive,
      sidebarItemActiveText,
      composeFab,
      composeFabText,
      composeFabIcon,
      searchBackground,
      selectedRow,
      // Inbox-specific domain colors (read/unread, starred, swipe, avatar)
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
