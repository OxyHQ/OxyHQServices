/**
 * Hook to identify emails that need a response from the user.
 *
 * Uses simple heuristics to detect:
 * - Emails with question marks
 * - Emails asking for action/decision
 * - Emails that are unread and recent
 */

import { useMemo } from 'react';
import type { Message } from '@/services/emailApi';

interface UseNeedsResponseResult {
  messages: Message[];
  count: number;
}

// Patterns that suggest an email needs a response
const QUESTION_PATTERNS = [
  /\?\s*$/m,                    // Ends with question mark
  /could you/i,                 // Request patterns
  /would you/i,
  /can you/i,
  /please (let|send|confirm)/i,
  /waiting for (your|a) (response|reply)/i,
  /get back to (me|us)/i,
  /let me know/i,
  /thoughts\??$/i,
  /what do you think/i,
  /when can (you|we)/i,
  /rsvp/i,
  /confirm(ation)?/i,
  /deadline/i,
  /urgent/i,
  /asap/i,
];

// Patterns that suggest an email is just informational (no response needed)
const INFORMATIONAL_PATTERNS = [
  /no (reply|response) (needed|required)/i,
  /fyi/i,
  /for your (information|records)/i,
  /newsletter/i,
  /unsubscribe/i,
  /noreply|no-reply|donotreply/i,
];

function needsResponse(message: Message): boolean {
  // Skip already read emails (user probably handled it)
  if (message.flags.seen) return false;

  // Skip messages from no-reply addresses
  const fromAddress = message.from.address.toLowerCase();
  if (INFORMATIONAL_PATTERNS.some(p => p.test(fromAddress))) {
    return false;
  }

  const subject = message.subject || '';
  const text = message.text || '';
  const combined = `${subject} ${text}`.slice(0, 2000);

  // Skip if looks like informational
  if (INFORMATIONAL_PATTERNS.some(p => p.test(combined))) {
    return false;
  }

  // Check if contains question patterns
  const hasQuestion = QUESTION_PATTERNS.some(p => p.test(combined));
  if (hasQuestion) return true;

  // Count question marks as strong indicator
  const questionMarks = (combined.match(/\?/g) || []).length;
  if (questionMarks >= 2) return true;

  return false;
}

export function useNeedsResponse(
  messages: Message[] | undefined,
  limit = 5
): UseNeedsResponseResult {
  const result = useMemo(() => {
    if (!messages || messages.length === 0) {
      return { messages: [], count: 0 };
    }

    const filtered = messages.filter(needsResponse);

    // Sort by date descending (most recent first)
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return {
      messages: sorted.slice(0, limit),
      count: sorted.length,
    };
  }, [messages, limit]);

  return result;
}
