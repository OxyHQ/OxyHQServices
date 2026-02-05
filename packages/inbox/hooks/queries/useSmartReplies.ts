/**
 * Hook to fetch AI-generated smart reply suggestions for an email.
 *
 * Uses Alia AI to generate 3 contextual one-tap reply options based on
 * the email content and conversation history.
 */

import { useQuery } from '@tanstack/react-query';
import { aliaChatCompletion } from '@/services/aliaApi';
import type { Message } from '@/services/emailApi';

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

function buildPrompt(message: Message): string {
  const from = message.from.name || message.from.address;
  const subject = message.subject || '(no subject)';
  const body = message.text?.slice(0, 1500) || message.html?.slice(0, 1500) || '';

  return `From: ${from}
Subject: ${subject}

${body}`;
}

function shouldSkipSmartReplies(message: Message): boolean {
  const from = message.from.address.toLowerCase();
  const subject = (message.subject || '').toLowerCase();

  // Skip no-reply addresses
  if (from.includes('noreply') || from.includes('no-reply') || from.includes('donotreply')) {
    return true;
  }

  // Skip marketing/newsletter patterns
  if (from.includes('newsletter') || from.includes('marketing') || from.includes('promo')) {
    return true;
  }

  // Skip sensitive topics
  const sensitiveKeywords = ['password', 'reset', 'verify your', 'confirm your account', 'banking', 'transaction'];
  if (sensitiveKeywords.some((kw) => subject.includes(kw))) {
    return true;
  }

  return false;
}

async function fetchSmartReplies(message: Message): Promise<string[]> {
  if (shouldSkipSmartReplies(message)) {
    return [];
  }

  const prompt = buildPrompt(message);

  try {
    const response = await aliaChatCompletion({
      model: 'alia-lite',
      messages: [
        { role: 'system', content: SMART_REPLY_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      maxTokens: 150,
      temperature: 0.7,
    });

    // Parse JSON array from response
    const trimmed = response.trim();
    // Handle potential markdown code blocks
    const jsonStr = trimmed.startsWith('```')
      ? trimmed.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      : trimmed;

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }

    // Filter and clean replies
    return parsed
      .slice(0, 3)
      .map((r: unknown) => (typeof r === 'string' ? r.trim() : ''))
      .filter((r: string) => r.length > 0 && r.length <= 80);
  } catch (err) {
    console.warn('Smart replies generation failed:', err);
    return [];
  }
}

export function useSmartReplies(message: Message | null | undefined): SmartRepliesResult {
  const query = useQuery({
    queryKey: ['smartReplies', message?._id],
    queryFn: () => fetchSmartReplies(message!),
    enabled: !!message,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,
    retry: false, // Don't retry on failure
  });

  return {
    replies: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
