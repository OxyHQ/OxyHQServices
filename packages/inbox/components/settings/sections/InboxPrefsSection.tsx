/**
 * Inbox preferences subscreen — list, reading, and swipe controls.
 *
 * Layout follows the Alia subsection pattern (small eyebrow header + visual
 * content block) rather than the iOS row-spam look. Toggles persist via
 * `useInboxPrefs` (local device) and are consumed live: `MessageRow` reads
 * density/avatars/previews through `useInboxDisplayPrefs`, `InboxList` reads
 * `conversationView` (thread grouping) and `markReadOnOpen`, and `SwipeableRow`
 * reads the left/right swipe bindings.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Switch } from '@oxyhq/bloom/switch';
import { SegmentedControl, SegmentedControlItem, SegmentedControlItemText } from '@oxyhq/bloom/segmented-control';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import {
  Envelope_Stroke2_Corner0_Rounded,
  Eye_Stroke2_Corner0_Rounded,
  ArrowBoxLeft_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';
import {
  useInboxPrefs,
  type MessageDensity,
  type SwipeAction,
} from '@/contexts/inbox-prefs-context';

const DENSITY_OPTIONS: ReadonlyArray<{ value: MessageDensity; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'cozy', label: 'Cozy' },
];

const SWIPE_OPTIONS: ReadonlyArray<{ value: SwipeAction; label: string }> = [
  { value: 'archive', label: 'Archive' },
  { value: 'delete', label: 'Delete' },
  { value: 'mark-read', label: 'Mark read' },
  { value: 'snooze', label: 'Snooze' },
  { value: 'none', label: 'None' },
];

function swipeLabel(action: SwipeAction): string {
  return SWIPE_OPTIONS.find((o) => o.value === action)?.label ?? action;
}

interface InlineToggleProps {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

function InlineToggle({ title, description, value, onChange }: InlineToggleProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={styles.inlineToggle}
    >
      <View style={styles.inlineToggleText}>
        <Text style={[styles.inlineToggleTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.inlineToggleSub, { color: colors.secondaryText }]}>
          {description}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </Pressable>
  );
}

interface SwipePickerProps {
  label: string;
  value: SwipeAction;
  onChange: (value: SwipeAction) => void;
}

function SwipePicker({ label, value, onChange }: SwipePickerProps) {
  const colors = useColors();
  const theme = useTheme();
  const handlePress = useCallback(() => {
    const idx = SWIPE_OPTIONS.findIndex((o) => o.value === value);
    const next = SWIPE_OPTIONS[(idx + 1) % SWIPE_OPTIONS.length];
    onChange(next.value);
  }, [value, onChange]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${label} swipe action: ${swipeLabel(value)}, tap to change`}
      style={[styles.swipeRow, { borderColor: colors.border }]}
    >
      <Text style={[styles.swipeLabel, { color: colors.text }]}>{label}</Text>
      <View style={[styles.swipeBadge, { backgroundColor: theme.colors.primarySubtle }]}>
        <Text style={[styles.swipeValue, { color: theme.colors.primarySubtleForeground }]}>
          {swipeLabel(value)}
        </Text>
      </View>
    </Pressable>
  );
}

export function InboxPrefsSection() {
  const colors = useColors();
  const { prefs, setPref } = useInboxPrefs();

  const handleDensityChange = useCallback(
    (value: MessageDensity) => setPref('density', value),
    [setPref],
  );

  return (
    <View style={styles.root}>
      {/* Density */}
      <View style={styles.subsection}>
        <SectionHeader icon={Envelope_Stroke2_Corner0_Rounded} title="Message density" />
        <SegmentedControl<MessageDensity>
          label="Message density"
          type="radio"
          value={prefs.density}
          onChange={handleDensityChange}
        >
          {DENSITY_OPTIONS.map((opt) => (
            <SegmentedControlItem key={opt.value} value={opt.value}>
              <SegmentedControlItemText>{opt.label}</SegmentedControlItemText>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <Text style={[styles.footnote, { color: colors.secondaryText }]}>
          Choose how tightly to pack message rows in the list.
        </Text>
      </View>

      {/* Display options */}
      <View style={styles.subsection}>
        <SectionHeader icon={Eye_Stroke2_Corner0_Rounded} title="Display" />
        <View style={styles.toggleGroup}>
          <InlineToggle
            title="Show avatars"
            description="Sender portraits at the start of each row."
            value={prefs.showAvatars}
            onChange={(v) => setPref('showAvatars', v)}
          />
          <InlineToggle
            title="Show previews"
            description="A short snippet of the message body."
            value={prefs.showPreviews}
            onChange={(v) => setPref('showPreviews', v)}
          />
          <InlineToggle
            title="Group by thread"
            description="Show conversations as a single row."
            value={prefs.conversationView}
            onChange={(v) => setPref('conversationView', v)}
          />
          <InlineToggle
            title="Mark as read on open"
            description="Messages are marked read as soon as you open them."
            value={prefs.markReadOnOpen}
            onChange={(v) => setPref('markReadOnOpen', v)}
          />
        </View>
      </View>

      {/* Swipe actions */}
      <View style={styles.subsection}>
        <SectionHeader icon={ArrowBoxLeft_Stroke2_Corner0_Rounded} title="Swipe actions" />
        <View style={styles.swipeStack}>
          <SwipePicker
            label="Swipe right"
            value={prefs.leftSwipeAction}
            onChange={(v) => setPref('leftSwipeAction', v)}
          />
          <SwipePicker
            label="Swipe left"
            value={prefs.rightSwipeAction}
            onChange={(v) => setPref('rightSwipeAction', v)}
          />
        </View>
        <Text style={[styles.footnote, { color: colors.secondaryText }]}>
          Tap a row to cycle through Archive · Delete · Mark read · Snooze · None.
        </Text>
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
  toggleGroup: {
    gap: 4,
  },
  inlineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  inlineToggleText: {
    flex: 1,
    gap: 2,
  },
  inlineToggleTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  inlineToggleSub: {
    fontSize: 13,
    lineHeight: 17,
  },
  swipeStack: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  swipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swipeLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  swipeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  swipeValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  footnote: {
    fontSize: 12,
    paddingHorizontal: 2,
  },
});
