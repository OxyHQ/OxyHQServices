/**
 * Email API client
 *
 * Wraps the Oxy email REST API for use in the Inbox app.
 * Uses OxyServices.httpService for automatic auth and CSRF handling.
 */

import type { OxyServices } from '@oxyhq/core';

type HttpService = OxyServices['httpService'];

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  s3Key: string;
}

export interface MessageFlags {
  seen: boolean;
  starred: boolean;
  answered: boolean;
  forwarded: boolean;
  draft: boolean;
}

export interface Message {
  _id: string;
  userId: string;
  mailboxId: string;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments: Attachment[];
  flags: MessageFlags;
  labels: string[];
  spamScore?: number;
  size: number;
  inReplyTo?: string;
  references?: string[];
  aliasTag?: string;
  date: string;
  receivedAt: string;
}

export interface Mailbox {
  _id: string;
  userId: string;
  name: string;
  path: string;
  specialUse?: string;
  totalMessages: number;
  unseenMessages: number;
  size: number;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface QuotaUsage {
  used: number;
  limit: number;
  percentage: number;
  dailySendCount: number;
  dailySendLimit: number;
}

export interface EmailSettings {
  signature: string;
  autoReply: {
    enabled: boolean;
    subject: string;
    body: string;
    startDate: string | null;
    endDate: string | null;
  };
}

export function createEmailApi(http: HttpService) {
  return {
    // ─── Mailboxes ──────────────────────────────────────────────────

    async listMailboxes(): Promise<Mailbox[]> {
      const res = await http.get<{ data: Mailbox[] }>('/api/email/mailboxes');
      return res.data.data;
    },

    async createMailbox(name: string, parentPath?: string): Promise<Mailbox> {
      const res = await http.post<{ data: Mailbox }>('/api/email/mailboxes', { name, parentPath });
      return res.data.data;
    },

    async deleteMailbox(mailboxId: string): Promise<void> {
      await http.delete(`/api/email/mailboxes/${mailboxId}`);
    },

    // ─── Messages ───────────────────────────────────────────────────

    async listMessages(
      mailboxId: string,
      options: { limit?: number; offset?: number; unseenOnly?: boolean } = {},
    ): Promise<{ data: Message[]; pagination: Pagination }> {
      const params: Record<string, string> = { mailbox: mailboxId };
      if (options.limit) params.limit = String(options.limit);
      if (options.offset) params.offset = String(options.offset);
      if (options.unseenOnly) params.unseen = 'true';

      const res = await http.get<{ data: Message[]; pagination: Pagination }>('/api/email/messages', { params });
      return res.data;
    },

    async getMessage(messageId: string): Promise<Message> {
      const res = await http.get<{ data: Message }>(`/api/email/messages/${messageId}`);
      return res.data.data;
    },

    async updateFlags(messageId: string, flags: Partial<MessageFlags>): Promise<Message> {
      const res = await http.put<{ data: Message }>(`/api/email/messages/${messageId}/flags`, { flags });
      return res.data.data;
    },

    async moveMessage(messageId: string, mailboxId: string): Promise<Message> {
      const res = await http.post<{ data: Message }>(`/api/email/messages/${messageId}/move`, { mailboxId });
      return res.data.data;
    },

    async deleteMessage(messageId: string, permanent = false): Promise<void> {
      const params = permanent ? '?permanent=true' : '';
      await http.delete(`/api/email/messages/${messageId}${params}`);
    },

    // ─── Compose ────────────────────────────────────────────────────

    async sendMessage(message: {
      to: EmailAddress[];
      cc?: EmailAddress[];
      bcc?: EmailAddress[];
      subject: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      attachments?: string[];
    }): Promise<{ messageId: string; queued: boolean; message: string }> {
      const res = await http.post<{ data: { messageId: string; queued: boolean; message: string } }>('/api/email/messages', message);
      return res.data.data;
    },

    async saveDraft(draft: {
      to?: EmailAddress[];
      cc?: EmailAddress[];
      bcc?: EmailAddress[];
      subject?: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      existingDraftId?: string;
    }): Promise<Message> {
      const res = await http.post<{ data: Message }>('/api/email/drafts', draft);
      return res.data.data;
    },

    // ─── Search ─────────────────────────────────────────────────────

    async search(
      query: string,
      options: { limit?: number; offset?: number; mailbox?: string } = {},
    ): Promise<{ data: Message[]; pagination: Pagination }> {
      const params: Record<string, string> = { q: query };
      if (options.limit) params.limit = String(options.limit);
      if (options.offset) params.offset = String(options.offset);
      if (options.mailbox) params.mailbox = options.mailbox;

      const res = await http.get<{ data: Message[]; pagination: Pagination }>('/api/email/search', { params });
      return res.data;
    },

    // ─── Quota ──────────────────────────────────────────────────────

    async getQuota(): Promise<QuotaUsage> {
      const res = await http.get<{ data: QuotaUsage }>('/api/email/quota');
      return res.data.data;
    },

    // ─── Attachments ────────────────────────────────────────────────

    async getAttachmentUrl(s3Key: string): Promise<string> {
      const res = await http.get<{ data: { url: string } }>(
        `/api/email/attachments/${encodeURIComponent(s3Key)}`,
      );
      return res.data.data.url;
    },

    // ─── Settings ───────────────────────────────────────────────────

    async getSettings(): Promise<EmailSettings> {
      const res = await http.get<{ data: EmailSettings }>('/api/email/settings');
      return res.data.data;
    },

    async updateSettings(
      settings: { signature?: string; autoReply?: Partial<EmailSettings['autoReply']> },
    ): Promise<void> {
      await http.put('/api/email/settings', settings);
    },
  };
}

export type EmailApiInstance = ReturnType<typeof createEmailApi>;
