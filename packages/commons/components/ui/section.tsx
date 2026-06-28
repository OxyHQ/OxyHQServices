import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional right-aligned element (e.g. a count pill or a quiet link). */
  trailing?: React.ReactNode;
}

/**
 * The flat section title block: a confident 17/700 title with an optional muted
 * subtitle beneath it. No card, no rule — sections are separated by the screen's
 * whitespace rhythm, not boxes.
 */
export function SectionHeader({ title, subtitle, trailing }: SectionHeaderProps) {
  const colors = useColors();
  return (
    <View style={styles.headerWrap}>
      <View style={styles.titleRow}>
        <ThemedText style={[styles.title, { color: colors.text }]}>{title}</ThemedText>
        {trailing}
      </View>
      {subtitle && (
        <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</ThemedText>
      )}
    </View>
  );
}

interface SectionProps {
  title?: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
  /** Air between the header and the section body. */
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A titled content group. The header (if any) sits a tight 12pt above its body;
 * the outer screen gap (32pt) is what separates one `Section` from the next, so
 * the page breathes without nesting boxes.
 */
export function Section({ title, subtitle, trailing, children, gap = 12, style }: SectionProps) {
  return (
    <View style={[{ gap }, style]}>
      {title && <SectionHeader title={title} subtitle={subtitle} trailing={trailing} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
});
