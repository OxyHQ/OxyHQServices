/**
 * Alia AI API client
 *
 * Proxies requests through the Oxy backend API which handles
 * Alia API key management server-side.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export interface AliaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AliaRequestOptions {
  model?: 'alia-lite' | 'alia-v1' | 'alia-v1-pro' | 'alia-v1-pro-max';
  messages: AliaMessage[];
  maxTokens?: number;
  temperature?: number;
  /** User session JWT for backend authentication */
  token: string;
}

/**
 * Stream a chat completion from Alia. Yields text deltas as they arrive.
 */
export async function* streamAliaChatCompletion(
  options: AliaRequestOptions,
): AsyncGenerator<string> {
  const response = await fetch(`${API_URL}/alia/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify({
      model: options.model ?? 'alia-lite',
      messages: options.messages,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.7,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Alia API error ${response.status}: ${text}`);
  }

  // Fall back to non-streaming if ReadableStream is unavailable
  if (!response.body || typeof response.body.getReader !== 'function') {
    const json = await response.json();
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
          const parsed = JSON.parse(data);
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

/**
 * Non-streaming chat completion. Returns the full response text.
 */
export async function aliaChatCompletion(
  options: AliaRequestOptions,
): Promise<string> {
  const response = await fetch(`${API_URL}/alia/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify({
      model: options.model ?? 'alia-lite',
      messages: options.messages,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.7,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Alia API error ${response.status}: ${text}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content ?? '';
}
