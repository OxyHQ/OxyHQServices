/**
 * Snooze picker overlay.
 *
 * Shows preset snooze times (Later today, Tomorrow, This weekend, Next week)
 * and an option to pick a custom date. Uses a modal overlay approach since
 * the inbox app doesn't have a bottom sheet library.
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Clock01Icon } from '@hugeicons/core-free-icons';
import { useColors } from '@/constants/theme';

interface SnoozeOption {
  label: string;
  sublabel: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  getDate: () => Date;
}

function getSnoozeOptions(): SnoozeOption[] {
  const now = new Date();

  // Later today: 3 hours from now (or 6 PM if < 3 PM)
  const laterToday = new Date(now);
  if (now.getHours() < 15) {
    laterToday.setHours(18, 0, 0, 0);
  } else {
    laterToday.setTime(laterToday.getTime() + 3 * 60 * 60 * 1000);
  }

  // Tomorrow morning: 9 AM
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  // This weekend: Saturday 9 AM
  const saturday = new Date(now);
  const dayOfWeek = saturday.getDay();
  const daysUntilSat = dayOfWeek === 6 ? 7 : (6 - dayOfWeek);
  saturday.setDate(saturday.getDate() + daysUntilSat);
  saturday.setHours(9, 0, 0, 0);

  // Next week: Monday 9 AM
  const monday = new Date(now);
  const daysUntilMon = dayOfWeek === 1 ? 7 : ((8 - dayOfWeek) % 7);
  monday.setDate(monday.getDate() + daysUntilMon);
  monday.setHours(9, 0, 0, 0);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const formatDay = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return [
    {
      label: 'Later today',
      sublabel: formatTime(laterToday),
      icon: 'weather-sunny',
      getDate: () => laterToday,
    },
    {
      label: 'Tomorrow',
      sublabel: `${formatDay(tomorrow)}, ${formatTime(tomorrow)}`,
      icon: 'weather-night',
      getDate: () => tomorrow,
    },
    {
      label: 'This weekend',
      sublabel: `${formatDay(saturday)}, ${formatTime(saturday)}`,
      icon: 'sofa-outline',
      getDate: () => saturday,
    },
    {
      label: 'Next week',
      sublabel: `${formatDay(monday)}, ${formatTime(monday)}`,
      icon: 'calendar-arrow-right',
      getDate: () => monday,
    },
  ];
}

interface SnoozeSheetProps {
  visible: boolean;
  onClose: () => void;
  onSnooze: (until: Date) => void;
}

export function SnoozeSheet({ visible, onClose, onSnooze }: SnoozeSheetProps) {
  const colors = useColors();
  const options = useMemo(getSnoozeOptions, []);

  const handleSelect = useCallback(
    (option: SnoozeOption) => {
      onSnooze(option.getDate());
      onClose();
    },
    [onSnooze, onClose],
  );

  if (!visible) return null;

  return (
    <>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            ...Platform.select({
              web: { boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' } as any,
              default: { elevation: 12 },
            }),
          },
        ]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Clock01Icon as unknown as IconSvgElement} size={20} color={colors.primary} />
          ) : (
            <MaterialCommunityIcons name="clock-outline" size={20} color={colors.primary} />
          )}
          <Text style={[styles.title, { color: colors.text }]}>Snooze until...</Text>
        </View>
        {options.map((option) => (
          <TouchableOpacity
            key={option.label}
            style={styles.option}
            onPress={() => handleSelect(option)}
            activeOpacity={0.6}
          >
            <MaterialCommunityIcons name={option.icon as any} size={20} color={colors.icon} />
            <View style={styles.optionText}>
              <Text style={[styles.optionLabel, { color: colors.text }]}>{option.label}</Text>
              <Text style={[styles.optionSublabel, { color: colors.secondaryText }]}>
                {option.sublabel}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 999,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingBottom: 24,
    zIndex: 1000,
    maxWidth: 400,
    ...Platform.select({
      web: { alignSelf: 'center', left: 'auto', right: 'auto' } as any,
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  optionSublabel: {
    fontSize: 12,
    marginTop: 1,
  },
});
