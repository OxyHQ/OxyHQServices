/**
 * Per-row tint colors for the settings landing.
 *
 * iOS Settings assigns each row a distinct tint so the page is scannable
 * — Account is blue, Appearance is purple, Privacy is red, etc. Bloom's
 * `APP_COLOR_PRESETS` gives us a curated 13-color palette, so we map each
 * section to one preset and use its `hex` value as the IconCircle bg.
 *
 * Keeping the mapping in one file means a section's color is one edit
 * away from changing across both the landing list and any subscreen that
 * surfaces the same icon.
 */

import { useMemo } from 'react';
import { APP_COLOR_PRESETS, useTheme } from '@oxyhq/bloom/theme';
import type { AppColorName } from '@oxyhq/bloom/theme';

export type SettingsTintKey =
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'inbox'
  | 'privacy'
  | 'labels'
  | 'contacts'
  | 'ai'
  | 'storage'
  | 'advanced'
  | 'about'
  | 'neutral';

const TINT_PRESET: Record<Exclude<SettingsTintKey, 'neutral'>, AppColorName> = {
  account: 'blue',
  appearance: 'purple',
  notifications: 'red',
  inbox: 'green',
  privacy: 'red',
  labels: 'orange',
  contacts: 'pink',
  ai: 'amber',
  storage: 'sky',
  advanced: 'teal',
  about: 'mint',
};

// Hand-picked neutral greys that match iOS Settings' neutral rows — for
// any row that doesn't need a color signal of its own.
const NEUTRAL_HEX = {
  light: '#8E8E93',
  dark: '#636366',
} as const;

/**
 * Resolves a `SettingsTintKey` to a hex string. The hex is mode-aware
 * only for the `neutral` key; the named presets use the same hex in both
 * modes (the white glyph maintains contrast either way).
 */
export function useSettingsTint(key: SettingsTintKey): string {
  const { mode } = useTheme();

  return useMemo(() => {
    if (key === 'neutral') {
      return mode === 'dark' ? NEUTRAL_HEX.dark : NEUTRAL_HEX.light;
    }
    return APP_COLOR_PRESETS[TINT_PRESET[key]].hex;
  }, [mode, key]);
}
