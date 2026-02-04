/**
 * Email API client
 *
 * Wraps the Oxy email REST API for use in the Inbox app.
 * Uses OxyServices.httpService for automatic auth and CSRF handling.
 * All responses validated with zod schemas at runtime.
 */

import { z } from 'zod';
import type { OxyServices } from '@oxyhq/core';

type HttpService = OxyServices['httpService'];

// ─── Zod Schemas ───────────────────────────────────────────────────

export const EmailAddressSchema = z.object({
  name: z.string().optional(),
  address: z.string(),
});

export const AttachmentSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
  s3Key: z.string(),
});

export const MessageFlagsSchema = z.object({
  seen: z.boolean(),
  starred: z.boolean(),
  answered: z.boolean(),
  forwarded: z.boolean(),
  draft: z.boolean(),
});

export const MessageSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  mailboxId: z.string(),
  messageId: z.string(),
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema),
  cc: z.array(EmailAddressSchema).optional(),
  bcc: z.array(EmailAddressSchema).optional(),
  subject: z.string(),
  text: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  attachments: z.array(AttachmentSchema),
  flags: MessageFlagsSchema,
  labels: z.array(z.string()),
  spamScore: z.number().nullable().optional(),
  size: z.number(),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  aliasTag: z.string().nullable().optional(),
  date: z.string(),
  receivedAt: z.string(),
});

export const MailboxSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  name: z.string(),
  path: z.string(),
  specialUse: z.string().nullable().optional(),
  totalMessages: z.number(),
  unseenMessages: z.number(),
  size: z.number(),
});

export const LabelSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  name: z.string(),
  color: z.string(),
  order: z.number(),
});

export const PaginationSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

export const QuotaUsageSchema = z.object({
  used: z.number(),
  limit: z.number(),
  percentage: z.number(),
});

export const EmailSettingsSchema = z.object({
  signature: z.string(),
  autoReply: z.object({
    enabled: z.boolean(),
    subject: z.string().optional(),
    body: z.string().optional(),
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
  }),
  address: z.string().optional(),
});

// ─── Inferred Types ────────────────────────────────────────────────

export type EmailAddress = z.infer<typeof EmailAddressSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type MessageFlags = z.infer<typeof MessageFlagsSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Mailbox = z.infer<typeof MailboxSchema>;
export type Label = z.infer<typeof LabelSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;
export type EmailSettings = z.infer<typeof EmailSettingsSchema>;

// ─── Response Wrappers ─────────────────────────────────────────────

interface PaginatedResponse<T> {
  data: {
    data: T[];
    pagination: Pagination;
  };
}

// ─── API Client ────────────────────────────────────────────────────

