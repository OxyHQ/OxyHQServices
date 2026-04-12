/**
 * Gmail-style avatar with initials and color based on sender name.
 * Supports optional checkbox overlay for multi-select mode.
 *
 * Uses Bloom's Avatar as the base for image loading, error handling, and sizing.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Avatar as BloomAvatar } from '@oxyhq/bloom/avatar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { useColors } from '@/constants/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

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
  avatarUrl,
}: {
  name: string;
  size?: number;
  showCheckbox?: boolean;
  isChecked?: boolean;
  avatarUrl?: string | null;
}) {
  const colors = useColors();

  const initial = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return '?';
    return trimmed[0].toUpperCase();
  }, [name]);

  const bgColor = useMemo(() => {
    const palette = colors.avatarColors;
    return palette[hashCode(name) % palette.length];
  }, [name, colors.avatarColors]);

  const placeholderIcon = useMemo(
    () => <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>,
    [initial, size],
  );

  if (showCheckbox) {
    if (isChecked) {
      return (
        <View
          style={[
            styles.checkboxContainer,
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
          styles.checkboxContainer,
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
    <BloomAvatar
      source={avatarUrl}
      size={size}
      placeholderColor={bgColor}
      placeholderIcon={placeholderIcon}
    />
  );
}

/**
 * Convenience wrapper: builds a full avatar URL from a server-provided
 * relative path and renders an Avatar. Safe to use inside .map() loops.
 */
export function SenderAvatar({ avatarPath, name, size }: { avatarPath?: string | null; name: string; size?: number }) {
  const url = avatarPath ? `${API_URL}${avatarPath}` : null;
  return <Avatar name={name} size={size} avatarUrl={url} />;
}

const styles = StyleSheet.create({
  checkboxContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
