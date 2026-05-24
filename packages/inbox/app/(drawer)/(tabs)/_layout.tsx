/**
 * Bottom tabs for the inbox app.
 *
 * Uses expo-router's `NativeTabs` so the tab bar is rendered by the
 * platform (UITabBar on iOS, BottomNavigationView on Android) rather
 * than as a JS view. This is the preferred look-and-feel and matches
 * the rest of the Oxy ecosystem.
 *
 * Theming: NativeTabs accepts a small set of `ColorValue` props that
 * Expo Router forwards to the native appearance proxies. We pull the
 * active Bloom preset via `useColors()` so the tab bar follows the
 * user's selected accent (Oxy purple by default).
 *
 * Limitations of the native tab bar:
 *   - Per-tab badge values can be set via `<NativeTabs.Trigger.Badge>`
 *     but require a string value; we render no badge here because the
 *     unread count would need a live query in this layout. The inbox
 *     screen surfaces unread state per-row instead.
 *   - Icon shape is controlled by `sf` (iOS SF Symbols) and `drawable`
 *     (Android system drawables). Custom vector icons are possible via
 *     `<NativeTabs.Trigger.Icon src={...}>` but we use platform icons
 *     for a native look.
 */

import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { useColors } from '@/constants/theme';
import { useTranslation } from '@/lib/i18n';

export default function TabsLayout() {
  const colors = useColors();
  const { t } = useTranslation();
  // Drive the native tab bar's `hidden` prop from the OS keyboard state via
  // `react-native-keyboard-controller`. The selector only re-renders this
  // layout when the visibility boolean actually flips. `KeyboardProvider` is
  // already mounted at the app root in `app/_layout.tsx`.
  const keyboardVisible = useKeyboardState((state) => state.isVisible);

  return (
    <NativeTabs
      hidden={keyboardVisible}
      iconColor={{
        default: colors.icon,
        selected: colors.primary,
      }}
      labelStyle={{
        default: { color: colors.icon },
        selected: { color: colors.primary },
      }}
      tintColor={colors.primary}
      backgroundColor={colors.background}
      indicatorColor={colors.primaryContainer}
      rippleColor={colors.primaryContainer}
    >
      <NativeTabs.Trigger name="home">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md="home"
        />
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(inbox)">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'envelope', selected: 'envelope.fill' }}
          md="mail"
        />
        <NativeTabs.Trigger.Label>{t('tabs.inbox')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>{t('tabs.search')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md="settings"
        />
        <NativeTabs.Trigger.Label>{t('tabs.settings')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="for-you" hidden />
    </NativeTabs>
  );
}
