/**
 * Display helpers for validation requests, whose `actionType` is a snake_case
 * key and whose `payload` is an arbitrary `Record<string, unknown>`. Kept pure +
 * UI-agnostic so the inbox list and the vote screen render consistently and the
 * logic is unit-testable.
 */

/** Turn a snake/kebab key (`real_life_attested`) into a label (`Real Life Attested`). */
export function prettyActionType(actionType: string): string {
  if (!actionType) return '';
  return actionType
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** A single render-ready key/value row derived from a request payload. */
export interface PayloadEntry {
  key: string;
  value: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Flatten a validation request's `payload` into prettified key/value rows for
 * display. Object/array values are JSON-stringified; nullish values render `—`.
 */
export function payloadEntries(payload: Record<string, unknown>): PayloadEntry[] {
  return Object.entries(payload).map(([key, value]) => ({
    key: prettyActionType(key),
    value: formatValue(value),
  }));
}
