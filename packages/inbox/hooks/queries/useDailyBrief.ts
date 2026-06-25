/**
 * Hook that generates an opt-in daily AI brief from non-content email counts.
 *
 * Streams the response for a typing effect and caches the result
 * so it's not regenerated on every screen visit.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { streamAliaChatCompletion, type AliaMessage } from '@/services/aliaApi';
import type { Message } from '@/services/emailApi';

const BRIEF_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const SYSTEM_PROMPT = `You are Alia, an AI email assistant built into the Inbox app.

Generate a concise daily brief (2-4 sentences) using only aggregate inbox counts. Do not claim to know sender names, subject lines, message contents, deadlines, or action items because those private details are not provided. Be warm but efficient — no greetings, no sign-offs, just the brief. Write in second person ("You have...").`;

function buildPrompt(messages: Message[]): AliaMessage[] {
  const unreadCount = messages.filter((m) => !m.flags.seen).length;
  const starredCount = messages.filter((m) => m.flags.starred).length;
  const attachmentCount = messages.filter((m) => m.attachments.length > 0).length;

  const userMessage = `Recent inbox counts: ${messages.length} total emails, ${unreadCount} unread, ${starredCount} starred, ${attachmentCount} with attachments. Write a brief daily summary for this inbox using only these aggregate counts.`;

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ];
}

function getBriefCacheKey(): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return ['alia', 'daily-brief', today];
}

export function useDailyBrief(messages: Message[]) {
  const queryClient = useQueryClient();
  const { oxyServices } = useOxy();
  const cacheKey = getBriefCacheKey();

  const [briefText, setBriefText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef(false);

  // Check cache on mount
  useEffect(() => {
    const cached = queryClient.getQueryData<string>(cacheKey);
    if (cached) {
      setBriefText(cached);
    }
  }, []);

  const generate = useCallback(async () => {
    if (messages.length === 0) return;

    // Check cache
    const cached = queryClient.getQueryData<string>(cacheKey);
    if (cached) {
      setBriefText(cached);
      return;
    }

    const token = oxyServices.httpService.getAccessToken();
    if (!token) return;

    setIsStreaming(true);
    setBriefText('');
    setError(null);
    abortRef.current = false;

    try {
      const prompt = buildPrompt(messages);
      let accumulated = '';

      for await (const delta of streamAliaChatCompletion({
        model: 'alia-lite',
        messages: prompt,
        maxTokens: 300,
        temperature: 0.7,
        token,
      })) {
        if (abortRef.current) break;
        accumulated += delta;
        setBriefText(accumulated);
      }

      if (!abortRef.current) {
        // Cache with TTL
        queryClient.setQueryData(cacheKey, accumulated, {
          updatedAt: Date.now(),
        });
        // Set staleTime by setting defaults for this key
        queryClient.setQueryDefaults(cacheKey, {
          staleTime: BRIEF_CACHE_TTL,
          gcTime: BRIEF_CACHE_TTL,
        });
      }
    } catch (err) {
      if (!abortRef.current) {
        setError(err instanceof Error ? err : new Error('Brief generation failed'));
      }
    } finally {
      if (!abortRef.current) {
        setIsStreaming(false);
      }
    }
  }, [messages, queryClient, cacheKey, oxyServices]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const regenerate = useCallback(() => {
    queryClient.removeQueries({ queryKey: cacheKey });
    generate();
  }, [generate, queryClient, cacheKey]);

  return {
    briefText,
    isStreaming,
    isLoading: isStreaming && briefText.length === 0,
    error,
    regenerate,
  };
}
