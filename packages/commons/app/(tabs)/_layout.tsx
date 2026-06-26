import React from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ErrorFallback } from '@/components/error-fallback';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';

/**
 * Native bottom tab bar — the post-auth navigation shell for Commons.
 *
 * Uses expo-router's native tab bar (`NativeTabs`, Expo SDK 56) so the tab bar
 * is a real platform UITabBar / BottomNavigationView, not a JS component. Five
 * static tabs (Android's max), each backed by its own route group + nested
 * `<Stack>` (native tabs render no headers, so each group owns its titles and
 * detail-screen pushes):
 *
 *   (home)       Inicio       — identity overview
 *   (dni)        DNI          — citizen card + scanned-card view
 *   (scan)       Escanear     — QR scanner + sign-in approval
 *   (reputation) Reputación   — reputation breakdown
 *   (settings)   Ajustes      — identity/vault management
 *
 * `name` MUST match each route-group folder name INCLUDING parentheses. The
 * trigger set is static (no conditional/loop rendering) per the native-tabs
 * contract; only the localized labels vary.
 *
 * The native tab bar is themed from Bloom tokens via `useColors()` (the same
 * resolver every Commons screen uses, which wraps `@oxyhq/bloom/theme`'s
 * `useTheme()`): `primary` tints the active icon + label; the Android active
 * indicator pill AND the Android tap ripple use the SOFT `primarySubtle`
 * (Bloom's Material-3 "primary container") so the purple icon reads clearly on
 * the pill (a solid `primary` pill would hide the equally-purple active icon)
 * and the touch ripple feels on-brand instead of the bright system default.
 * `card`/`textSecondary` drive the bar background and inactive icon/label. Since
 * `useColors()` is a hook, the
 * layout re-renders on a light/dark flip and the bar re-tints — no hardcoded
 * colors, no native config (Fast-Refresh-safe). The surrounding navigation
 * chrome already inherits Bloom via the root layout's
 * `ThemeProvider value={useNavigationTheme()}`.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <NativeTabs
      tintColor={colors.primary}
      backgroundColor={colors.card}
      iconColor={colors.textSecondary}
      indicatorColor={colors.primarySubtle}
      rippleColor={colors.primarySubtle}
      labelStyle={{ color: colors.textSecondary }}
    >
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(dni)">
        <NativeTabs.Trigger.Icon sf="person.text.rectangle" md="badge" />
        <NativeTabs.Trigger.Label>{t('tabs.dni')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(scan)">
        <NativeTabs.Trigger.Icon sf="qrcode.viewfinder" md="qr_code_scanner" />
        <NativeTabs.Trigger.Label>{t('tabs.scan')}</NativeTabs.Trigger.Label>
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
