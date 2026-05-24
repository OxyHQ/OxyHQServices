/**
 * Appearance subscreen — visual theme controls.
 *
 * Layout follows the Alia settings pattern: a `View` with generous `gap`
 * spacing, each subsection introduced by a small uppercase eyebrow label
 * and rendered as a self-contained visual block — not a stack of identical
 * rounded list rows.
 *
 * Subsections:
 *  1. Theme mode (Light / System / Dark) — three preview cards showing a
 *     miniature of the inbox UI in each mode, like Alia's general settings.
 *  2. Accent color picker — the existing `ColorPresetPicker` component
 *     (keeps a single canonical home for the color picker).
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import {
  Moon_Stroke2_Corner0_Rounded,
  ColorPalette_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { useThemeContext } from '@/contexts/theme-context';
import { ColorPresetPicker } from '@/components/ColorPresetPicker';
import { SectionHeader } from '@/components/settings/SectionHeader';

type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Miniature preview of the inbox in a specific theme mode. Renders a slim
 * sidebar + a stack of message rows so the user can preview the impact of
 * their choice without leaving the settings page.
 */
function InboxMiniature({ variant }: { variant: 'light' | 'dark' }) {
  const palette = variant === 'light'
    ? { bg: '#FFFFFF', sidebar: '#F2F2F2', primary: '#1d9bf0', muted: '#D8D8D8', border: '#E5E5E5' }
    : { bg: '#0E0E10', sidebar: '#161618', primary: '#8AB4F8', muted: '#3A3A3D', border: '#2A2A2D' };

  return (
    <View style={[styles.mini, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      {/* Sidebar */}
      <View style={[styles.miniSidebar, { backgroundColor: palette.sidebar }]}>
        <View style={[styles.miniSidebarPill, { backgroundColor: palette.primary }]} />
        <View style={[styles.miniSidebarLine, { backgroundColor: palette.muted, width: '70%' }]} />
        <View style={[styles.miniSidebarLine, { backgroundColor: palette.muted, width: '55%' }]} />
        <View style={[styles.miniSidebarLine, { backgroundColor: palette.muted, width: '65%' }]} />
        <View style={[styles.miniSidebarLine, { backgroundColor: palette.muted, width: '40%' }]} />
      </View>
      {/* Message list */}
      <View style={styles.miniBody}>
        {[0.85, 0.65, 0.78, 0.55, 0.7].map((w, i) => (
          <View key={i} style={styles.miniRow}>
            <View style={[styles.miniAvatar, { backgroundColor: palette.muted }]} />
            <View style={styles.miniRowText}>
              <View style={[styles.miniRowTitle, { backgroundColor: palette.muted, width: `${w * 100}%` }]} />
              <View style={[styles.miniRowSubtitle, { backgroundColor: palette.muted, width: `${w * 70}%` }]} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

interface ModeOption {
  value: ThemeMode;
  label: string;
  render: () => React.ReactNode;
}

function makeModeOptions(): ModeOption[] {
  return [
    {
      value: 'light',
      label: 'Light',
      render: () => <InboxMiniature variant="light" />,
    },
    {
      value: 'system',
      label: 'System',
      render: () => (
        <View style={styles.miniSystem}>
          <View style={styles.miniSystemHalf}>
            <InboxMiniature variant="light" />
          </View>
          <View style={[styles.miniSystemHalf, styles.miniSystemHalfRight]}>
            <InboxMiniature variant="dark" />
          </View>
        </View>
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      render: () => <InboxMiniature variant="dark" />,
    },
  ];
}

const MODE_OPTIONS = makeModeOptions();

export function AppearanceSection() {
  const colors = useColors();
  const theme = useTheme();
  const { themePreference, setThemePreference } = useThemeContext();

  const handleChange = useCallback(
    (value: ThemeMode) => setThemePreference(value),
    [setThemePreference],
  );

  return (
    <View style={styles.root}>
      <View style={styles.subsection}>
        <SectionHeader icon={Moon_Stroke2_Corner0_Rounded} title="Theme" />
        <View style={styles.modeRow}>
          {MODE_OPTIONS.map((opt) => {
            const isActive = themePreference === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => handleChange(opt.value)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${opt.label} theme`}
                accessibilityState={{ selected: isActive }}
                style={({ pressed }) => [
                  styles.modeCard,
                  {
                    borderColor: isActive ? theme.colors.primary : colors.border,
                    borderWidth: isActive ? 2 : 1,
                    padding: isActive ? 6 : 7,
                  },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={styles.miniWrapper}>{opt.render()}</View>
                <Text
                  style={[
                    styles.modeLabel,
                    { color: isActive ? theme.colors.primary : colors.text },
                    isActive && styles.modeLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.footnote, { color: colors.secondaryText }]}>
          System follows your device's appearance setting.
        </Text>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={ColorPalette_Stroke2_Corner0_Rounded} title="Accent color" />
        <ColorPresetPicker />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 28,
  },
  subsection: {
    gap: 12,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeCard: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: 'transparent',
    gap: 8,
  },
  miniWrapper: {
    aspectRatio: 5 / 3,
    overflow: 'hidden',
    borderRadius: 8,
  },
  modeLabel: {
    fontSize: 13,
    textAlign: 'center',
  },
  modeLabelActive: {
    fontWeight: '600',
  },
  footnote: {
    fontSize: 12,
    paddingHorizontal: 2,
  },

  // ── Inbox miniature ────────────────────────────────────────────
  mini: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    overflow: 'hidden',
  },
  miniSidebar: {
    width: '28%',
    padding: 4,
    gap: 3,
    justifyContent: 'flex-start',
  },
  miniSidebarPill: {
    height: 6,
    borderRadius: 2,
    width: '85%',
  },
  miniSidebarLine: {
    height: 2,
    borderRadius: 1,
    opacity: 0.6,
  },
  miniBody: {
    flex: 1,
    padding: 4,
    gap: 4,
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniAvatar: {
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.7,
  },
  miniRowText: {
    flex: 1,
    gap: 2,
  },
  miniRowTitle: {
    height: 2.5,
    borderRadius: 1,
  },
  miniRowSubtitle: {
    height: 2,
    borderRadius: 1,
    opacity: 0.6,
  },
  miniSystem: {
    flex: 1,
    flexDirection: 'row',
  },
  miniSystemHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  miniSystemHalfRight: {
    marginLeft: -StyleSheet.hairlineWidth,
  },
});
