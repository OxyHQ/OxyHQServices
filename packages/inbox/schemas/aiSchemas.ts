/**
 * Zod schemas for Alia AI responses.
 *
 * LLM output is fundamentally untrusted: the model can omit fields, emit the
 * wrong type, wrap JSON in markdown fences, or return prose instead of JSON.
 * Every place that parses model output MUST go through {@link parseLlmJson}
 * (or {@link safeParseLlmJson}) so a malformed response degrades gracefully to
 * a typed fallback rather than throwing deep inside a render/query.
 */

import { z } from 'zod';

// ─── Alia transport envelope ───────────────────────────────────────

/**
 * OpenAI-compatible chat-completion envelope returned by the `/alia/chat/*`
 * proxy. Both the non-streaming (`message.content`) and streaming
 * (`delta.content`) shapes are optional because either may be absent per chunk.
 */
export const AliaChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
        delta: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export type AliaChatResponse = z.infer<typeof AliaChatResponseSchema>;

// ─── Feature response schemas ──────────────────────────────────────

/** Thread summary — every field optional (the model may omit any of them). */
export const ThreadSummarySchema = z.object({
  summary: z.string().optional(),
  keyPoints: z.array(z.string()).optional(),
  actionItems: z
    .array(
      z.object({
        text: z.string().optional(),
        owner: z.string().nullable().optional(),
        deadline: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export type ParsedThreadSummary = z.infer<typeof ThreadSummarySchema>;

/** Smart replies — a JSON array of suggestion strings. */
export const SmartRepliesSchema = z.array(z.string());

/**
 * Natural-language search parse result. All search fields optional; the model
 * also returns a human-readable `interpretation` alongside them.
 */
export const NaturalLanguageSearchSchema = z.object({
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  hasAttachment: z.boolean().optional(),
  starred: z.boolean().optional(),
  unread: z.boolean().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  mailbox: z.string().optional(),
  interpretation: z.string().optional(),
});

export type ParsedNaturalLanguageSearch = z.infer<typeof NaturalLanguageSearchSchema>;

// ─── Parse helpers ─────────────────────────────────────────────────

/**
 * Strip a leading/trailing markdown code fence (```json … ```), if present,
 * from a model response before JSON parsing.
 */
export function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/```json?\n?/gi, '')
    .replace(/```/g, '')
    .trim();
}

/**
 * Parse a raw LLM string as JSON and validate it against `schema`.
 *
 * Returns `{ success: true, data }` on success or `{ success: false }` on any
 * failure (invalid JSON OR schema mismatch). Never throws — callers pick a
 * graceful fallback. This is the single chokepoint for LLM-JSON validation.
 */
export function safeParseLlmJson<T>(
  raw: string,
  schema: z.ZodType<T>,
): { success: true; data: T } | { success: false } {
  let json: unknown;
  try {
    json = JSON.parse(stripJsonCodeFence(raw));
  } catch {
    return { success: false };
  }
  const result = schema.safeParse(json);
  return result.success ? { success: true, data: result.data } : { success: false };
}

/**
 * Convenience wrapper around {@link safeParseLlmJson} that returns the parsed
 * value or `null` on any failure.
 */
export function parseLlmJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  const result = safeParseLlmJson(raw, schema);
  return result.success ? result.data : null;
}
