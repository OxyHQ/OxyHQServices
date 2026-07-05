/**
 * Alia AI API client
 *
 * Proxies requests through the Oxy backend API (`api.oxy.so`) which handles
 * Alia API key management server-side. That backend IS the origin the
 * OxyProvider session owner already talks to, so authentication rides the
 * SDK's own `HttpService` — no app-local token provider, interceptor, or
 * manual `Authorization` plumbing (see `@oxyhq/services` D4 contract).
 */

import type { OxyServices } from '@oxyhq/core';

type HttpService = OxyServices['httpService'];

const ALIA_COMPLETIONS_PATH = '/alia/chat/completions';

// Matches the OxyProvider baseURL wired in `app/_layout.tsx`; only used by the
// streaming path, which must issue a raw fetch (HttpService has no streaming
// body — it fully reads every response).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export interface AliaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AliaRequestOptions {
  model?: 'alia-lite' | 'alia-v1' | 'alia-v1-pro' | 'alia-v1-pro-max';
  messages: AliaMessage[];
  maxTokens?: number;
  temperature?: number;
}

/** OpenAI-compatible chat-completion response shape returned by the proxy. */
interface AliaChatResponse {
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string };
  }>;
}

function buildRequestBody(options: AliaRequestOptions, stream: boolean) {
  return {
    model: options.model ?? 'alia-lite',
    messages: options.messages,
    max_tokens: options.maxTokens ?? 512,
    temperature: options.temperature ?? 0.7,
    stream,
  };
}

/**
 * Non-streaming chat completion. Returns the full response text.
 *
 * Routes through the SDK `HttpService`, which owns the bearer token
 * (auto-refresh + 401 retry). No manual `Authorization` header.
 */
export async function aliaChatCompletion(
  http: HttpService,
  options: AliaRequestOptions,
): Promise<string> {
  const response = await http.post<AliaChatResponse>(
    ALIA_COMPLETIONS_PATH,
    buildRequestBody(options, false),
  );
  return response.choices?.[0]?.message?.content ?? '';
}

/**
 * Stream a chat completion from Alia. Yields text deltas as they arrive.
 *
 * `HttpService` has no streaming path (`request()` fully reads the body), so
 * this SSE call must use a raw `fetch`. The endpoint is same-origin with the
 * session owner (`api.oxy.so`), so we borrow the SDK-owned access token for the
 * `Authorization` header — the same sanctioned same-origin pattern
 * `useInboxSocket` uses for its socket.io handshake. This is NOT an app-local
 * auth interceptor or token provider.
 */
export async function* streamAliaChatCompletion(
  http: HttpService,
  options: AliaRequestOptions,
): AsyncGenerator<string> {
  const token = http.getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${API_URL}${ALIA_COMPLETIONS_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildRequestBody(options, true)),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Alia API error ${response.status}: ${text}`);
  }

  // Fall back to non-streaming if ReadableStream is unavailable
  if (!response.body || typeof response.body.getReader !== 'function') {
    const json = (await response.json()) as AliaChatResponse;
    const content = json.choices?.[0]?.message?.content ?? '';
    if (content) yield content;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data) as AliaChatResponse;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
