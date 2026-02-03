/**
 * Gmail-style avatar with initials and color based on sender name.
 * Supports optional checkbox overlay for multi-select mode.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function Avatar({
  name,
  size = 40,
  showCheckbox,
  isChecked,
}: {
  name: string;
  size?: number;
  showCheckbox?: boolean;
  isChecked?: boolean;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const initial = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return '?';
    return trimmed[0].toUpperCase();
  }, [name]);

  const bgColor = useMemo(() => {
    const palette = colors.avatarColors;
    return palette[hashCode(name) % palette.length];
  }, [name, colors.avatarColors]);

  if (showCheckbox) {
    if (isChecked) {
      return (
        <View
          style={[
            styles.container,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: colors.primary,
            },
          ]}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Tick02Icon as unknown as IconSvgElement} size={size * 0.5} color="#FFFFFF" strokeWidth={3} />
          ) : (
            <MaterialCommunityIcons name="check" size={size * 0.5} color="#FFFFFF" />
          )}
        </View>
      );
    }
    return (
      <View
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderColor: colors.icon,
          },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bgColor,
        },
      ]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
