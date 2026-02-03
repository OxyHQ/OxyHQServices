/**
 * Email state management hook using zustand.
 *
 * Centralizes mailbox list, current mailbox, messages, and loading states.
 */

import { create } from 'zustand';
import { createEmailApi, type EmailApiInstance, type Mailbox, type Message, type Pagination } from '@/services/emailApi';
import type { OxyServices } from '@oxyhq/core';

type HttpService = OxyServices['httpService'];

interface EmailState {
  // Mailboxes
  mailboxes: Mailbox[];
  currentMailbox: Mailbox | null;
  mailboxesLoaded: boolean;

  // Messages
  messages: Message[];
  pagination: Pagination | null;
  currentMessage: Message | null;

  // Loading
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;

  // Internal
  _api: EmailApiInstance | null;
  _initApi: (http: HttpService) => EmailApiInstance;

  // Actions
  loadMailboxes: () => Promise<void>;
  selectMailbox: (mailbox: Mailbox) => Promise<void>;
  loadMessages: (mailboxId: string, offset?: number) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  loadMessage: (messageId: string) => Promise<void>;
  toggleStar: (messageId: string) => Promise<void>;
  toggleRead: (messageId: string, seen: boolean) => Promise<void>;
  archiveMessage: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  clearCurrentMessage: () => void;
}

export const useEmailStore = create<EmailState>((set, get) => ({
  mailboxes: [],
  currentMailbox: null,
  mailboxesLoaded: false,
  messages: [],
  pagination: null,
  currentMessage: null,
  loading: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  _api: null,

  _initApi: (http: HttpService) => {
    const existing = get()._api;
    if (existing) return existing;
    const api = createEmailApi(http);
    set({ _api: api });
    return api;
  },

  loadMailboxes: async () => {
    const api = get()._api;
    if (!api) return;
    try {
      const mailboxes = await api.listMailboxes();
      const inbox = mailboxes.find((m) => m.specialUse === 'Inbox') ?? mailboxes[0] ?? null;
      set({ mailboxes, mailboxesLoaded: true, currentMailbox: inbox });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  selectMailbox: async (mailbox) => {
    set({ currentMailbox: mailbox, messages: [], pagination: null });
    await get().loadMessages(mailbox._id);
  },

  loadMessages: async (mailboxId, offset = 0) => {
    const api = get()._api;
    if (!api) return;
    set({ loading: true, error: null });
    try {
      const result = await api.listMessages(mailboxId, { limit: 50, offset });
      set({ messages: result.data, pagination: result.pagination, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  loadMoreMessages: async () => {
    const api = get()._api;
    if (!api) return;
    const { pagination, currentMailbox, messages } = get();
    if (!pagination?.hasMore || !currentMailbox) return;

    set({ loadingMore: true });
    try {
      const result = await api.listMessages(currentMailbox._id, {
        limit: 50,
        offset: pagination.offset + pagination.limit,
      });
      set({
        messages: [...messages, ...result.data],
        pagination: result.pagination,
        loadingMore: false,
      });
    } catch (err: any) {
      set({ error: err.message, loadingMore: false });
    }
  },

  refreshMessages: async () => {
    const api = get()._api;
    if (!api) return;
    const { currentMailbox } = get();
    if (!currentMailbox) return;

    set({ refreshing: true });
    try {
      const result = await api.listMessages(currentMailbox._id, { limit: 50 });
      const mailboxes = await api.listMailboxes();
      const updated = mailboxes.find((m) => m._id === currentMailbox._id) ?? currentMailbox;
      set({
        messages: result.data,
        pagination: result.pagination,
        mailboxes,
        currentMailbox: updated,
        refreshing: false,
      });
    } catch (err: any) {
      set({ error: err.message, refreshing: false });
    }
  },

  loadMessage: async (messageId) => {
    const api = get()._api;
    if (!api) return;
    try {
      const message = await api.getMessage(messageId);
      set({ currentMessage: message });
      set((state) => ({
        messages: state.messages.map((m) =>
          m._id === messageId ? { ...m, flags: { ...m.flags, seen: true } } : m,
        ),
      }));
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  toggleStar: async (messageId) => {
    const api = get()._api;
    if (!api) return;
    const msg = get().messages.find((m) => m._id === messageId);
    if (!msg) return;
    const starred = !msg.flags.starred;
    // Optimistic update
    set((state) => ({
      messages: state.messages.map((m) =>
        m._id === messageId ? { ...m, flags: { ...m.flags, starred } } : m,
      ),
    }));
    try {
      await api.updateFlags(messageId, { starred });
    } catch {
      // Revert on error
      set((state) => ({
        messages: state.messages.map((m) =>
          m._id === messageId ? { ...m, flags: { ...m.flags, starred: !starred } } : m,
        ),
      }));
    }
  },

  toggleRead: async (messageId, seen) => {
    const api = get()._api;
    if (!api) return;
    set((state) => ({
      messages: state.messages.map((m) =>
        m._id === messageId ? { ...m, flags: { ...m.flags, seen } } : m,
      ),
    }));
    try {
      await api.updateFlags(messageId, { seen });
    } catch {}
  },

  archiveMessage: async (messageId) => {
    const api = get()._api;
    if (!api) return;
    const { mailboxes } = get();
    const archive = mailboxes.find((m) => m.specialUse === 'Archive');
    if (!archive) return;
    set((state) => ({
      messages: state.messages.filter((m) => m._id !== messageId),
    }));
    try {
      await api.moveMessage(messageId, archive._id);
    } catch {}
  },

  deleteMessage: async (messageId) => {
    const api = get()._api;
    if (!api) return;
    const { mailboxes, currentMailbox } = get();
    const trash = mailboxes.find((m) => m.specialUse === 'Trash');

    set((state) => ({
      messages: state.messages.filter((m) => m._id !== messageId),
    }));

    try {
      if (currentMailbox?.specialUse === 'Trash') {
        await api.deleteMessage(messageId, true);
      } else if (trash) {
        await api.moveMessage(messageId, trash._id);
      } else {
        await api.deleteMessage(messageId);
      }
    } catch {}
  },

  clearCurrentMessage: () => set({ currentMessage: null }),
}));
