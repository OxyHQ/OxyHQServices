/**
 * Email state management hook using zustand.
 *
 * Centralizes mailbox list, current mailbox, messages, and loading states.
 */

import { create } from 'zustand';
import { emailApi, type Mailbox, type Message, type Pagination } from '@/services/emailApi';

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

  // Actions
  loadMailboxes: (token: string) => Promise<void>;
  selectMailbox: (mailbox: Mailbox, token: string) => Promise<void>;
  loadMessages: (token: string, mailboxId: string, offset?: number) => Promise<void>;
  loadMoreMessages: (token: string) => Promise<void>;
  refreshMessages: (token: string) => Promise<void>;
  loadMessage: (token: string, messageId: string) => Promise<void>;
  toggleStar: (token: string, messageId: string) => Promise<void>;
  toggleRead: (token: string, messageId: string, seen: boolean) => Promise<void>;
  archiveMessage: (token: string, messageId: string) => Promise<void>;
  deleteMessage: (token: string, messageId: string) => Promise<void>;
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

  loadMailboxes: async (token) => {
    try {
      const mailboxes = await emailApi.listMailboxes(token);
      const inbox = mailboxes.find((m) => m.specialUse === 'Inbox') ?? mailboxes[0] ?? null;
      set({ mailboxes, mailboxesLoaded: true, currentMailbox: inbox });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  selectMailbox: async (mailbox, token) => {
    set({ currentMailbox: mailbox, messages: [], pagination: null });
    await get().loadMessages(token, mailbox._id);
  },

  loadMessages: async (token, mailboxId, offset = 0) => {
    set({ loading: true, error: null });
    try {
      const result = await emailApi.listMessages(token, mailboxId, { limit: 50, offset });
      set({ messages: result.data, pagination: result.pagination, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  loadMoreMessages: async (token) => {
    const { pagination, currentMailbox, messages } = get();
    if (!pagination?.hasMore || !currentMailbox) return;

    set({ loadingMore: true });
    try {
      const result = await emailApi.listMessages(token, currentMailbox._id, {
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

  refreshMessages: async (token) => {
    const { currentMailbox } = get();
    if (!currentMailbox) return;

    set({ refreshing: true });
    try {
      const result = await emailApi.listMessages(token, currentMailbox._id, { limit: 50 });
      // Also refresh mailbox counts
      const mailboxes = await emailApi.listMailboxes(token);
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

  loadMessage: async (token, messageId) => {
    try {
      const message = await emailApi.getMessage(token, messageId);
      set({ currentMessage: message });
      // Update the message in the list (mark as seen)
      set((state) => ({
        messages: state.messages.map((m) =>
          m._id === messageId ? { ...m, flags: { ...m.flags, seen: true } } : m,
        ),
      }));
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  toggleStar: async (token, messageId) => {
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
      await emailApi.updateFlags(token, messageId, { starred });
    } catch {
      // Revert on error
      set((state) => ({
        messages: state.messages.map((m) =>
          m._id === messageId ? { ...m, flags: { ...m.flags, starred: !starred } } : m,
        ),
      }));
    }
  },

  toggleRead: async (token, messageId, seen) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m._id === messageId ? { ...m, flags: { ...m.flags, seen } } : m,
      ),
    }));
    try {
      await emailApi.updateFlags(token, messageId, { seen });
    } catch {}
  },

  archiveMessage: async (token, messageId) => {
    const { mailboxes } = get();
    const archive = mailboxes.find((m) => m.specialUse === 'Archive');
    if (!archive) return;
    set((state) => ({
      messages: state.messages.filter((m) => m._id !== messageId),
    }));
    try {
      await emailApi.moveMessage(token, messageId, archive._id);
    } catch {}
  },

  deleteMessage: async (token, messageId) => {
    const { mailboxes, currentMailbox } = get();
    const trash = mailboxes.find((m) => m.specialUse === 'Trash');

    set((state) => ({
      messages: state.messages.filter((m) => m._id !== messageId),
    }));

    try {
      if (currentMailbox?.specialUse === 'Trash') {
        await emailApi.deleteMessage(token, messageId, true);
      } else if (trash) {
        await emailApi.moveMessage(token, messageId, trash._id);
      } else {
        await emailApi.deleteMessage(token, messageId);
      }
    } catch {}
  },

  clearCurrentMessage: () => set({ currentMessage: null }),
}));
