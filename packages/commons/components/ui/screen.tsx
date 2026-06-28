import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';

/** Horizontal gutter shared by every Commons screen. */
export const SCREEN_PADDING = 22;
/** Vertical air between top-level sections. */
export const SECTION_GAP = 32;
/** Bottom inset that clears the native tab bar / FAB. */
export const SCREEN_BOTTOM_PAD = 120;

interface ScreenProps {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /**
   * Wrap children in the standard padded, section-gapped content column.
   * Set `false` for full-bleed surfaces (camera, edge-to-edge media) that own
   * their own layout.
   */
  padded?: boolean;
  /** Air between direct children of the content column. */
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * The canonical Commons scroll surface: a single vertical scroller on the flat
 * `background` (no stacked cards), with a generous 22pt gutter, a 32pt rhythm
 * between sections, and a tab-bar-clearing bottom inset. Separation between
 * sections is WHITESPACE — the children compose freely (hero, sections, rows).
 */
export function Screen({
  children,
  refreshing,
  onRefresh,
  padded = true,
  gap = SECTION_GAP,
  contentStyle,
}: ScreenProps) {
  const colors = useColors();

  return (
    <ScreenContentWrapper refreshing={refreshing} onRefresh={onRefresh}>
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        {padded ? (
          <View style={[styles.content, { gap }, contentStyle]}>{children}</View>
        ) : (
          children
        )}
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 8,
    paddingBottom: SCREEN_BOTTOM_PAD,
  },
});
