/**
 * Centralized React Query cache helpers for the Inbox message caches.
 *
 * Single source of truth for how the three message-related caches are read and
 * mutated:
 *   - `['messages', ...]`         infinite list (per mailbox/view)
 *   - `['message', id, userId]`   single message detail
 *   - `['thread', ...]`           thread view
 *   - `['mailboxes', userId]`     mailbox list (unseen counts)
 *
 * Mutation hooks call these helpers instead of inlining `setQueriesData`
 * logic, so there is exactly one place that understands the cache shapes.
 */

import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import { emailKeys } from '@/hooks/queries/queryKeys';
import type { Mailbox, Message, Pagination } from '@/services/emailApi';

interface MessagesPage {
  data: Message[];
  pagination: Pagination;
}

export type MessagesInfinite = InfiniteData<MessagesPage>;

// ─── Low-level page helpers ──────────────────────────────────────────

/** Update a single message across every page of an infinite list. */
export function updateMessageInPages(
  old: MessagesInfinite | undefined,
  messageId: string,
  updater: (msg: Message) => Message,
): MessagesInfinite | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      data: page.data.map((m) => (m._id === messageId ? updater(m) : m)),
    })),
  };
}

/** Remove a single message from every page of an infinite list. */
export function removeMessageFromPages(
  old: MessagesInfinite | undefined,
  messageId: string,
): MessagesInfinite | undefined {
  if (!old) return old;
  return {
    ...old,
    pages: old.pages.map((page) => ({
      ...page,
      data: page.data.filter((m) => m._id !== messageId),
    })),
  };
}

/** Flatten all messages from an infinite query into a single array. */
export function flatMessages(data: MessagesInfinite | undefined): Message[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.data);
}

/**
 * Merge a server flag-update response into an existing cached message without
 * dropping detail-only fields (body, headers) that the flag/label update
 * endpoints intentionally omit from their responses.
 */
export function mergeMessageUpdate(old: Message | null | undefined, updated: Message): Message {
  if (!old) return updated;
  return {
    ...old,
    ...updated,
    text: updated.text ?? old.text,
    html: updated.html ?? old.html,
    headers: updated.headers ?? old.headers,
    flags: { ...old.flags, ...updated.flags },
  };
}

// ─── Lookups ─────────────────────────────────────────────────────────

/** Find a cached message by id, checking the list caches then the detail cache. */
export function findCachedMessage(
  queryClient: QueryClient,
  messageId: string,
  userId: string | null,
): Message | undefined {
  for (const [, data] of queryClient.getQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root })) {
    const found = flatMessages(data).find((m) => m._id === messageId);
    if (found) return found;
  }
  return queryClient.getQueryData<Message | null>(emailKeys.message.detail(messageId, userId)) ?? undefined;
}

// ─── Optimistic patches ──────────────────────────────────────────────

/**
 * Patch a message's flags across all three caches (list, detail, thread).
 * Only the provided flag keys are touched; other flags are preserved.
 */
export function patchMessageFlags(
  queryClient: QueryClient,
  messageId: string,
  userId: string | null,
  flags: Partial<Message['flags']>,
): void {
  queryClient.setQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }, (old) =>
    updateMessageInPages(old, messageId, (m) => ({ ...m, flags: { ...m.flags, ...flags } })),
  );
  queryClient.setQueryData<Message | null>(emailKeys.message.detail(messageId, userId), (old) =>
    old ? { ...old, flags: { ...old.flags, ...flags } } : old,
  );
  queryClient.setQueriesData<Message[]>({ queryKey: emailKeys.thread.root }, (old) =>
    old?.map((m) => (m._id === messageId ? { ...m, flags: { ...m.flags, ...flags } } : m)),
  );
}

/** Apply an arbitrary updater to a message across every list cache. */
export function patchMessageInList(
  queryClient: QueryClient,
  messageId: string,
  updater: (msg: Message) => Message,
): void {
  queryClient.setQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }, (old) =>
    updateMessageInPages(old, messageId, updater),
  );
}

