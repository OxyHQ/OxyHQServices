/**
 * Bottom sheet / modal for creating a reminder.
 * Shows a text input and time picker with presets.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface CreateReminderSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (text: string, remindAt: Date) => void;
  relatedMessageId?: string;
}

function getPresetTimes(): Array<{ label: string; date: Date; icon: string }> {
  const now = new Date();
  const presets: Array<{ label: string; date: Date; icon: string }> = [];

  // Later today (6 PM or +3h)
  const laterToday = new Date(now);
  laterToday.setHours(Math.max(now.getHours() + 3, 18), 0, 0, 0);
  if (laterToday.getDate() === now.getDate()) {
    presets.push({ label: 'Later today', date: laterToday, icon: 'weather-sunset' });
  }

  // Tomorrow 9 AM
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  presets.push({ label: 'Tomorrow morning', date: tomorrow, icon: 'weather-sunny' });

  // This weekend (Saturday 9 AM)
  const saturday = new Date(now);
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7 || 7));
  saturday.setHours(9, 0, 0, 0);
  if (saturday > now) {
    presets.push({ label: 'This weekend', date: saturday, icon: 'calendar-weekend' });
  }

  // Next week (Monday 9 AM)
  const monday = new Date(now);
  monday.setDate(monday.getDate() + ((1 - monday.getDay() + 7) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  presets.push({ label: 'Next week', date: monday, icon: 'calendar-arrow-right' });

  return presets;
}

export function CreateReminderSheet({ visible, onClose, onCreate }: CreateReminderSheetProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const [text, setText] = useState('');
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);

  const presets = useMemo(() => getPresetTimes(), []);

  const handleCreate = useCallback(() => {
    if (!text.trim() || !selectedTime) return;
    onCreate(text.trim(), selectedTime);
    setText('');
    setSelectedTime(null);
  }, [text, selectedTime, onCreate]);

  const handleClose = useCallback(() => {
    setText('');
    setSelectedTime(null);
    onClose();
  }, [onClose]);

  if (!visible) return null;

  const canSubmit = text.trim().length > 0 && selectedTime !== null;

  return (
    <Pressable style={styles.backdrop} onPress={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <MaterialCommunityIcons name="bell-plus-outline" size={20} color={colors.primary} />
            <Text style={[styles.title, { color: colors.text }]}>Create reminder</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={colors.secondaryText} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            placeholder="What do you want to be reminded about?"
            placeholderTextColor={colors.secondaryText}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
            autoFocus
          />

          <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>When?</Text>
          <View style={styles.presets}>
            {presets.map((preset) => {
              const isSelected = selectedTime?.getTime() === preset.date.getTime();
              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[
                    styles.presetButton,
                    { borderColor: isSelected ? colors.primary : colors.border },
                    isSelected && { backgroundColor: colors.primary + '15' },
                  ]}
                  onPress={() => setSelectedTime(preset.date)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={preset.icon as any}
                    size={16}
                    color={isSelected ? colors.primary : colors.secondaryText}
                  />
                  <Text
                    style={[
                      styles.presetLabel,
                      { color: isSelected ? colors.primary : colors.text },
                    ]}
                  >
                    {preset.label}
                  </Text>
                  <Text
                    style={[
                      styles.presetTime,
                      { color: isSelected ? colors.primary : colors.secondaryText },
                    ]}
                  >
                    {preset.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[
              styles.createButton,
              { backgroundColor: canSubmit ? colors.primary : colors.border },
            ]}
            onPress={handleCreate}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            <Text style={[styles.createButtonText, { color: canSubmit ? '#fff' : colors.secondaryText }]}>
              Create reminder
            </Text>
          </TouchableOpacity>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    zIndex: 200,
  },
  keyboardView: {
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 16,
    ...Platform.select({
      web: { maxWidth: 480, alignSelf: 'center', width: '100%', borderRadius: 16, marginBottom: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' } as any,
      default: {},
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  presets: {
    gap: 8,
  },
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  presetLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  presetTime: {
    fontSize: 12,
  },
  createButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
