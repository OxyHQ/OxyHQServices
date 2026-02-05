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

import { useState, useCallback } from 'react';
import { aliaChatCompletion, streamAliaChatCompletion } from '@/services/aliaApi';

export type ComposeTone = 'professional' | 'casual' | 'friendly' | 'formal';

export interface AiComposeResult {
  text: string;
  subject?: string;
}

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const draft = useCallback(async (prompt: string, tone: ComposeTone = 'professional'): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await aliaChatCompletion({
        model: 'alia-lite',
        messages: [
          { role: 'system', content: DRAFT_SYSTEM_PROMPT },
          { role: 'user', content: `Tone: ${tone}\n\nWrite an email based on this:\n${prompt}` },
        ],
        maxTokens: 800,
        temperature: 0.7,
      });
      return result.trim();
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to draft email');
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const streamDraft = useCallback(async (
    prompt: string,
    tone: ComposeTone = 'professional',
    onChunk?: (chunk: string) => void
  ): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      let fullText = '';
      const generator = streamAliaChatCompletion({
        model: 'alia-lite',
        messages: [
          { role: 'system', content: DRAFT_SYSTEM_PROMPT },
          { role: 'user', content: `Tone: ${tone}\n\nWrite an email based on this:\n${prompt}` },
        ],
        maxTokens: 800,
        temperature: 0.7,
      });

      for await (const chunk of generator) {
        fullText += chunk;
        onChunk?.(fullText);
      }

      return fullText.trim();
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to draft email');
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const polish = useCallback(async (text: string): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await aliaChatCompletion({
        model: 'alia-lite',
        messages: [
          { role: 'system', content: POLISH_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        maxTokens: 1000,
        temperature: 0.5,
      });
      return result.trim();
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to polish email');
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const changeTone = useCallback(async (text: string, tone: ComposeTone): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await aliaChatCompletion({
        model: 'alia-lite',
        messages: [
          { role: 'system', content: TONE_SYSTEM_PROMPT },
          { role: 'user', content: `Rewrite this email in a ${tone} tone:\n\n${text}` },
        ],
        maxTokens: 1000,
        temperature: 0.6,
      });
      return result.trim();
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to change tone');
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const adjustLength = useCallback(async (text: string, direction: 'shorter' | 'longer'): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await aliaChatCompletion({
        model: 'alia-lite',
        messages: [
          { role: 'system', content: LENGTH_SYSTEM_PROMPT },
          { role: 'user', content: `Make this email ${direction}:\n\n${text}` },
        ],
        maxTokens: direction === 'longer' ? 1500 : 500,
        temperature: 0.5,
      });
      return result.trim();
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to adjust length');
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const suggestSubject = useCallback(async (body: string): Promise<string> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await aliaChatCompletion({
        model: 'alia-lite',
        messages: [
          { role: 'system', content: SUBJECT_SYSTEM_PROMPT },
          { role: 'user', content: body },
        ],
        maxTokens: 60,
        temperature: 0.6,
      });
      return result.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      const e = err instanceof Error ? err : new Error('Failed to suggest subject');
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    draft,
    streamDraft,
    polish,
    changeTone,
    adjustLength,
    suggestSubject,
    isLoading,
    error,
  };
}
