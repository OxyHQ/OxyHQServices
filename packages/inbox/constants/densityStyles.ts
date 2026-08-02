/**
 * Row metrics per message density preference.
 *
 * `MessageRow` reads these values (keyed by `prefs.density`) instead of
 * hard-coding paddings and the avatar size, so the "Message density" setting
 * in Settings → Inbox has a real visual effect on the list.
 */

import type { MessageDensity } from '@/contexts/inbox-prefs-context';

export interface DensityStyle {
  /** Vertical padding applied to each row container. */
  rowPaddingVertical: number;
  /** Horizontal gap between the avatar and the row content. */
  rowGap: number;
  /** Avatar diameter. */
  avatarSize: number;
  /** Vertical gap between the lines of row content. */
  contentGap: number;
}

export const DENSITY_STYLES: Record<MessageDensity, DensityStyle> = {
  compact: { rowPaddingVertical: 8, rowGap: 10, avatarSize: 32, contentGap: 1 },
  comfortable: { rowPaddingVertical: 12, rowGap: 12, avatarSize: 40, contentGap: 2 },
  cozy: { rowPaddingVertical: 16, rowGap: 14, avatarSize: 44, contentGap: 4 },
};
