import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';

interface PillProps {
  /** A short label, or a count. When `count` is set it wins. */
  label?: string;
  count?: number;
  tone?: 'primary' | 'neutral';
}

/**
 * A compact filled count / status badge — the trailing pill on a row when work
 * is waiting (e.g. pending validations). Restrained: one solid fill, white text,
 * tabular numerals.
 */
export function Pill({ label, count, tone = 'primary' }: PillProps) {
  const colors = useColors();
  const background = tone === 'primary' ? colors.primary : colors.textTertiary;
  const text = count != null ? String(count) : (label ?? '');

  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <ThemedText style={styles.text} numberOfLines={1}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
