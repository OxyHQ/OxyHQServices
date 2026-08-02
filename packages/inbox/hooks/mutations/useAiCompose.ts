/**
 * Hook for AI-powered email composition assistance.
 *
 * Provides functions to:
 * - Draft an email from bullet points/prompt
 * - Polish/improve existing text
 * - Adjust length (shorter/longer)
 * - Change tone (professional, casual, friendly, formal)
 * - Generate subject line suggestions
 */

import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { aliaChatCompletion, streamAliaChatCompletion } from '@/services/aliaApi';
import { aiKeys } from '@/hooks/queries/queryKeys';

export type ComposeTone = 'professional' | 'casual' | 'friendly' | 'formal';

export interface AiComposeResult {
  text: string;
  subject?: string;
}

/**
 * Discriminated union of every AI compose operation. All operations share a
 * single `useMutation` so they get one uniform `isLoading` / `error` state —
 * this replaces the former ad-hoc `useState` bookkeeping.
 */
type ComposeOperation =
  | { kind: 'draft'; prompt: string; tone: ComposeTone }
  | { kind: 'streamDraft'; prompt: string; tone: ComposeTone; onChunk?: (text: string) => void }
  | { kind: 'polish'; text: string }
  | { kind: 'changeTone'; text: string; tone: ComposeTone }
  | { kind: 'adjustLength'; text: string; direction: 'shorter' | 'longer' }
  | { kind: 'suggestSubject'; body: string };

const DRAFT_SYSTEM_PROMPT = `You are an AI email assistant. Write a complete, well-structured email based on the user's prompt or bullet points.

Rules:
- Write natural, conversational email text
- Match the requested tone (default: professional but friendly)
- Include appropriate greeting and sign-off unless specified otherwise
- Keep it concise but complete
- Do NOT include subject line in the body

Output ONLY the email body text, nothing else.`;

const POLISH_SYSTEM_PROMPT = `You are an AI email assistant. Improve the email text provided by fixing grammar, improving clarity, and making it more polished while preserving the original meaning and intent.

Rules:
- Fix grammatical and spelling errors
- Improve sentence structure and flow
- Maintain the original tone and meaning
- Keep approximately the same length
- Do NOT change greetings or sign-offs dramatically

Output ONLY the polished email text, nothing else.`;

const TONE_SYSTEM_PROMPT = `You are an AI email assistant. Rewrite the email in the specified tone while preserving the core message.

Tones:
- professional: Business-appropriate, formal but not stiff
- casual: Relaxed, conversational, like writing to a colleague
- friendly: Warm, personable, approachable
- formal: Very professional, appropriate for executives or official communication

Output ONLY the rewritten email text, nothing else.`;

const LENGTH_SYSTEM_PROMPT = `You are an AI email assistant. Rewrite the email to be SHORTER or LONGER as specified while preserving the key message.

Rules:
- If "shorter": Remove unnecessary words, combine sentences, be more direct. Aim for 30-50% reduction.
- If "longer": Add appropriate detail, examples, or context. Aim for 50-100% increase.
- Preserve the core message and tone
- Keep greetings and sign-offs

Output ONLY the rewritten email text, nothing else.`;

const SUBJECT_SYSTEM_PROMPT = `You are an AI email assistant. Generate a clear, concise email subject line based on the email body.

Rules:
- Keep it under 60 characters
- Be specific and descriptive
- Don't use clickbait or ALL CAPS
- Match the tone of the email

Output ONLY the subject line text, nothing else (no quotes).`;

interface UseAiComposeReturn {
  // Draft a new email from prompt
  draft: (prompt: string, tone?: ComposeTone) => Promise<string>;
  // Polish/improve existing text
  polish: (text: string) => Promise<string>;
  // Change tone of text
  changeTone: (text: string, tone: ComposeTone) => Promise<string>;
  // Make shorter or longer
  adjustLength: (text: string, direction: 'shorter' | 'longer') => Promise<string>;
  // Generate subject from body
  suggestSubject: (body: string) => Promise<string>;
  // Streaming draft for typewriter effect
  streamDraft: (prompt: string, tone?: ComposeTone, onChunk?: (chunk: string) => void) => Promise<string>;
  // Loading state
  isLoading: boolean;
  // Error state
  error: Error | null;
}

