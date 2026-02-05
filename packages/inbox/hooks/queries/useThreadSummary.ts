/**
 * Hook to fetch AI-generated thread summary and action items.
 *
 * For threads with 4+ messages, uses Alia AI to generate:
 * - A concise summary of the conversation
 * - Key decisions made
 * - Action items extracted from the messages
 */

import { useQuery } from '@tanstack/react-query';
import { aliaChatCompletion } from '@/services/aliaApi';
import type { Message } from '@/services/emailApi';

export interface ThreadSummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: ActionItem[];
}

export interface ActionItem {
  text: string;
  owner?: string;
  deadline?: string;
}

const THREAD_SUMMARY_SYSTEM_PROMPT = `You are an AI email assistant. Analyze this email thread and provide a structured summary.

Output a JSON object with these fields:
- summary: A 2-3 sentence summary of what the conversation is about and its current state
- keyPoints: Array of 2-4 key points or decisions made (each under 15 words)
- actionItems: Array of action items extracted from the conversation. Each item should have:
  - text: The action to be taken
  - owner: Who is responsible (if mentioned), or null
  - deadline: Any deadline mentioned, or null

Rules:
- Focus on what's actionable and important
- Extract specific commitments made by participants
- Note any deadlines or time-sensitive items
- If no clear action items exist, return empty array
- Keep the summary concise and informative

Example output:
{
  "summary": "Discussion about Q4 budget planning. Sarah proposed $50K for marketing, Mike suggested reducing to $45K. Waiting for CEO approval before proceeding.",
  "keyPoints": [
    "Marketing budget proposal: $45-50K",
    "CEO approval required before implementation",
    "Timeline: Decision needed by end of week"
  ],
  "actionItems": [
    {"text": "Get CEO approval on budget", "owner": "Sarah", "deadline": "Friday"},
    {"text": "Prepare implementation timeline", "owner": "Mike", "deadline": null}
  ]
}`;

function buildThreadPrompt(messages: Message[]): string {
  // Sort by date, oldest first
  const sorted = [...messages].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const parts = sorted.map((msg, index) => {
    const from = msg.from.name || msg.from.address;
    const date = new Date(msg.date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const body = (msg.text || '').slice(0, 800);
    return `[Message ${index + 1}] From: ${from} | ${date}\n${body}`;
  });

  return parts.join('\n\n---\n\n');
}

async function fetchThreadSummary(messages: Message[]): Promise<ThreadSummaryResult> {
  const prompt = buildThreadPrompt(messages);

  try {
    const response = await aliaChatCompletion({
      model: 'alia-lite',
      messages: [
        { role: 'system', content: THREAD_SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: `Analyze this email thread:\n\n${prompt}` },
      ],
      maxTokens: 600,
      temperature: 0.5,
    });

    // Parse JSON from response
    const trimmed = response.trim();
    const jsonStr = trimmed.startsWith('```')
      ? trimmed.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      : trimmed;

    const parsed = JSON.parse(jsonStr);

    return {
      summary: parsed.summary || '',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item: any) => ({
            text: item.text || '',
            owner: item.owner || undefined,
            deadline: item.deadline || undefined,
          }))
        : [],
    };
  } catch (err) {
    console.warn('Thread summary generation failed:', err);
    return {
      summary: '',
      keyPoints: [],
      actionItems: [],
    };
  }
}

interface UseThreadSummaryOptions {
  enabled?: boolean;
  minMessages?: number;
}

export function useThreadSummary(
  messages: Message[] | undefined,
  options: UseThreadSummaryOptions = {}
) {
  const { enabled = true, minMessages = 4 } = options;
  const shouldFetch = enabled && messages && messages.length >= minMessages;

  const query = useQuery({
    queryKey: ['threadSummary', messages?.map((m) => m._id).join(',')],
    queryFn: () => fetchThreadSummary(messages!),
    enabled: shouldFetch,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  return {
    summary: query.data?.summary || '',
    keyPoints: query.data?.keyPoints || [],
    actionItems: query.data?.actionItems || [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
