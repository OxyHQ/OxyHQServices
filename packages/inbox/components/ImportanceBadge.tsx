/**
 * Importance Badge component.
 *
 * Visual indicator for email importance/urgency.
 * Shows different badges: urgent, important, action needed, etc.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { Message } from '@/services/emailApi';

export type ImportanceLevel = 'urgent' | 'action' | 'important' | 'fyi' | null;

// Patterns to detect importance
const URGENT_PATTERNS = [
  /urgent/i,
  /asap/i,
  /immediately/i,
  /time.?sensitive/i,
  /deadline.?(today|tomorrow)/i,
  /need.{0,10}now/i,
];

const ACTION_PATTERNS = [
  /action.?required/i,
  /please.{0,15}(sign|approve|review|confirm)/i,
  /waiting for (your|a) (response|reply|approval)/i,
  /needs? your (attention|approval|signature)/i,
  /by (end of day|eod|cob|tomorrow|friday)/i,
];

const IMPORTANT_PATTERNS = [
  /important/i,
  /priority/i,
  /critical/i,
  /\[important\]/i,
];

export function detectImportance(message: Message): ImportanceLevel {
  const subject = message.subject || '';
  const text = (message.text || '').slice(0, 1000);
  const combined = `${subject} ${text}`;

  // Check urgent first (highest priority)
  if (URGENT_PATTERNS.some((p) => p.test(combined))) {
    return 'urgent';
  }

  // Then action required
  if (ACTION_PATTERNS.some((p) => p.test(combined))) {
    return 'action';
  }

  // Then general importance
  if (IMPORTANT_PATTERNS.some((p) => p.test(combined))) {
    return 'important';
  }

  return null;
}

interface ImportanceBadgeProps {
  message: Message;
  onPress?: () => void;
}

const BADGE_CONFIG: Record<Exclude<ImportanceLevel, null>, {
  label: string;
  icon: string;
  bgColor: string;
  textColor: string;
}> = {
  urgent: {
    label: 'Urgent',
    icon: 'alert-circle',
    bgColor: '#FFEBEE',
    textColor: '#D32F2F',
  },
  action: {
    label: 'Action needed',
    icon: 'checkbox-marked-circle-outline',
    bgColor: '#FFF3E0',
    textColor: '#E65100',
  },
  important: {
    label: 'Important',
    icon: 'star-circle',
    bgColor: '#E3F2FD',
    textColor: '#1565C0',
  },
  fyi: {
    label: 'FYI',
    icon: 'information',
    bgColor: '#F5F5F5',
    textColor: '#757575',
  },
};

export function ImportanceBadge({ message, onPress }: ImportanceBadgeProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const importance = useMemo(() => detectImportance(message), [message]);

  if (!importance) {
    return null;
  }

  const config = BADGE_CONFIG[importance];

  // Adjust colors for dark mode
  const bgColor = isDark ? config.textColor + '25' : config.bgColor;
  const textColor = isDark ? config.textColor : config.textColor;

  const content = (
    <View style={[styles.badge, { backgroundColor: bgColor }]}>
      <MaterialCommunityIcons
        name={config.icon as any}
        size={12}
        color={textColor}
      />
      <Text style={[styles.label, { color: textColor }]}>{config.label}</Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
