import { Platform, type ViewStyle } from 'react-native';

/**
 * Positioning shared by every floating UI cluster (the tabs layout's FAB and
 * the bottom action bar). On web the cluster is `position: fixed` so it stays
 * pinned while the content column scrolls; on native it is `position: absolute`
 * within the screen container. Typed as `ViewStyle` so the `position` literal
 * is validated instead of cast.
 */
export const floatingPosition: ViewStyle = Platform.select<ViewStyle>({
  // RN Web supports `position: fixed`; the RN ViewStyle union does not include it.
  web: { position: 'fixed' } as unknown as ViewStyle,
  default: { position: 'absolute' },
}) ?? { position: 'absolute' };
