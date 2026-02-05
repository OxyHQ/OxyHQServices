/**
 * Hook to detect stale threads that need a response.
 *
 * Detects:
 * - Emails from others that haven't been replied to in X days
 * - Questions or requests that were never answered
 * - Threads where the user was the last recipient but hasn't responded
 */

import { useMemo } from 'react';
import type { Message } from '@/services/emailApi';

export interface StaleThreadInfo {
  isStale: boolean;
  daysSinceReceived: number;
  reason: 'unanswered_question' | 'no_reply' | 'awaiting_response';
  message: string;
}

const STALE_DAYS_THRESHOLD = 3;

// Patterns that indicate an email expects a response
const QUESTION_PATTERNS = [
  /\?$/m, // Ends with question mark
  /\b(please|could you|can you|would you|let me know)\b/i,
  /\b(what do you think|your thoughts|your opinion)\b/i,
  /\b(get back to me|reply|respond|answer)\b/i,
  /\b(waiting for|looking forward to hearing)\b/i,
];

function looksLikeQuestion(text: string): boolean {
  return QUESTION_PATTERNS.some((pattern) => pattern.test(text));
}

function getDaysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Detects if a thread is stale and needs attention.
 *
 * @param messages - All messages in the thread (sorted by date)
 * @param currentUserEmail - The current user's email address
 * @param staleThresholdDays - Number of days before considered stale (default: 3)
 */
export function useStaleThread(
  messages: Message[],
  currentUserEmail: string | undefined,
  staleThresholdDays = STALE_DAYS_THRESHOLD
): StaleThreadInfo | null {
  return useMemo(() => {
    if (!messages.length || !currentUserEmail) return null;

    // Sort by date (newest first)
    const sorted = [...messages].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const latestMessage = sorted[0];

    // If the latest message is FROM the current user, it's not stale (they already replied)
    const latestFromUser =
      latestMessage.from.address.toLowerCase() === currentUserEmail.toLowerCase();

    if (latestFromUser) {
      return null;
    }

    // Check if the latest message is addressed TO the user
    const isAddressedToUser = latestMessage.to.some(
      (addr) => addr.address.toLowerCase() === currentUserEmail.toLowerCase()
    ) || latestMessage.cc?.some(
      (addr) => addr.address.toLowerCase() === currentUserEmail.toLowerCase()
    );

    if (!isAddressedToUser) {
      return null;
    }

    const daysSince = getDaysSince(latestMessage.date);

    // Not stale yet
    if (daysSince < staleThresholdDays) {
      return null;
    }

    // Check if it looks like it needs a response
    const messageText = latestMessage.text || '';
    const hasQuestion = looksLikeQuestion(messageText);

    if (hasQuestion) {
      return {
        isStale: true,
        daysSinceReceived: daysSince,
        reason: 'unanswered_question',
        message:
          daysSince === 1
            ? 'This email has a question you haven\'t answered'
            : `This email has a question from ${daysSince} days ago`,
      };
    }

    // Generic stale thread
    return {
      isStale: true,
      daysSinceReceived: daysSince,
      reason: 'no_reply',
      message:
        daysSince === 1
          ? 'You haven\'t replied to this email yet'
          : `You haven\'t replied in ${daysSince} days`,
    };
  }, [messages, currentUserEmail, staleThresholdDays]);
}
