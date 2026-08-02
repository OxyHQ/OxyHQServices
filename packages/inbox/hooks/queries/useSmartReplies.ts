/**
 * Hook to fetch AI-generated smart reply suggestions for an email.
 *
 * Uses Alia AI to generate 3 contextual one-tap reply options based on
 * the email content and conversation history.
 */

import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type { OxyServices } from '@oxyhq/core';
import { aliaChatCompletion } from '@/services/aliaApi';
import { aiKeys } from '@/hooks/queries/queryKeys';
import { parseLlmJson, SmartRepliesSchema } from '@/schemas/aiSchemas';
import type { Message } from '@/services/emailApi';

type HttpService = OxyServices['httpService'];

interface SmartRepliesResult {
  replies: string[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const SMART_REPLY_SYSTEM_PROMPT = `You are an AI email assistant. Generate 3 short, contextual reply suggestions for the email below. Each reply should be:
- 2-8 words maximum
- Natural and conversational
- Appropriate for the email's tone and content
- Ready to send as-is (no placeholders)

Respond ONLY with a JSON array of exactly 3 strings, nothing else.
Example: ["Sounds good!", "Let me check and get back to you", "I'm not available then"]

Rules:
- For meeting requests: suggest accepting, declining, or asking for details
- For questions: suggest brief answers or promises to follow up
- For FYI/newsletters: suggest acknowledgment or thanks
- For urgent emails: acknowledge urgency
- Skip if email appears to be a no-reply, automated, or marketing email
- Skip if email is about passwords, banking, or sensitive information`;

function getMessageBody(message: Message): string {
  const body = message.text || message.html || '';
  return body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(message: Message): string {
  const from = message.from.name || message.from.address;
  const subject = message.subject || '(no subject)';
  const body = getMessageBody(message).slice(0, 1500);

  return `From: ${from}
Subject: ${subject}

${body}`;
}

function shouldSkipSmartReplies(message: Message): boolean {
  const from = message.from.address.toLowerCase();
  const subject = (message.subject || '').toLowerCase();
  const body = getMessageBody(message).toLowerCase();

  // Skip no-reply addresses
  if (from.includes('noreply') || from.includes('no-reply') || from.includes('donotreply')) {
    return true;
  }

  // Skip marketing/newsletter patterns
  if (from.includes('newsletter') || from.includes('marketing') || from.includes('promo')) {
    return true;
  }

  // Skip sensitive topics before any body content can be sent to the AI service.
  const sensitiveText = `${subject} ${body}`;
  const sensitiveKeywords = [
    'password',
    'passcode',
    'one-time code',
    'one time code',
    'otp',
    '2fa',
    'mfa',
    'verification code',
    'security code',
    'reset',
    'verify your',
    'confirm your account',
    'banking',
    'transaction',
    'invoice',
    'payment',
    'credit card',
    'ssn',
    'social security',
  ];
  if (sensitiveKeywords.some((kw) => sensitiveText.includes(kw))) {
    return true;
  }

  const sensitivePatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/, // US SSN
    /\b(?:\d[ -]*?){13,19}\b/, // payment-card-like numbers
    /\b(?:code|pin|otp)\s*[:#-]?\s*\d{4,8}\b/i,
    /\b\d{6}\b.*\b(?:code|pin|otp|verify|verification)\b/i,
  ];

  return sensitivePatterns.some((pattern) => pattern.test(sensitiveText));
}

async function fetchSmartReplies(message: Message, http: HttpService): Promise<string[]> {
  if (shouldSkipSmartReplies(message)) {
    return [];
  }

  const prompt = buildPrompt(message);

  try {
    const response = await aliaChatCompletion(http, {
      model: 'alia-lite',
      messages: [
        { role: 'system', content: SMART_REPLY_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      maxTokens: 150,
      temperature: 0.7,
    });

    // Validate the model's JSON array; a malformed response yields no replies.
    const parsed = parseLlmJson(response, SmartRepliesSchema);
    if (!parsed || parsed.length === 0) {
      return [];
    }

    // Clean replies: trim, drop empties, cap at 3 and 80 chars.
    return parsed
      .slice(0, 3)
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && r.length <= 80);
  } catch {
    return [];
  }
}

export function useSmartReplies(message: Message | null | undefined): SmartRepliesResult {
  const { oxyServices } = useOxy();

  const query = useQuery({
    queryKey: aiKeys.smartReplies(message?._id),
    queryFn: () => fetchSmartReplies(message!, oxyServices.httpService),
    enabled: false,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
    retry: false, // Don't retry on failure
  });

  return {
    replies: query.data ?? [],
    isLoading: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
