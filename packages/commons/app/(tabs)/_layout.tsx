import React from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ErrorFallback } from '@/components/error-fallback';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';

/**
 * Native bottom tab bar — the post-auth navigation shell for Commons.
 *
 * Uses expo-router's native tab bar (`NativeTabs`, Expo SDK 56) so the tab bar
 * is a real platform UITabBar / BottomNavigationView, not a JS component. Three
 * static tabs (well under Android's max of 5), each backed by its own route
 * group + nested `<Stack>` (native tabs render no headers, so each group owns
 * its titles and detail-screen pushes):
 *
 *   (id)         ID           — Oxy ID card + identity overview + scanned-card view
 *   (reputation) Reputación   — reputation breakdown
 *   (settings)   Ajustes      — identity/vault management
 *
 * `(id)` is the first trigger, so the native tab bar lands there on cold start.
 * The QR scanner is NOT a tab — it is an action opened from the ID landing's
 * Bloom FAB as a root-level full-screen modal (`app/(scan)`).
 *
 * `name` MUST match each route-group folder name INCLUDING parentheses. The
 * trigger set is static (no conditional/loop rendering) per the native-tabs
 * contract; only the localized labels vary.
 *
 * The native tab bar is themed from Bloom tokens via `useColors()` (the same
 * resolver every Commons screen uses, which wraps `@oxyhq/bloom/theme`'s
 * `useTheme()`): the active icon + label use the normal `text` color (white in
 * dark / black in light) sitting on the SOFT `primarySubtle` active-indicator
 * pill (Bloom's Material-3 "primary container"), so the active item reads as a
 * high-contrast glyph on a tinted pill. The Android tap ripple also uses
 * `primarySubtle` so the touch feedback feels on-brand instead of the bright
 * system default. `card`/`textSecondary` drive the bar background and the
 * inactive icon/label. Since `useColors()` is a hook, the layout re-renders on a
 * light/dark flip and the bar re-tints — no hardcoded colors, no native config
 * (Fast-Refresh-safe). The surrounding navigation chrome already inherits Bloom
 * via the root layout's `ThemeProvider value={useNavigationTheme()}`.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <NativeTabs
      tintColor={colors.text}
      backgroundColor={colors.card}
      iconColor={colors.textSecondary}
      indicatorColor={colors.primarySubtle}
      rippleColor={colors.primarySubtle}
      labelStyle={{ color: colors.textSecondary }}
    >
      <NativeTabs.Trigger name="(id)">
        <NativeTabs.Trigger.Icon sf="person.text.rectangle" md="badge" />
        <NativeTabs.Trigger.Label>{t('tabs.id')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(reputation)">
        <NativeTabs.Trigger.Icon sf="star.circle" md="stars" />
        <NativeTabs.Trigger.Label>{t('tabs.reputation')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(settings)">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

/**
 * Route-level error boundary for the whole tab tree. expo-router renders this
 * when a render error escapes any tab's stack.
 */
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <ErrorFallback {...props} />;
}