export function createEmailApi(http: HttpService) {
  return {
    // ─── Mailboxes ──────────────────────────────────────────────────

    async listMailboxes(): Promise<Mailbox[]> {
      const res = (await http.get('/email/mailboxes')) as { data: Mailbox[] };
      return z.array(MailboxSchema).parse(res.data);
    },

    async createMailbox(name: string, parentPath?: string): Promise<Mailbox> {
      const res = (await http.post('/email/mailboxes', { name, parentPath })) as { data: Mailbox };
      return MailboxSchema.parse(res.data);
    },

    async deleteMailbox(mailboxId: string): Promise<void> {
      await http.delete(`/email/mailboxes/${mailboxId}`);
    },

    // ─── Messages ───────────────────────────────────────────────────

    async listMessages(
      options: {
        mailboxId?: string;
        starred?: boolean;
        label?: string;
        limit?: number;
        offset?: number;
        unseenOnly?: boolean;
      } = {},
    ): Promise<{ data: Message[]; pagination: Pagination }> {
      const params: Record<string, string> = {};
      if (options.mailboxId) params.mailbox = options.mailboxId;
      if (options.starred) params.starred = 'true';
      if (options.label) params.label = options.label;
      if (options.limit !== undefined) params.limit = String(options.limit);
      if (options.offset !== undefined) params.offset = String(options.offset);
      if (options.unseenOnly) params.unseen = 'true';

      const res = (await http.get('/email/messages', { params })) as PaginatedResponse<Message>;
      return {
        data: z.array(MessageSchema).parse(res.data.data),
        pagination: PaginationSchema.parse(res.data.pagination),
      };
    },

    async getMessage(messageId: string): Promise<Message> {
      const res = (await http.get(`/email/messages/${messageId}`)) as { data: Message };
      return MessageSchema.parse(res.data);
    },

    async getThread(messageId: string): Promise<Message[]> {
      const res = (await http.get(`/email/messages/${messageId}/thread`)) as { data: Message[] };
      return z.array(MessageSchema).parse(res.data);
    },

    async updateFlags(messageId: string, flags: Partial<MessageFlags>): Promise<Message> {
      const res = (await http.put(`/email/messages/${messageId}/flags`, { flags })) as { data: Message };
      return MessageSchema.parse(res.data);
    },

    async updateLabels(messageId: string, add: string[], remove: string[]): Promise<Message> {
      const res = (await http.put(`/email/messages/${messageId}/labels`, { add, remove })) as { data: Message };
      return MessageSchema.parse(res.data);
    },

    async moveMessage(messageId: string, mailboxId: string): Promise<Message> {
      const res = (await http.post(`/email/messages/${messageId}/move`, { mailboxId })) as { data: Message };
      return MessageSchema.parse(res.data);
    },

    async deleteMessage(messageId: string, permanent = false): Promise<void> {
      const params = permanent ? '?permanent=true' : '';
      await http.delete(`/email/messages/${messageId}${params}`);
    },

    // ─── Labels ─────────────────────────────────────────────────────

    async listLabels(): Promise<Label[]> {
      const res = (await http.get('/email/labels')) as { data: Label[] };
      return z.array(LabelSchema).parse(res.data);
    },

    async createLabel(name: string, color: string): Promise<Label> {
      const res = (await http.post('/email/labels', { name, color })) as { data: Label };
      return LabelSchema.parse(res.data);
    },

    async updateLabel(labelId: string, updates: { name?: string; color?: string }): Promise<Label> {
      const res = (await http.put(`/email/labels/${labelId}`, updates)) as { data: Label };
      return LabelSchema.parse(res.data);
    },

    async deleteLabel(labelId: string): Promise<void> {
      await http.delete(`/email/labels/${labelId}`);
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
      const res = (await http.post('/email/messages', message)) as { data: { messageId: string; queued: boolean; message: string } };
      return z.object({
        messageId: z.string(),
        queued: z.boolean(),
        message: z.string(),
      }).parse(res.data);
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
      const res = (await http.post('/email/drafts', draft)) as { data: Message };
      return MessageSchema.parse(res.data);
    },

    // ─── Search ─────────────────────────────────────────────────────

    async search(
      options: {
        q?: string;
        from?: string;
        to?: string;
        subject?: string;
        hasAttachment?: boolean;
        dateAfter?: string;
        dateBefore?: string;
        mailbox?: string;
        limit?: number;
        offset?: number;
      } = {},
    ): Promise<{ data: Message[]; pagination: Pagination }> {
      const params: Record<string, string> = {};
      if (options.q) params.q = options.q;
      if (options.from) params.from = options.from;
      if (options.to) params.to = options.to;
      if (options.subject) params.subject = options.subject;
      if (options.hasAttachment) params.hasAttachment = 'true';
      if (options.dateAfter) params.dateAfter = options.dateAfter;
      if (options.dateBefore) params.dateBefore = options.dateBefore;
      if (options.mailbox) params.mailbox = options.mailbox;
      if (options.limit !== undefined) params.limit = String(options.limit);
      if (options.offset !== undefined) params.offset = String(options.offset);

      const res = (await http.get('/email/search', { params })) as PaginatedResponse<Message>;
      return {
        data: z.array(MessageSchema).parse(res.data.data),
        pagination: PaginationSchema.parse(res.data.pagination),
      };
    },

    // ─── Quota ──────────────────────────────────────────────────────

    async getQuota(): Promise<QuotaUsage> {
      const res = (await http.get('/email/quota')) as { data: QuotaUsage };
      return QuotaUsageSchema.parse(res.data);
    },

    // ─── Attachments ────────────────────────────────────────────────

    async uploadAttachment(file: File | Blob, filename: string): Promise<Attachment> {
      const formData = new FormData();
      formData.append('file', file, filename);
      const res = (await http.post('/email/attachments', formData)) as { data: Attachment };
      return AttachmentSchema.parse(res.data);
    },

    async getAttachmentUrl(s3Key: string): Promise<string> {
      const res = (await http.get(
        `/email/attachments/${encodeURIComponent(s3Key)}`,
      )) as { data: { url: string } };
      return z.object({ url: z.string() }).parse(res.data).url;
    },

    // ─── Settings ───────────────────────────────────────────────────

    async getSettings(): Promise<EmailSettings> {
      const res = (await http.get('/email/settings')) as { data: EmailSettings };
      return EmailSettingsSchema.parse(res.data);
    },

    async updateSettings(
      settings: { signature?: string; autoReply?: Partial<EmailSettings['autoReply']> },
    ): Promise<void> {
      await http.put('/email/settings', settings);
    },
  };
}

export type EmailApiInstance = ReturnType<typeof createEmailApi>;
