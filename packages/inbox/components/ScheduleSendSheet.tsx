/**
 * Schedule Send picker overlay.
 *
 * Shows preset schedule times (Later today, Tomorrow morning, Tomorrow afternoon,
 * Monday morning) and an option to pick a custom date.
 * Uses Bloom BottomSheet with gesture dismissal and animated transitions.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { BottomSheet, type BottomSheetRef } from '@oxyhq/bloom/bottom-sheet';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Clock01Icon } from '@hugeicons/core-free-icons';
import { useColors } from '@/constants/theme';

interface ScheduleOption {
  label: string;
  sublabel: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  getDate: () => Date;
}

function getScheduleOptions(): ScheduleOption[] {
  const now = new Date();

  // Later today: 3 hours from now (or 6 PM if < 3 PM)
  const laterToday = new Date(now);
  if (now.getHours() < 15) {
    laterToday.setHours(18, 0, 0, 0);
  } else {
    laterToday.setTime(laterToday.getTime() + 3 * 60 * 60 * 1000);
  }

  // Tomorrow morning: 8 AM
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);

  // Tomorrow afternoon: 1 PM
  const tomorrowAfternoon = new Date(now);
  tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
  tomorrowAfternoon.setHours(13, 0, 0, 0);

  // Monday morning: next Monday 8 AM
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  const daysUntilMon = dayOfWeek === 1 ? 7 : ((8 - dayOfWeek) % 7);
  monday.setDate(monday.getDate() + daysUntilMon);
  monday.setHours(8, 0, 0, 0);

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
      label: 'Tomorrow morning',
      sublabel: `${formatDay(tomorrowMorning)}, ${formatTime(tomorrowMorning)}`,
      icon: 'weather-sunset-up',
      getDate: () => tomorrowMorning,
    },
    {
      label: 'Tomorrow afternoon',
      sublabel: `${formatDay(tomorrowAfternoon)}, ${formatTime(tomorrowAfternoon)}`,
      icon: 'weather-sunny',
      getDate: () => tomorrowAfternoon,
    },
    {
      label: 'Monday morning',
      sublabel: `${formatDay(monday)}, ${formatTime(monday)}`,
      icon: 'calendar-arrow-right',
      getDate: () => monday,
    },
  ];
}

interface ScheduleSendSheetProps {
  visible: boolean;
  onClose: () => void;
  onSchedule: (date: Date) => void;
}

export function ScheduleSendSheet({ visible, onClose, onSchedule }: ScheduleSendSheetProps) {
  const colors = useColors();
  const options = useMemo(getScheduleOptions, []);
  const sheetRef = useRef<BottomSheetRef>(null);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handleSelect = useCallback(
    (option: ScheduleOption) => {
      onSchedule(option.getDate());
      onClose();
    },
    [onSchedule, onClose],
  );

  return (
    <BottomSheet ref={sheetRef} onDismiss={onClose} detached>
      <View style={styles.content}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Clock01Icon as unknown as IconSvgElement} size={20} color={colors.primary} />
          ) : (
            <MaterialCommunityIcons name="clock-outline" size={20} color={colors.primary} />
          )}
          <Text style={[styles.title, { color: colors.text }]}>Schedule send</Text>
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
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
