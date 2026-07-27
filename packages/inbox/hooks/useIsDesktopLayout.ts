import { Platform, useWindowDimensions } from 'react-native';

/**
 * Viewport width (px) at or above which the app lays out as a desktop: the
 * mailbox drawer becomes `permanent` and the floating tab bar is not rendered.
 */
export const DESKTOP_BREAKPOINT = 900;

/**
 * Whether the app is in its wide, desktop layout.
 *
 * This is the SINGLE source of truth for that question, and it is what keeps
 * the two pieces of navigation from ever disagreeing: the drawer is permanent
 * exactly when this is true, and the floating tab bar renders exactly when it
 * is false. Split across two independent conditions, a viewport could end up
 * with both a permanent sidebar and a floating bar, or with neither.
 *
 * `useWindowDimensions()` re-renders on resize, so a browser window dragged
 * across the breakpoint gains and loses the bar — and the space reserved for it
 * — cleanly, rather than keeping whatever was true at mount.
 *
 * Native is never desktop: a phone or tablet always gets the bar.
 */
export function useIsDesktopLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}
