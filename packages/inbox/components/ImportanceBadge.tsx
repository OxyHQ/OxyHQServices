/**
 * Importance Badge component.
 *
 * Visual indicator for email importance/urgency.
 * Shows different badges: urgent, important, action needed, etc.
 */

import React, { useMemo } from 'react';
import { TouchableOpacity } from 'react-native';
import { Badge } from '@oxyhq/bloom/badge';

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
  color: 'error' | 'warning' | 'primary' | 'default';
}> = {
  urgent: {
    label: 'Urgent',
    color: 'error',
  },
  action: {
    label: 'Action needed',
    color: 'warning',
  },
  important: {
    label: 'Important',
    color: 'primary',
  },
  fyi: {
    label: 'FYI',
    color: 'default',
  },
};

export function ImportanceBadge({ message, onPress }: ImportanceBadgeProps) {
  const importance = useMemo(() => detectImportance(message), [message]);

  if (!importance) {
    return null;
  }

  const config = BADGE_CONFIG[importance];

  const badge = (
    <Badge
      variant="subtle"
      color={config.color}
      content={config.label}
      size="small"
    />
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {badge}
      </TouchableOpacity>
    );
  }

  return badge;
}
