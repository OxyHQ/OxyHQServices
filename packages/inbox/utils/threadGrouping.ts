/**
 * Client-side conversation grouping for the message list.
 *
 * When the "Group by thread" preference (`conversationView`) is on, the list
 * collapses messages that belong to the same conversation into a single row
 * (the most recent message), exposing the number of messages in the thread via
 * `threadCount`. When the pref is off, every message is shown individually.
 *
 * Grouping key precedence:
 *   1. `references[0]`  — the root message id of the reference chain (RFC 5322)
 *   2. normalized subject (Re:/Fwd: prefixes stripped)
 *   3. the message's own id (its own singleton thread)
 */

import type { Message } from '@/services/emailApi';

function normalizeSubject(subject?: string): string {
  return (subject || '')
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}

function threadKeyOf(message: Message): string {
  const root = message.references?.[0];
  if (root) return `ref:${root}`;
  const subject = normalizeSubject(message.subject);
  if (subject) return `subj:${subject}`;
  return `id:${message._id}`;
}

/**
 * Collapse a date-ordered message array into one representative row per thread,
 * preserving the original ordering by first appearance. The representative is
 * the most recent message in the thread, annotated with the total count.
 */
export function collapseThreads(messages: Message[]): Message[] {
  const byKey = new Map<string, { rep: Message; count: number }>();
  const order: string[] = [];

  for (const message of messages) {
    const key = threadKeyOf(message);
    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, { rep: message, count: 1 });
      order.push(key);
      continue;
    }
    entry.count += 1;
    if (new Date(message.date).getTime() > new Date(entry.rep.date).getTime()) {
      entry.rep = message;
    }
  }

  return order.map((key) => {
    const { rep, count } = byKey.get(key)!;
    const threadCount = Math.max(count, rep.threadCount ?? 1);
    return threadCount === rep.threadCount ? rep : { ...rep, threadCount };
  });
}
