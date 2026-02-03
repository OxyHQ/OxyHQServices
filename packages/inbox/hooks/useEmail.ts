/**
 * Email UI state store (zustand).
 *
 * Only holds UI-related state: current mailbox selection, selected message ID, and API instance.
 * All server data (messages, mailboxes list, etc.) is managed by TanStack Query hooks.
 */

import { create } from 'zustand';
import { createEmailApi, type EmailApiInstance, type Mailbox } from '@/services/emailApi';
import type { OxyServices } from '@oxyhq/core';

type HttpService = OxyServices['httpService'];

interface EmailState {
  currentMailbox: Mailbox | null;
  selectedMessageId: string | null;
  sidebarCollapsed: boolean;
  selectedMessageIds: Set<string>;
  isSelectionMode: boolean;
  _api: EmailApiInstance | null;
  _initApi: (http: HttpService) => EmailApiInstance;
  selectMailbox: (mailbox: Mailbox) => void;
  toggleSidebar: () => void;
  toggleMessageSelection: (id: string) => void;
  enterSelectionMode: (id: string) => void;
  clearSelection: () => void;
  selectAll: (ids: string[]) => void;
}

export const useEmailStore = create<EmailState>((set, get) => ({
  currentMailbox: null,
  selectedMessageId: null,
  sidebarCollapsed: false,
  selectedMessageIds: new Set<string>(),
  isSelectionMode: false,
  _api: null,

  _initApi: (http: HttpService) => {
    const existing = get()._api;
    if (existing) {
      return existing;
    }
    const api = createEmailApi(http);
    set({ _api: api });
    return api;
  },

  selectMailbox: (mailbox) => {
    set({ currentMailbox: mailbox });
  },

  toggleSidebar: () => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },

  toggleMessageSelection: (id) => {
    const next = new Set(get().selectedMessageIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    set({
      selectedMessageIds: next,
      isSelectionMode: next.size > 0,
    });
  },

  enterSelectionMode: (id) => {
    const next = new Set(get().selectedMessageIds);
    next.add(id);
    set({ selectedMessageIds: next, isSelectionMode: true });
  },

  clearSelection: () => {
    set({ selectedMessageIds: new Set<string>(), isSelectionMode: false });
  },

  selectAll: (ids) => {
    set({ selectedMessageIds: new Set(ids), isSelectionMode: ids.length > 0 });
  },
}));
