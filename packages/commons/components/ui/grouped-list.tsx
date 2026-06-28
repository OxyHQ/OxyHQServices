import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface GroupedListProps {
  children: React.ReactNode;
}

/**
 * Stacks `ListRow`s (or any rows) with a single `StyleSheet.hairlineWidth`
 * separator between them — no surrounding card, no per-row box. Separation is a
 * thin line plus the rows' own breathing room, matching the reputation feed.
 */
export function GroupedList({ children }: GroupedListProps) {
  const colors = useColors();
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View>
      {items.map((child, index) => (
        <View
          key={index}
          style={index > 0 ? [styles.divider, { borderTopColor: colors.border }] : undefined}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
