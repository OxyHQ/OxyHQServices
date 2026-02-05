/**
 * Follow-up Reminder component.
 *
 * Shows reminders for:
 * - Commitments/promises made in sent emails that are due soon or past due
 * - Sent emails that haven't received a reply
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Alert01Icon, Clock01Icon, CheckmarkCircle01Icon } from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { Commitment } from '@/hooks/queries/useCommitmentDetection';
import type { Message } from '@/services/emailApi';

interface FollowUpReminderProps {
  message: Message;
  commitments: Commitment[];
  onView?: () => void;
  onMarkDone?: () => void;
}

function formatDeadline(deadline: Date, isPast: boolean): string {
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (isPast) {
    const pastDays = Math.abs(diffDays);
    if (pastDays === 0) return 'Due today';
    if (pastDays === 1) return 'Overdue by 1 day';
    return `Overdue by ${pastDays} days`;
  }

  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  return `Due in ${diffDays} days`;
}

export function FollowUpReminder({
  message,
  commitments,
  onView,
  onMarkDone,
}: FollowUpReminderProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  // Get the most urgent commitment
  const urgentCommitment = commitments.find((c) => c.isPast) || commitments.find((c) => c.isUrgent) || commitments[0];

  if (!urgentCommitment) return null;

  const isPastDue = urgentCommitment.isPast;
  const accentColor = isPastDue ? '#E53935' : '#FF9800';
  const bgColor = accentColor + '08';
  const borderColor = accentColor + '25';

  const senderName = message.to[0]?.name || message.to[0]?.address.split('@')[0] || 'someone';
  const deadlineDisplay = urgentCommitment.deadline
    ? formatDeadline(urgentCommitment.deadline, isPastDue)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: bgColor, borderColor }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: accentColor + '15' }]}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={(isPastDue ? Alert01Icon : Clock01Icon) as unknown as IconSvgElement}
              size={16}
              color={accentColor}
            />
          ) : (
            <MaterialCommunityIcons
              name={isPastDue ? 'alert-circle-outline' : 'clock-outline'}
              size={16}
              color={accentColor}
            />
          )}
        </View>

        <View style={styles.textContent}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {isPastDue ? 'Past due commitment' : 'Upcoming commitment'}
          </Text>
          <Text style={[styles.description, { color: colors.secondaryText }]} numberOfLines={2}>
            You said "{urgentCommitment.text}" to {senderName}
            {deadlineDisplay ? ` • ${deadlineDisplay}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {onView && (
          <TouchableOpacity
            style={[styles.button, styles.viewButton, { borderColor: colors.border }]}
            onPress={onView}
            activeOpacity={0.7}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>View</Text>
          </TouchableOpacity>
        )}
        {onMarkDone && (
          <TouchableOpacity
            style={[styles.button, styles.doneButton, { backgroundColor: accentColor }]}
            onPress={onMarkDone}
            activeOpacity={0.8}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon as unknown as IconSvgElement}
                size={14}
                color="#FFFFFF"
              />
            ) : (
              <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
            )}
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContent: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  viewButton: {
    borderWidth: 1,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
