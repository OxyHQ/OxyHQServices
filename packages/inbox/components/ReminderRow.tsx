/**
 * Reminder row for the inbox list.
 *
 * Displays as a distinct item in the inbox list alongside email messages.
 * Shows reminder text, time, and completion toggle.
 */

import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/constants/theme';
import type { Reminder } from '@/services/emailApi';

interface ReminderRowProps {
  reminder: Reminder;
  onToggleComplete: (reminderId: string, completed: boolean) => void;
  onPress: (reminderId: string) => void;
  onDelete: (reminderId: string) => void;
}

function formatReminderTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const reminderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((reminderDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (diffDays < 0) return `Overdue · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

export function ReminderRow({ reminder, onToggleComplete, onPress, onDelete }: ReminderRowProps) {
  const colors = useColors();

  const isOverdue = new Date(reminder.remindAt) < new Date() && !reminder.completed;
  const timeStr = formatReminderTime(reminder.remindAt);

  const handleToggle = useCallback(() => {
    onToggleComplete(reminder._id, !reminder.completed);
  }, [reminder._id, reminder.completed, onToggleComplete]);

  const handlePress = useCallback(() => {
    onPress(reminder._id);
  }, [reminder._id, onPress]);

  const handleDelete = useCallback(() => {
    onDelete(reminder._id);
  }, [reminder._id, onDelete]);

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.surface }]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <TouchableOpacity onPress={handleToggle} hitSlop={8} style={styles.checkbox}>
        <MaterialCommunityIcons
          name={reminder.completed ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={24}
          color={reminder.completed ? colors.success : isOverdue ? colors.danger : colors.primary}
        />
      </TouchableOpacity>

      <View style={styles.content}>
        <Text
          style={[
            styles.text,
            { color: colors.text },
            reminder.completed && styles.completedText,
            reminder.completed && { color: colors.secondaryText },
          ]}
          numberOfLines={2}
        >
          {reminder.text}
        </Text>
        <View style={styles.metaRow}>
          <MaterialCommunityIcons
            name="bell-outline"
            size={12}
            color={isOverdue ? colors.danger : colors.secondaryText}
          />
          <Text
            style={[
              styles.time,
              { color: isOverdue ? colors.danger : colors.secondaryText },
            ]}
          >
            {timeStr}
          </Text>
          {reminder.pinned && (
            <MaterialCommunityIcons name="pin" size={12} color={colors.primary} />
          )}
        </View>
      </View>

      <TouchableOpacity onPress={handleDelete} hitSlop={8} style={styles.deleteButton}>
        <MaterialCommunityIcons name="close" size={16} color={colors.secondaryText} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  checkbox: {
    padding: 2,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  text: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  completedText: {
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  time: {
    fontSize: 12,
    flex: 1,
  },
  deleteButton: {
    padding: 4,
  },
});
