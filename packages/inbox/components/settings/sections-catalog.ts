/**
 * Canonical list of settings sections.
 *
 * Used by both the desktop sidebar (`SettingsNav`) and the mobile landing
 * screen (`/settings`) so they stay in lock-step. Each entry maps to a
 * typed-routes path under `/settings/...`, carries a Bloom icon, and a
 * semantic tint key (per-row colored IconCircle, iOS Settings style).
 */

import type { ComponentType } from 'react';

import type { Props as IconProps } from '@oxyhq/bloom/icons';
import {
  UserCircle_Stroke2_Corner0_Rounded,
  Bell_Stroke2_Corner0_Rounded,
  Envelope_Stroke2_Corner0_Rounded,
  ColorPalette_Stroke2_Corner0_Rounded,
  Lock_Stroke2_Corner0_Rounded,
  Pin_Stroke2_Corner0_Rounded,
  Sparkle_Stroke2_Corner0_Rounded,
  FloppyDisk_Stroke2_Corner0_Rounded,
  SettingsSliderVertical_Stroke2_Corner0_Rounded,
  CircleInfo_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import type { SettingsTintKey } from './settings-tints';

/** A canonical settings section slug used in URLs and as a key. */
export type SettingsSectionKey =
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'inbox-prefs'
  | 'privacy'
  | 'labels'
  | 'ai'
  | 'storage'
  | 'advanced'
  | 'about';

/** A typed-routes path string for the settings section route. */
export type SettingsSectionPath =
  | '/settings/account'
  | '/settings/appearance'
  | '/settings/notifications'
  | '/settings/inbox-prefs'
  | '/settings/privacy'
  | '/settings/labels'
  | '/settings/ai'
  | '/settings/storage'
  | '/settings/advanced'
  | '/settings/about';

export interface SettingsSectionDef {
  key: SettingsSectionKey;
  /** Typed route path for `router.push()`. */
  path: SettingsSectionPath;
  /** Display label (matches subscreen title). */
  label: string;
  /** Short description shown under the row in the landing page. */
  description: string;
  /** Bloom icon component (rendered inside an `IconCircle`). */
  icon: ComponentType<IconProps>;
  /** Tint key for the per-row colored IconCircle background. */
  tint: SettingsTintKey;
  /** Whether this section requires authentication to access meaningfully. */
  requiresAuth: boolean;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    key: 'account',
    path: '/settings/account',
    label: 'Account',
    description: 'Profile, signature, recovery, and sign out',
    icon: UserCircle_Stroke2_Corner0_Rounded,
    tint: 'account',
    requiresAuth: true,
  },
  {
    key: 'appearance',
    path: '/settings/appearance',
    label: 'Appearance',
    description: 'Theme and accent color',
    icon: ColorPalette_Stroke2_Corner0_Rounded,
    tint: 'appearance',
    requiresAuth: false,
  },
  {
    key: 'notifications',
    path: '/settings/notifications',
    label: 'Notifications',
    description: 'Push and email alerts',
    icon: Bell_Stroke2_Corner0_Rounded,
    tint: 'notifications',
    requiresAuth: true,
  },
  {
    key: 'inbox-prefs',
    path: '/settings/inbox-prefs',
    label: 'Inbox',
    description: 'Density, reading, and swipe actions',
    icon: Envelope_Stroke2_Corner0_Rounded,
    tint: 'inbox',
    requiresAuth: false,
  },
  {
    key: 'privacy',
    path: '/settings/privacy',
    label: 'Privacy',
    description: 'Tracking protection and sender trust',
    icon: Lock_Stroke2_Corner0_Rounded,
    tint: 'privacy',
    requiresAuth: true,
  },
  {
    key: 'labels',
    path: '/settings/labels',
    label: 'Labels',
    description: 'Organize your inbox with custom labels',
    icon: Pin_Stroke2_Corner0_Rounded,
    tint: 'labels',
    requiresAuth: true,
  },
  {
    key: 'ai',
    path: '/settings/ai',
    label: 'AI features',
    description: 'Brief, Smart Reply, and categorization',
    icon: Sparkle_Stroke2_Corner0_Rounded,
    tint: 'ai',
    requiresAuth: true,
  },
  {
    key: 'storage',
    path: '/settings/storage',
    label: 'Storage',
    description: 'Quota usage and attachment cache',
    icon: FloppyDisk_Stroke2_Corner0_Rounded,
    tint: 'storage',
    requiresAuth: true,
  },
  {
    key: 'advanced',
    path: '/settings/advanced',
    label: 'Advanced',
    description: 'Filters, templates, and import',
    icon: SettingsSliderVertical_Stroke2_Corner0_Rounded,
    tint: 'advanced',
    requiresAuth: false,
  },
  {
    key: 'about',
    path: '/settings/about',
    label: 'About',
    description: 'Version, credits, and legal',
    icon: CircleInfo_Stroke2_Corner0_Rounded,
    tint: 'about',
    requiresAuth: false,
  },
];