export function useAiCompose(): UseAiComposeReturn {
  const { oxyServices } = useOxy();

  const mutation = useMutation<string, Error, ComposeOperation>({
    mutationKey: aiKeys.compose,
    mutationFn: async (op) => {
      const http = oxyServices.httpService;
      switch (op.kind) {
        case 'draft': {
          const result = await aliaChatCompletion(http, {
            model: 'alia-lite',
            messages: [
              { role: 'system', content: DRAFT_SYSTEM_PROMPT },
              { role: 'user', content: `Tone: ${op.tone}\n\nWrite an email based on this:\n${op.prompt}` },
            ],
            maxTokens: 800,
            temperature: 0.7,
          });
          return result.trim();
        }
        case 'streamDraft': {
          // Streaming lives inside the mutation: chunks are delivered via the
          // `onChunk` callback while the mutation stays `pending`, and the full
          // text is returned once the stream completes.
          let fullText = '';
          for await (const chunk of streamAliaChatCompletion(http, {
            model: 'alia-lite',
            messages: [
              { role: 'system', content: DRAFT_SYSTEM_PROMPT },
              { role: 'user', content: `Tone: ${op.tone}\n\nWrite an email based on this:\n${op.prompt}` },
            ],
            maxTokens: 800,
            temperature: 0.7,
          })) {
            fullText += chunk;
            op.onChunk?.(fullText);
          }
          return fullText.trim();
        }
        case 'polish': {
          const result = await aliaChatCompletion(http, {
            model: 'alia-lite',
            messages: [
              { role: 'system', content: POLISH_SYSTEM_PROMPT },
              { role: 'user', content: op.text },
            ],
            maxTokens: 1000,
            temperature: 0.5,
          });
          return result.trim();
        }
        case 'changeTone': {
          const result = await aliaChatCompletion(http, {
            model: 'alia-lite',
            messages: [
              { role: 'system', content: TONE_SYSTEM_PROMPT },
              { role: 'user', content: `Rewrite this email in a ${op.tone} tone:\n\n${op.text}` },
            ],
            maxTokens: 1000,
            temperature: 0.6,
          });
          return result.trim();
        }
        case 'adjustLength': {
          const result = await aliaChatCompletion(http, {
            model: 'alia-lite',
            messages: [
              { role: 'system', content: LENGTH_SYSTEM_PROMPT },
              { role: 'user', content: `Make this email ${op.direction}:\n\n${op.text}` },
            ],
            maxTokens: op.direction === 'longer' ? 1500 : 500,
            temperature: 0.5,
          });
          return result.trim();
        }
        case 'suggestSubject': {
          const result = await aliaChatCompletion(http, {
            model: 'alia-lite',
            messages: [
              { role: 'system', content: SUBJECT_SYSTEM_PROMPT },
              { role: 'user', content: op.body },
            ],
            maxTokens: 60,
            temperature: 0.6,
          });
          return result.trim().replace(/^["']|["']$/g, '');
        }
      }
    },
  });

  const { mutateAsync } = mutation;

  const draft = useCallback(
    (prompt: string, tone: ComposeTone = 'professional') =>
      mutateAsync({ kind: 'draft', prompt, tone }),
    [mutateAsync],
  );

  const streamDraft = useCallback(
    (prompt: string, tone: ComposeTone = 'professional', onChunk?: (chunk: string) => void) =>
      mutateAsync({ kind: 'streamDraft', prompt, tone, onChunk }),
    [mutateAsync],
  );

  const polish = useCallback(
    (text: string) => mutateAsync({ kind: 'polish', text }),
    [mutateAsync],
  );

  const changeTone = useCallback(
    (text: string, tone: ComposeTone) => mutateAsync({ kind: 'changeTone', text, tone }),
    [mutateAsync],
  );

  const adjustLength = useCallback(
    (text: string, direction: 'shorter' | 'longer') =>
      mutateAsync({ kind: 'adjustLength', text, direction }),
    [mutateAsync],
  );

  const suggestSubject = useCallback(
    (body: string) => mutateAsync({ kind: 'suggestSubject', body }),
    [mutateAsync],
  );

  return {
    draft,
    streamDraft,
    polish,
    changeTone,
    adjustLength,
    suggestSubject,
    isLoading: mutation.isPending,
    error: mutation.error,
  };
}
