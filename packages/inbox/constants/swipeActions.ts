/**
 * Presentation config for the configurable swipe actions.
 *
 * `SwipeableRow` renders the icon + background for whichever `SwipeAction` the
 * user picked in Settings (`leftSwipeAction` / `rightSwipeAction`) instead of
 * hard-coding archive/delete. The parent (`InboxList`) owns the behaviour and
 * receives the chosen action via `onAction(action, messageId)`; this map is
 * purely visual so the component stays free of mutation knowledge.
 */

import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SwipeAction } from '@/contexts/inbox-prefs-context';

type MciName = keyof typeof MaterialCommunityIcons.glyphMap;

/** Which themed swipe color a given action paints its background with. */
export type SwipeColorKey = 'swipeArchive' | 'swipeDelete' | 'swipeRead' | 'swipeSnooze';

export interface SwipeActionConfig {
  icon: MciName;
  label: string;
  colorKey: SwipeColorKey;
}

/**
 * Config for every actionable swipe. `'none'` is intentionally absent — the
 * component treats a `none` binding as "render no action on that side".
 */
export const SWIPE_ACTIONS: Record<Exclude<SwipeAction, 'none'>, SwipeActionConfig> = {
  archive: { icon: 'archive-outline', label: 'Archive', colorKey: 'swipeArchive' },
  delete: { icon: 'delete-outline', label: 'Delete', colorKey: 'swipeDelete' },
  'mark-read': { icon: 'email-open-outline', label: 'Mark read', colorKey: 'swipeRead' },
  snooze: { icon: 'clock-outline', label: 'Snooze', colorKey: 'swipeSnooze' },
};

export function getSwipeActionConfig(action: SwipeAction): SwipeActionConfig | null {
  if (action === 'none') return null;
  return SWIPE_ACTIONS[action];
}
