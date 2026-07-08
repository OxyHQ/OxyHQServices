/**
 * Hook that generates an opt-in daily AI brief from non-content email counts.
 *
 * Streams the response for a typing effect and caches the result
 * so it's not regenerated on every screen visit.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { streamAliaChatCompletion, type AliaMessage } from '@/services/aliaApi';
import { aiKeys } from '@/hooks/queries/queryKeys';
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

function getBriefCacheKey() {
  const today = new Date().toISOString().slice(0, 10);
  return aiKeys.dailyBrief(today);
}

interface UseDailyBriefOptions {
  /** When false, the hook does no work — used to honor the `aiBrief` pref. */
  enabled?: boolean;
}

export function useDailyBrief(messages: Message[], options: UseDailyBriefOptions = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { oxyServices, user } = useOxy();
  const cacheKey = getBriefCacheKey();

  const [briefText, setBriefText] = useState('');
  const abortRef = useRef(false);

  // Check cache on mount / day rollover (skip when the feature is disabled).
  useEffect(() => {
    if (!enabled) return;
    const cached = queryClient.getQueryData<string>(cacheKey);
    if (cached) {
      setBriefText(cached);
    }
  }, [enabled, cacheKey, queryClient]);

  // The generation is a mutation (a one-shot side-effecting stream) rather than
  // a query: it writes its result into the query cache keyed by day so it isn't
  // regenerated on every screen visit, while streaming chunks into local state
  // for the typewriter effect.
  const generateMutation = useMutation<string, Error, void>({
    mutationKey: cacheKey,
    mutationFn: async () => {
      const prompt = buildPrompt(messages);
      let accumulated = '';
      abortRef.current = false;

      for await (const delta of streamAliaChatCompletion(oxyServices.httpService, {
        model: 'alia-lite',
        messages: prompt,
        maxTokens: 300,
        temperature: 0.7,
      })) {
        if (abortRef.current) break;
        accumulated += delta;
        setBriefText(accumulated);
      }

      if (!abortRef.current) {
        queryClient.setQueryData(cacheKey, accumulated, { updatedAt: Date.now() });
        queryClient.setQueryDefaults(cacheKey, {
          staleTime: BRIEF_CACHE_TTL,
          gcTime: BRIEF_CACHE_TTL,
        });
      }

      return accumulated;
    },
  });

  const { mutate: runGenerate } = generateMutation;

  const generate = useCallback(() => {
    if (!enabled || messages.length === 0 || !user) return;

    // Serve from cache if present — avoids a redundant AI round-trip.
    const cached = queryClient.getQueryData<string>(cacheKey);
    if (cached) {
      setBriefText(cached);
      return;
    }

    setBriefText('');
    runGenerate();
  }, [enabled, messages.length, user, queryClient, cacheKey, runGenerate]);

  // Cleanup on unmount — stop streaming into unmounted state.
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const regenerate = useCallback(() => {
    queryClient.removeQueries({ queryKey: cacheKey });
    setBriefText('');
    generate();
  }, [generate, queryClient, cacheKey]);

  return {
    briefText,
    isStreaming: generateMutation.isPending,
    isLoading: generateMutation.isPending && briefText.length === 0,
    error: generateMutation.error,
    generate,
    regenerate,
  };
}
