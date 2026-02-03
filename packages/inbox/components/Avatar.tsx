/**
 * Gmail-style avatar with initials and color based on sender name.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
}: {
  name: string;
  size?: number;
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
