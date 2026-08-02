/**
 * Natural Language Search hook.
 *
 * Parses natural language queries into structured search options using AI.
 * Examples:
 * - "emails from Sarah last week" → { from: "sarah", after: "2025-01-29" }
 * - "unread emails about budget" → { q: "budget", unread: true }
 * - "attachments from John" → { from: "john", hasAttachment: true }
 */

import { useMutation } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { aliaChatCompletion } from '@/services/aliaApi';
import { aiKeys } from '@/hooks/queries/queryKeys';
import { parseLlmJson, NaturalLanguageSearchSchema } from '@/schemas/aiSchemas';

export interface ParsedSearchQuery {
  q?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  starred?: boolean;
  unread?: boolean;
  after?: string;
  before?: string;
  mailbox?: string;
}

export interface NaturalLanguageSearchResult {
  query: ParsedSearchQuery;
  interpretation: string;
}

const SEARCH_PARSE_PROMPT_PREFIX = `You are an email search assistant. Parse the user's natural language query into structured search parameters.

Output a JSON object with these optional fields:
- q: General search text (keywords, phrases)
- from: Sender email or name
- to: Recipient email or name
- subject: Subject line keywords
- hasAttachment: true if looking for emails with attachments
- starred: true if looking for starred emails
- unread: true if looking for unread emails, false for read emails
- after: Date string (YYYY-MM-DD) for emails after this date
- before: Date string (YYYY-MM-DD) for emails before this date
- mailbox: "inbox", "sent", "drafts", "trash", "spam", "archive"
- interpretation: A brief human-readable interpretation of the query

For relative dates like "last week", "yesterday", "this month", calculate the actual date from today's date.

Examples:
"emails from Sarah last week" → {"from":"sarah","after":"2025-01-27","interpretation":"Emails from Sarah in the last 7 days"}
"unread emails about the budget proposal" → {"q":"budget proposal","unread":true,"interpretation":"Unread emails mentioning budget proposal"}
"attachments I received yesterday" → {"hasAttachment":true,"after":"2025-02-03","before":"2025-02-04","interpretation":"Emails with attachments from yesterday"}

Respond with ONLY the JSON object, nothing else.`;

function buildSearchParsePrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  return `${SEARCH_PARSE_PROMPT_PREFIX}\nToday's date is: ${today}`;
}

export function useNaturalLanguageSearch() {
  const { oxyServices } = useOxy();

  const mutation = useMutation<NaturalLanguageSearchResult, Error, string>({
    mutationKey: aiKeys.naturalLanguageSearch,
    mutationFn: async (naturalLanguage: string) => {
      if (!naturalLanguage.trim()) {
        return { query: {}, interpretation: '' };
      }

      // Quick check: if it looks like a standard Gmail-style operator, skip AI parsing
      const hasOperators = /(from:|to:|subject:|in:|is:|has:|label:)/i.test(naturalLanguage);
      if (hasOperators) {
        // Let the existing operator parser handle it downstream.
        return { query: { q: naturalLanguage }, interpretation: 'Using search operators' };
      }

      const response = await aliaChatCompletion(oxyServices.httpService, {
        model: 'alia-lite',
        messages: [
          { role: 'system', content: buildSearchParsePrompt() },
          { role: 'user', content: naturalLanguage },
        ],
        maxTokens: 200,
        temperature: 0.3,
      });

      // Validate the model's JSON. On any failure, fall back to a plain text
      // search so the user still gets results.
      const parsed = parseLlmJson(response, NaturalLanguageSearchSchema);
      if (!parsed) {
        return {
          query: { q: naturalLanguage },
          interpretation: `Searching for "${naturalLanguage}"`,
        };
      }

      const { interpretation, ...query } = parsed;
      return {
        query: query as ParsedSearchQuery,
        interpretation: interpretation || 'Searching...',
      };
    },
  });

  const { mutateAsync } = mutation;

  return {
    parseQuery: mutateAsync,
    lastResult: mutation.data ?? null,
    isLoading: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Simple client-side parsing for common patterns (no AI needed)
 */
export function quickParseSearch(query: string): ParsedSearchQuery | null {
  const q = query.toLowerCase().trim();

  // "unread" or "unread emails"
  if (/^unread( emails?)?$/.test(q)) {
    return { unread: true };
  }

  // "starred" or "starred emails"
  if (/^starred( emails?)?$/.test(q)) {
    return { starred: true };
  }

  // "with attachments" or "has attachments"
  if (/^(with|has) attachments?$/.test(q)) {
    return { hasAttachment: true };
  }

  // "from X" pattern
  const fromMatch = q.match(/^from\s+(\S+)/);
  if (fromMatch) {
    return { from: fromMatch[1] };
  }

  // "to X" pattern
  const toMatch = q.match(/^to\s+(\S+)/);
  if (toMatch) {
    return { to: toMatch[1] };
  }

  return null;
}