/** Remove a message from every list cache (archive, delete, snooze). */
export function removeMessageFromList(queryClient: QueryClient, messageId: string): void {
  queryClient.setQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }, (old) =>
    removeMessageFromPages(old, messageId),
  );
}

/**
 * Adjust the unseen-message count of a mailbox in the `['mailboxes']` cache.
 * Clamped at zero. Used to keep sidebar badges instant on read/unread toggles.
 */
export function patchMailboxUnseen(
  queryClient: QueryClient,
  mailboxId: string | null | undefined,
  delta: number,
): void {
  if (!mailboxId || delta === 0) return;
  queryClient.setQueriesData<Mailbox[]>({ queryKey: emailKeys.mailboxes.root }, (old) =>
    old?.map((mb) =>
      mb._id === mailboxId
        ? { ...mb, unseenMessages: Math.max(0, mb.unseenMessages + delta) }
        : mb,
    ),
  );
}

/**
 * Merge a server message response into all caches after a successful mutation,
 * without dropping detail-only fields the update endpoint omits.
 */
export function mergeServerMessage(
  queryClient: QueryClient,
  messageId: string,
  userId: string | null,
  updated: Message,
  options: { skipList?: boolean } = {},
): void {
  queryClient.setQueryData<Message | null>(emailKeys.message.detail(messageId, userId), (old) =>
    mergeMessageUpdate(old, updated),
  );
  if (!options.skipList) {
    queryClient.setQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }, (old) =>
      updateMessageInPages(old, messageId, (message) => mergeMessageUpdate(message, updated)),
    );
  }
  queryClient.setQueriesData<Message[]>({ queryKey: emailKeys.thread.root }, (old) =>
    old?.map((m) => (m._id === messageId ? mergeMessageUpdate(m, updated) : m)),
  );
}

// ─── Snapshot / rollback ─────────────────────────────────────────────

export interface MessageSnapshot {
  messageId: string;
  userId: string | null;
  prevMessages: [QueryKey, MessagesInfinite | undefined][];
  prevMessage: Message | null | undefined;
  prevThreads: [QueryKey, Message[] | undefined][];
  prevMailboxes: [QueryKey, Mailbox[] | undefined][];
}

/**
 * Snapshot the current state of all message caches for a given message so a
 * failed mutation can restore them via `restoreSnapshot`.
 */
export function snapshotForRollback(
  queryClient: QueryClient,
  messageId: string,
  userId: string | null,
): MessageSnapshot {
  return {
    messageId,
    userId,
    prevMessages: queryClient.getQueriesData<MessagesInfinite>({ queryKey: emailKeys.messages.root }),
    prevMessage: queryClient.getQueryData<Message | null>(emailKeys.message.detail(messageId, userId)),
    prevThreads: queryClient.getQueriesData<Message[]>({ queryKey: emailKeys.thread.root }),
    prevMailboxes: queryClient.getQueriesData<Mailbox[]>({ queryKey: emailKeys.mailboxes.root }),
  };
}

/** Restore all caches captured by `snapshotForRollback`. */
export function restoreSnapshot(queryClient: QueryClient, snapshot: MessageSnapshot): void {
  snapshot.prevMessages.forEach(([key, data]) => queryClient.setQueryData(key, data));
  queryClient.setQueryData(emailKeys.message.detail(snapshot.messageId, snapshot.userId), snapshot.prevMessage);
  snapshot.prevThreads.forEach(([key, data]) => queryClient.setQueryData(key, data));
  snapshot.prevMailboxes.forEach(([key, data]) => queryClient.setQueryData(key, data));
}

/** Cancel in-flight queries for the message caches before an optimistic update. */
export async function cancelMessageQueries(
  queryClient: QueryClient,
  messageId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: emailKeys.messages.root }),
    messageId
      ? queryClient.cancelQueries({ queryKey: emailKeys.message.byId(messageId) })
      : Promise.resolve(),
    queryClient.cancelQueries({ queryKey: emailKeys.thread.root }),
  ]);
}
