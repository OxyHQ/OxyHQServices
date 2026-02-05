/**
 * Hook to detect commitments/promises in emails.
 *
 * Detects phrases like:
 * - "I'll send this by Friday"
 * - "I'll get back to you tomorrow"
 * - "Will follow up next week"
 * - "I'll have it ready by EOD"
 */

import { useMemo } from 'react';
import type { Message } from '@/services/emailApi';

export interface Commitment {
  type: 'deadline' | 'follow_up' | 'promise';
  text: string;
  deadline?: Date;
  deadlineText?: string;
  isPast: boolean;
  isUrgent: boolean; // Due within 24 hours
}

// Patterns for detecting commitments
const COMMITMENT_PATTERNS = [
  // "I'll/I will" promises
  { pattern: /\b(i['']?ll|i will)\s+(send|get|have|finish|complete|deliver|provide|share|forward)\b/gi, type: 'promise' as const },
  { pattern: /\b(i['']?ll|i will)\s+get\s+back\s+to\s+you\b/gi, type: 'follow_up' as const },
  { pattern: /\b(will|going to)\s+follow\s*up\b/gi, type: 'follow_up' as const },

  // Direct deadline mentions
  { pattern: /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, type: 'deadline' as const },
  { pattern: /\bby\s+(end\s+of\s+day|eod|close\s+of\s+business|cob|tonight|tomorrow|next\s+week)\b/gi, type: 'deadline' as const },
  { pattern: /\bbefore\s+(monday|tuesday|wednesday|thursday|friday|the\s+meeting|the\s+deadline)\b/gi, type: 'deadline' as const },
];

// Deadline text patterns and their relative dates
const DEADLINE_MAP: { pattern: RegExp; getDays: () => number }[] = [
  { pattern: /\b(today|tonight|eod|end\s+of\s+day)\b/i, getDays: () => 0 },
  { pattern: /\btomorrow\b/i, getDays: () => 1 },
  { pattern: /\bnext\s+week\b/i, getDays: () => 7 },
  { pattern: /\bmonday\b/i, getDays: () => getNextWeekday(1) },
  { pattern: /\btuesday\b/i, getDays: () => getNextWeekday(2) },
  { pattern: /\bwednesday\b/i, getDays: () => getNextWeekday(3) },
  { pattern: /\bthursday\b/i, getDays: () => getNextWeekday(4) },
  { pattern: /\bfriday\b/i, getDays: () => getNextWeekday(5) },
  { pattern: /\bsaturday\b/i, getDays: () => getNextWeekday(6) },
  { pattern: /\bsunday\b/i, getDays: () => getNextWeekday(0) },
];

function getNextWeekday(targetDay: number): number {
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  return daysUntil;
}

function parseDeadlineFromText(text: string, sentDate: Date): Date | undefined {
  for (const { pattern, getDays } of DEADLINE_MAP) {
    if (pattern.test(text)) {
      const deadline = new Date(sentDate);
      deadline.setDate(deadline.getDate() + getDays());
      deadline.setHours(23, 59, 59, 999);
      return deadline;
    }
  }
  return undefined;
}

function extractCommitments(message: Message): Commitment[] {
  const text = message.text || '';
  const commitments: Commitment[] = [];
  const sentDate = new Date(message.date);
  const now = new Date();

  for (const { pattern, type } of COMMITMENT_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const matchedText = match[0];

      // Look for deadline in surrounding context (50 chars around match)
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + matchedText.length + 50);
      const context = text.slice(start, end);

      const deadline = parseDeadlineFromText(context, sentDate);
      const isPast = deadline ? deadline < now : false;
      const isUrgent = deadline
        ? deadline.getTime() - now.getTime() < 24 * 60 * 60 * 1000 && !isPast
        : false;

      // Extract deadline text
      let deadlineText: string | undefined;
      for (const { pattern: dp } of DEADLINE_MAP) {
        const deadlineMatch = context.match(dp);
        if (deadlineMatch) {
          deadlineText = deadlineMatch[0];
          break;
        }
      }

      commitments.push({
        type,
        text: matchedText,
        deadline,
        deadlineText,
        isPast,
        isUrgent,
      });
    }
  }

  // Deduplicate by text
  const seen = new Set<string>();
  return commitments.filter((c) => {
    if (seen.has(c.text.toLowerCase())) return false;
    seen.add(c.text.toLowerCase());
    return true;
  });
}

/**
 * Detects commitments in a sent message.
 */
export function useCommitmentDetection(message: Message | null | undefined): Commitment[] {
  return useMemo(() => {
    if (!message) return [];
    return extractCommitments(message);
  }, [message?._id, message?.text]);
}

/**
 * Finds messages with upcoming or past-due commitments.
 */
export function useCommitmentReminders(
  sentMessages: Message[]
): { message: Message; commitments: Commitment[] }[] {
  return useMemo(() => {
    const results: { message: Message; commitments: Commitment[] }[] = [];

    for (const msg of sentMessages) {
      const commitments = extractCommitments(msg);
      // Only include if there are actionable commitments (urgent or past due)
      const actionable = commitments.filter((c) => c.isUrgent || c.isPast);
      if (actionable.length > 0) {
        results.push({ message: msg, commitments: actionable });
      }
    }

    // Sort by urgency (past due first, then by deadline)
    return results.sort((a, b) => {
      const aHasPast = a.commitments.some((c) => c.isPast);
      const bHasPast = b.commitments.some((c) => c.isPast);
      if (aHasPast && !bHasPast) return -1;
      if (!aHasPast && bHasPast) return 1;

      const aDeadline = a.commitments.find((c) => c.deadline)?.deadline;
      const bDeadline = b.commitments.find((c) => c.deadline)?.deadline;
      if (aDeadline && bDeadline) return aDeadline.getTime() - bDeadline.getTime();
      return 0;
    });
  }, [sentMessages]);
}
