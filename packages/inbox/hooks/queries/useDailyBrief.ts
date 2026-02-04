/**
 * Hook that generates a daily AI brief from recent emails using the Alia API.
 *
 * Streams the response for a typing effect and caches the result
 * so it's not regenerated on every screen visit.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamAliaChatCompletion, type AliaMessage } from '@/services/aliaApi';
import type { Message } from '@/services/emailApi';

const BRIEF_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_EMAILS_FOR_CONTEXT = 20;

const SYSTEM_PROMPT = `You are Alia, an autonomous AI email assistant built into the Inbox app. You work silently in the background organizing, categorizing, and analyzing the user's emails.

Generate a concise daily brief (2-4 sentences) summarizing what's in the user's inbox right now. Mention specific senders by name and highlight action items, deadlines, or anything that needs attention. Be warm but efficient — no greetings, no sign-offs, just the brief. Write in second person ("You have...", "Sarah sent you...").`;

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildPrompt(messages: Message[], userName: string): AliaMessage[] {
  const emailSummaries = messages.slice(0, MAX_EMAILS_FOR_CONTEXT).map((msg) => {
    const from = msg.from.name || msg.from.address.split('@')[0];
    const flags: string[] = [];
    if (!msg.flags.seen) flags.push('UNREAD');
    if (msg.flags.starred) flags.push('STARRED');
    const snippet = (msg.text ?? '').slice(0, 100).replace(/\n/g, ' ').trim();
    const time = formatRelativeTime(msg.date);

    return `- From: ${from} | Subject: ${msg.subject || '(no subject)'} | ${time}${flags.length ? ` | ${flags.join(', ')}` : ''}${snippet ? ` | "${snippet}..."` : ''}`;
  });

  const unreadCount = messages.filter((m) => !m.flags.seen).length;
  const starredCount = messages.filter((m) => m.flags.starred).length;

  const userMessage = `The user's name is ${userName || 'there'}. Here are their recent emails (${messages.length} total, ${unreadCount} unread, ${starredCount} starred):

${emailSummaries.join('\n')}

Write a brief daily summary for this inbox.`;

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userMessage },
  ];
}

function getBriefCacheKey(): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return ['alia', 'daily-brief', today];
}

export function useDailyBrief(messages: Message[], userName: string) {
  const queryClient = useQueryClient();
  const cacheKey = getBriefCacheKey();

  const [briefText, setBriefText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef(false);
  const generatedRef = useRef(false);

  // Check cache on mount
  useEffect(() => {
    const cached = queryClient.getQueryData<string>(cacheKey);
    if (cached) {
      setBriefText(cached);
      generatedRef.current = true;
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

    setIsStreaming(true);
    setBriefText('');
    setError(null);
    abortRef.current = false;

    try {
      const prompt = buildPrompt(messages, userName);
      let accumulated = '';

      for await (const delta of streamAliaChatCompletion({
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
      console.error('[Alia] Daily brief generation failed:', err);
      if (!abortRef.current) {
        setError(err instanceof Error ? err : new Error('Brief generation failed'));
      }
    } finally {
      if (!abortRef.current) {
        setIsStreaming(false);
      }
    }
  }, [messages, userName, queryClient, cacheKey]);

  // Auto-generate when messages arrive and no brief exists yet
  useEffect(() => {
    if (messages.length > 0 && !generatedRef.current && !isStreaming) {
      generatedRef.current = true;
      generate();
    }
  }, [messages.length > 0]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const regenerate = useCallback(() => {
    queryClient.removeQueries({ queryKey: cacheKey });
    generatedRef.current = true;
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
