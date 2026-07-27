import { useTabBarFootprint } from '@oxyhq/bloom/tab-bar';

/**
 * Breathing margin (px) between the end of a screen's scrollable content and
 * the top of the floating bar, so the last row never sits flush against it.
 */
const CLEARANCE = 12;

/**
 * Vertical space (px) a scrollable tab screen must leave free at its bottom for
 * the floating tab bar: Bloom's own footprint — the expanded pill plus the gap
 * it keeps from the window edge, with the bottom safe-area inset ALREADY folded
 * in — plus this app's clearance.
 *
 * A hook rather than a constant because the footprint depends on the safe-area
 * inset, and Bloom's own measurement rather than a copied number so it cannot
 * drift the moment the bar changes by a pixel.
 *
 * NEVER add `insets.bottom` to the result: Bloom folds the inset into the bar's
 * own bottom gap, so adding it again counts the home indicator twice and
 * strands a band of dead space under every list.
 */
export function useTabBarClearance(): number {
  return useTabBarFootprint() + CLEARANCE;
}
