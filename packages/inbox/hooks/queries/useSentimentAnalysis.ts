/**
 * Hook for analyzing email sentiment/tone.
 *
 * Detects emotional indicators in emails:
 * - Urgency level (deadline mentions, urgent language)
 * - Frustration signals (negative tone, escalation)
 * - Positive tone (appreciation, agreement)
 * - Formal vs casual tone
 */

import { useMemo } from 'react';
import type { Message } from '@/services/emailApi';

export type SentimentType = 'urgent' | 'frustrated' | 'positive' | 'neutral' | 'formal' | 'request';

export interface SentimentResult {
  type: SentimentType;
  confidence: number; // 0-1
  label: string;
  icon: string;
  color: string;
}

// Pattern-based sentiment detection (fast, no AI)
const URGENCY_PATTERNS = [
  /\b(asap|urgent|immediately|right away|right now)\b/i,
  /\b(deadline|due today|due tomorrow|eod|end of day)\b/i,
  /\b(time.?sensitive|critical|emergency|crisis)\b/i,
  /\b(need.{0,10}(today|now|immediately|asap))\b/i,
  /!{2,}/,
  /\b(please.{0,5}respond.{0,10}(quickly|soon|asap|today))\b/i,
];

const FRUSTRATION_PATTERNS = [
  /\b(still waiting|no response|haven't heard)\b/i,
  /\b(disappointed|frustrated|unacceptable)\b/i,
  /\b(again|already asked|repeatedly)\b/i,
  /\b(escalate|manager|supervisor)\b/i,
  /\b(this is the (second|third|\d+).{0,10}time)\b/i,
  /\b(follow.?up).{0,20}(again|still|no response)/i,
];

const POSITIVE_PATTERNS = [
  /\b(thank you|thanks so much|appreciate|grateful)\b/i,
  /\b(great work|well done|excellent|fantastic|awesome)\b/i,
  /\b(love it|perfect|exactly what|happy (to|with))\b/i,
  /\b(congratulations|congrats)\b/i,
  /\b(looking forward to|excited about)\b/i,
];

const REQUEST_PATTERNS = [
  /\b(could you|can you|would you|please)\b/i,
  /\b(let me know|send me|share|provide)\b/i,
  /\b(need.{0,10}(your|you to|the))\b/i,
  /\b(would appreciate|would be great)\b/i,
  /\?/g, // Multiple questions
];

const FORMAL_PATTERNS = [
  /\b(dear|sincerely|regards|respectfully)\b/i,
  /\b(pursuant to|as per|in accordance|hereby)\b/i,
  /\b(please be advised|kindly|for your reference)\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => {
    const matches = text.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
}

function detectSentiment(message: Message): SentimentResult | null {
  const text = `${message.subject || ''} ${message.text || ''}`.toLowerCase();

  if (text.length < 10) return null;

  // Calculate scores for each sentiment type
  const urgencyScore = countMatches(text, URGENCY_PATTERNS);
  const frustrationScore = countMatches(text, FRUSTRATION_PATTERNS);
  const positiveScore = countMatches(text, POSITIVE_PATTERNS);
  const requestScore = countMatches(text, REQUEST_PATTERNS);
  const formalScore = countMatches(text, FORMAL_PATTERNS);

  // Normalize scores (rough heuristic)
  const textLength = text.length / 100; // Per 100 chars
  const normalizedUrgency = urgencyScore / Math.max(textLength, 1);
  const normalizedFrustration = frustrationScore / Math.max(textLength, 1);
  const normalizedPositive = positiveScore / Math.max(textLength, 1);

  // Return highest confidence sentiment
  if (urgencyScore >= 2 || normalizedUrgency > 0.5) {
    return {
      type: 'urgent',
      confidence: Math.min(urgencyScore / 3, 1),
      label: 'Urgent',
      icon: 'alert-circle',
      color: '#E53935', // Red
    };
  }

  if (frustrationScore >= 2 || normalizedFrustration > 0.3) {
    return {
      type: 'frustrated',
      confidence: Math.min(frustrationScore / 3, 1),
      label: 'Needs attention',
      icon: 'alert',
      color: '#FF9800', // Orange
    };
  }

  if (positiveScore >= 2 || normalizedPositive > 0.4) {
    return {
      type: 'positive',
      confidence: Math.min(positiveScore / 3, 1),
      label: 'Positive',
      icon: 'emoticon-happy-outline',
      color: '#4CAF50', // Green
    };
  }

  // Check for formal tone (less prominent, only show if very formal)
  if (formalScore >= 2) {
    return {
      type: 'formal',
      confidence: Math.min(formalScore / 3, 1),
      label: 'Formal',
      icon: 'tie',
      color: '#607D8B', // Gray-blue
    };
  }

  // Check if it's primarily a request (multiple questions or request phrases)
  if (requestScore >= 3) {
    return {
      type: 'request',
      confidence: Math.min(requestScore / 5, 1),
      label: 'Action requested',
      icon: 'hand-pointing-right',
      color: '#2196F3', // Blue
    };
  }

  return null;
}

/**
 * Hook to analyze sentiment of a single message.
 */
export function useSentimentAnalysis(message: Message | null | undefined): SentimentResult | null {
  return useMemo(() => {
    if (!message) return null;
    return detectSentiment(message);
  }, [message?._id, message?.subject, message?.text]);
}

/**
 * Hook to analyze sentiment of multiple messages (e.g., for list views).
 * Returns a map of messageId -> sentiment.
 */
export function useBatchSentimentAnalysis(
  messages: Message[]
): Map<string, SentimentResult> {
  return useMemo(() => {
    const results = new Map<string, SentimentResult>();
    for (const msg of messages) {
      const sentiment = detectSentiment(msg);
      if (sentiment) {
        results.set(msg._id, sentiment);
      }
    }
    return results;
  }, [messages]);
}
