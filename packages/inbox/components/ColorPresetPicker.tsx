/**
 * Color preset picker — grid of swatches that drives the active Bloom
 * `colorPreset`. Reads and writes the persisted preference from
 * `useThemeContext()`; the chosen preset is propagated to
 * `BloomThemeProvider`, so every brand-tinted token (FAB, sidebar active,
 * search bg, primary buttons, links) follows the selection in real time.
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { APP_COLOR_NAMES, APP_COLOR_PRESETS } from '@oxyhq/bloom/theme';
import type { AppColorName } from '@oxyhq/bloom/theme';

import { useThemeContext } from '@/contexts/theme-context';
import { useColors } from '@/constants/theme';

const PRESET_LABELS: Record<AppColorName, string> = {
  teal: 'Teal',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  yellow: 'Yellow',
  red: 'Red',
  purple: 'Purple',
  pink: 'Pink',
  sky: 'Sky',
  orange: 'Orange',
  mint: 'Mint',
  oxy: 'Oxy',
  faircoin: 'Faircoin',
};

export function ColorPresetPicker() {
  const { colorPreset, setColorPreset } = useThemeContext();
  const colors = useColors();

  const presets = useMemo(
    () =>
      APP_COLOR_NAMES.map((name) => ({
        name,
        hex: APP_COLOR_PRESETS[name].hex,
        label: PRESET_LABELS[name],
      })),
    [],
  );

  const activeHex = APP_COLOR_PRESETS[colorPreset].hex;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Accent color</Text>
        <View style={styles.activePreview}>
          <View style={[styles.activeDot, { backgroundColor: activeHex }]} />
          <Text style={[styles.activeLabel, { color: colors.secondaryText }]}>
            {PRESET_LABELS[colorPreset]}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {presets.map((preset) => {
          const isActive = preset.name === colorPreset;
          return (
            <TouchableOpacity
              key={preset.name}
              onPress={() => setColorPreset(preset.name)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${preset.label} accent color`}
              accessibilityState={{ selected: isActive }}
              style={styles.swatchCell}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: preset.hex },
                  isActive && [
                    styles.swatchActive,
                    { borderColor: colors.text },
                  ],
                ]}
              >
                {isActive && (
                  <MaterialCommunityIcons
                    name="check"
                    size={18}
                    color="#FFFFFF"
                  />
                )}
              </View>
              <Text
                style={[styles.swatchLabel, { color: colors.secondaryText }]}
                numberOfLines={1}
              >
                {preset.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const SWATCH_SIZE = 36;

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
  },
  activePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  activeLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    ...Platform.select({
      web: { rowGap: 14, columnGap: 12 },
      default: {},
    }),
  },
  swatchCell: {
    width: 52,
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: SWATCH_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: {
    borderWidth: 2,
  },
  swatchLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
});
