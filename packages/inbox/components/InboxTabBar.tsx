import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { TabBar, TabBarButton, type TabBarItem } from '@oxyhq/bloom/tab-bar';
import {
  Envelope_Filled_Stroke2_Corner0_Rounded,
  Envelope_Stroke2_Corner0_Rounded,
  MagnifyingGlass_Filled_Stroke2_Corner0_Rounded,
  MagnifyingGlass_Stroke2_Corner0_Rounded,
  SettingsGear2_Filled_Corner0_Rounded,
  SettingsGear2_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';
import type { BottomTabBarProps } from 'expo-router/tabs';

import { useTranslation } from '@/lib/i18n';

/**
 * Route names of the visible tabs, in bar order. The array is the single source
 * of truth for the mapping between a bar index and a route: `activeIndex` is
 * derived by looking the focused route up in it, and a press navigates to the
 * entry at the pressed index. Deriving both from one list is what keeps the
 * highlight correct through deep links and the back gesture, which move the
 * navigator without going through the bar.
 *
 * `for-you` and `today` are deliberately absent — they live under the tabs but
 * are reached from the drawer, exactly as they were when the native bar
 * registered `for-you` as a hidden trigger. On those routes no entry matches,
 * `activeIndex` is -1, and the bar shows no selection.
 */
const TAB_ROUTES = ['(inbox)', 'search', 'settings'] as const;

/**
 * Glyph size. Bloom icons take a size KEYWORD, not a number; `md` is 20px,
 * which is what the bar's own 21px glyph box is built around.
 */
const ICON_SIZE = 'md';

/**
 * The Inbox bottom bar: Bloom's floating glass pill, driven by the tab
 * navigator's own state.
 *
 * It replaces the platform `NativeTabs` bar, and unlike that bar it renders on
 * WEB too, where the app previously had no bottom navigation at all (the drawer
 * was the only way between sections). The drawer stays; the bar is additional.
 *
 * Each tab carries an outline/filled icon PAIR, supplied as `icon` +
 * `activeIcon` so the bar's crossfade swaps SHAPES the way the SF Symbol pair
 * (`envelope` / `envelope.fill`) did, rather than tinting one shape twice.
 *
 * `sfSymbol` is deliberately NOT set: it would render an SF Symbol on iOS and a
 * Bloom icon everywhere else, so the three platforms would disagree about the
 * shape of the same tab.
 */
export function InboxTabBar({ state, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();

  // The native bar hid itself while the OS keyboard was up (`NativeTabs`'
  // `hidden` prop). Bloom's bar has no such prop, so the host unmounts it
  // instead — the same result, and the selector only re-renders when the
  // visibility boolean actually flips. `KeyboardProvider` is already mounted at
  // the app root in `app/_layout.tsx`.
  const keyboardVisible = useKeyboardState((keyboard) => keyboard.isVisible);

  const items = useMemo<TabBarItem[]>(
    () => [
      {
        name: '(inbox)',
        label: t('tabs.inbox'),
        icon: <Envelope_Stroke2_Corner0_Rounded size={ICON_SIZE} />,
        activeIcon: <Envelope_Filled_Stroke2_Corner0_Rounded size={ICON_SIZE} />,
      },
      {
        name: 'search',
        label: t('tabs.search'),
        icon: <MagnifyingGlass_Stroke2_Corner0_Rounded size={ICON_SIZE} />,
        activeIcon: <MagnifyingGlass_Filled_Stroke2_Corner0_Rounded size={ICON_SIZE} />,
      },
      {
        name: 'settings',
        label: t('tabs.settings'),
        icon: <SettingsGear2_Stroke2_Corner0_Rounded size={ICON_SIZE} />,
        activeIcon: <SettingsGear2_Filled_Corner0_Rounded size={ICON_SIZE} />,
      },
    ],
    [t],
  );

  // The navigator's route list also carries the hidden routes, so the focused
  // index cannot be used as a bar index directly — it is resolved by name.
  const focusedRouteName = state.routes[state.index]?.name;
  const activeIndex = TAB_ROUTES.findIndex((name) => name === focusedRouteName);

  const handleIndexChange = useCallback(
    (index: number) => {
      const route = TAB_ROUTES[index];
      if (route !== undefined) {
        navigation.navigate(route);
      }
    },
    [navigation],
  );

  if (keyboardVisible) return null;

  return (
    <View style={styles.host}>
      <TabBar activeIndex={activeIndex} onIndexChange={handleIndexChange}>
        {items.map((item, index) => (
          <TabBarButton key={item.name} item={item} index={index} />
        ))}
      </TabBar>
    </View>
  );
}

InboxTabBar.displayName = 'InboxTabBar';

const styles = StyleSheet.create({
  /**
   * POSITIONING: the navigator renders this element as the LAST child of a flex
   * column whose other child is the screen container. Left in normal flow the
   * host would take real layout space and shrink every screen by the bar's
   * height, which is exactly what a floating bar must not do — so it is pulled
   * out of the flow and pinned to the bottom edge.
   *
   * It stays ZERO-HEIGHT on purpose: Bloom's bar is itself `position: absolute`
   * against this host, so it hangs off the host's bottom edge and needs nothing
   * from its box but that edge's position.
   *
   * `pointerEvents: 'box-none'` in the style object rather than as a prop —
   * react-native-web deprecated the prop and warns on every render.
   */
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  },
});
