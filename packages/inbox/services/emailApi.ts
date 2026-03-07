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
  contentId: z.string().optional(),
  isInline: z.boolean().optional(),
});

export const MessageFlagsSchema = z.object({
  seen: z.boolean(),
  starred: z.boolean(),
  answered: z.boolean(),
  forwarded: z.boolean(),
  draft: z.boolean(),
  pinned: z.boolean().optional().default(false),
});

export const CardTypeSchema = z.enum(['trip', 'purchase', 'event', 'bill', 'package']);

export const MessageCardSchema = z.object({
  type: CardTypeSchema,
  data: z.record(z.string(), z.any()),
  confidence: z.number(),
  extractedAt: z.string(),
});

export const HighlightSchema = z.object({
  type: z.string(),
  value: z.string(),
  label: z.string(),
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
  card: MessageCardSchema.nullable().optional(),
  highlights: z.array(HighlightSchema).optional(),
  spamScore: z.number().nullable().optional(),
  size: z.number(),
  inReplyTo: z.string().nullable().optional(),
  references: z.array(z.string()).optional(),
  aliasTag: z.string().nullable().optional(),
  snoozedUntil: z.string().nullable().optional(),
  threadCount: z.number().optional(),
  threadParticipants: z.array(z.string()).optional(),
  senderAvatarPath: z.string().nullable().optional(),
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

export const SubscriptionSchema = z.object({
  _id: z.string(),
  name: z.string(),
  messageCount: z.number(),
  latestDate: z.string(),
  oldestDate: z.string(),
  latestMessageId: z.string(),
  hasListUnsubscribe: z.boolean(),
  type: z.enum(['list-unsubscribe', 'pattern-match', 'frequent']),
  senderAvatarPath: z.string().nullable().optional(),
});

export const UnsubscribeResultSchema = z.object({
  success: z.boolean(),
  method: z.string(),
});

export const BundleSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  matchLabels: z.array(z.string()),
  enabled: z.boolean(),
  collapsed: z.boolean(),
  order: z.number(),
});

export const ReminderSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  text: z.string(),
  remindAt: z.string(),
  completed: z.boolean(),
  pinned: z.boolean(),
  snoozedUntil: z.string().nullable().optional(),
  relatedMessageId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── Inferred Types ────────────────────────────────────────────────

export type EmailAddress = z.infer<typeof EmailAddressSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type MessageFlags = z.infer<typeof MessageFlagsSchema>;
export type CardType = z.infer<typeof CardTypeSchema>;
export type MessageCard = z.infer<typeof MessageCardSchema>;
export type Highlight = z.infer<typeof HighlightSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Mailbox = z.infer<typeof MailboxSchema>;
export type Label = z.infer<typeof LabelSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type QuotaUsage = z.infer<typeof QuotaUsageSchema>;
export type EmailSettings = z.infer<typeof EmailSettingsSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type UnsubscribeResult = z.infer<typeof UnsubscribeResultSchema>;
export type Bundle = z.infer<typeof BundleSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;

// ─── Response Helpers ──────────────────────────────────────────────

// HttpService.unwrapResponse() already strips the { data: ... } wrapper for
// non-paginated responses and returns paginated { data, pagination } as-is.
// So http.get() returns the inner value directly (or { data, pagination } for
// paginated endpoints). No extra unwrapping needed here.

interface PaginatedResult<T> {
  data: T[];
  pagination: Pagination;
}

// ─── API Client ────────────────────────────────────────────────────

export function createEmailApi(http: HttpService) {
  return {
    // ─── Mailboxes ──────────────────────────────────────────────────

    async listMailboxes(): Promise<Mailbox[]> {
      const res = await http.get('/email/mailboxes');
      return z.array(MailboxSchema).parse(res);
    },

    async createMailbox(name: string, parentPath?: string): Promise<Mailbox> {
      const res = await http.post('/email/mailboxes', { name, parentPath });
      return MailboxSchema.parse(res);
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

      const res = (await http.get('/email/messages', { params })) as PaginatedResult<Message>;
      return {
        data: z.array(MessageSchema).parse(res.data),
        pagination: PaginationSchema.parse(res.pagination),
      };
    },

    async getMessage(messageId: string): Promise<Message> {
      const res = await http.get(`/email/messages/${messageId}`);
      return MessageSchema.parse(res);
    },

    async getThread(messageId: string): Promise<Message[]> {
      const res = await http.get(`/email/messages/${messageId}/thread`);
      return z.array(MessageSchema).parse(res);
    },

    async updateFlags(messageId: string, flags: Partial<MessageFlags>): Promise<Message> {
      const res = await http.put(`/email/messages/${messageId}/flags`, { flags });
      return MessageSchema.parse(res);
    },

    async updateLabels(messageId: string, add: string[], remove: string[]): Promise<Message> {
      const res = await http.put(`/email/messages/${messageId}/labels`, { add, remove });
      return MessageSchema.parse(res);
    },

    async moveMessage(messageId: string, mailboxId: string): Promise<Message> {
      const res = await http.post(`/email/messages/${messageId}/move`, { mailboxId });
      return MessageSchema.parse(res);
    },

    async snoozeMessage(messageId: string, until: string): Promise<Message> {
      const res = await http.post(`/email/messages/${messageId}/snooze`, { until });
      return MessageSchema.parse(res);
    },

    async unsnoozeMessage(messageId: string): Promise<Message> {
      const res = await http.post(`/email/messages/${messageId}/unsnooze`);
      return MessageSchema.parse(res);
    },

    async deleteMessage(messageId: string, permanent = false): Promise<void> {
      const params = permanent ? '?permanent=true' : '';
      await http.delete(`/email/messages/${messageId}${params}`);
    },

    // ─── Labels ─────────────────────────────────────────────────────

    async listLabels(): Promise<Label[]> {
      const res = await http.get('/email/labels');
      return z.array(LabelSchema).parse(res);
    },

    async createLabel(name: string, color: string): Promise<Label> {
      const res = await http.post('/email/labels', { name, color });
      return LabelSchema.parse(res);
    },

    async updateLabel(labelId: string, updates: { name?: string; color?: string }): Promise<Label> {
      const res = await http.put(`/email/labels/${labelId}`, updates);
      return LabelSchema.parse(res);
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
      const res = await http.post('/email/messages', message);
      return z.object({
        messageId: z.string(),
        queued: z.boolean(),
        message: z.string(),
      }).parse(res);
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
      const res = await http.post('/email/drafts', draft);
      return MessageSchema.parse(res);
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

      const res = (await http.get('/email/search', { params })) as PaginatedResult<Message>;
      return {
        data: z.array(MessageSchema).parse(res.data),
        pagination: PaginationSchema.parse(res.pagination),
      };
    },

    // ─── Quota ──────────────────────────────────────────────────────

    async getQuota(): Promise<QuotaUsage> {
      const res = await http.get('/email/quota');
      return QuotaUsageSchema.parse(res);
    },

    // ─── Attachments ────────────────────────────────────────────────

    async uploadAttachment(file: File | Blob, filename: string): Promise<Attachment> {
      const formData = new FormData();
      formData.append('file', file, filename);
      const res = await http.post('/email/attachments', formData);
      return AttachmentSchema.parse(res);
    },

    async getAttachmentUrl(s3Key: string): Promise<string> {
      const res = await http.get(
        `/email/attachments/${encodeURIComponent(s3Key)}`,
      );
      return z.object({ url: z.string() }).parse(res).url;
    },

    // ─── Settings ───────────────────────────────────────────────────

    async getSettings(): Promise<EmailSettings> {
      const res = await http.get('/email/settings');
      return EmailSettingsSchema.parse(res);
    },

    async updateSettings(
      settings: { signature?: string; autoReply?: Partial<EmailSettings['autoReply']> },
    ): Promise<void> {
      await http.put('/email/settings', settings);
    },

    // ─── Subscriptions ───────────────────────────────────────────────

    async listSubscriptions(
      options: { limit?: number; offset?: number } = {},
    ): Promise<{ data: Subscription[]; pagination: Pagination }> {
      const params: Record<string, string> = {};
      if (options.limit !== undefined) params.limit = String(options.limit);
      if (options.offset !== undefined) params.offset = String(options.offset);

      const res = (await http.get('/email/subscriptions', { params })) as PaginatedResult<Subscription>;
      return {
        data: z.array(SubscriptionSchema).parse(res.data),
        pagination: PaginationSchema.parse(res.pagination),
      };
    },

    async unsubscribe(
      senderAddress: string,
      method?: 'list-unsubscribe' | 'block',
    ): Promise<UnsubscribeResult> {
      const res = await http.post('/email/subscriptions/unsubscribe', {
        senderAddress,
        method,
      });
      return UnsubscribeResultSchema.parse(res);
    },

    // ─── Bundles ────────────────────────────────────────────────────

    async listBundles(): Promise<Bundle[]> {
      const res = await http.get('/email/bundles');
      return z.array(BundleSchema).parse(res);
    },

    async updateBundle(
      bundleId: string,
      updates: { enabled?: boolean; collapsed?: boolean; matchLabels?: string[]; order?: number },
    ): Promise<Bundle> {
      const res = await http.put(`/email/bundles/${bundleId}`, updates);
      return BundleSchema.parse(res);
    },

    async listBundledMessages(
      options: { mailboxId?: string; limit?: number; offset?: number } = {},
    ): Promise<{
      primary: Message[];
      bundles: Array<{ bundle: Bundle; messages: Message[]; unreadCount: number }>;
      pagination: Pagination;
    }> {
      const params: Record<string, string> = {};
      if (options.mailboxId) params.mailbox = options.mailboxId;
      if (options.limit !== undefined) params.limit = String(options.limit);
      if (options.offset !== undefined) params.offset = String(options.offset);

      const res = await http.get('/email/messages/bundled', { params }) as {
        data: {
          primary: Message[];
          bundles: Array<{ bundle: Bundle; messages: Message[]; unreadCount: number }>;
        };
        pagination: Pagination;
      };
      return {
        primary: z.array(MessageSchema).parse(res.data.primary),
        bundles: res.data.bundles.map((b) => ({
          bundle: BundleSchema.parse(b.bundle),
          messages: z.array(MessageSchema).parse(b.messages),
          unreadCount: b.unreadCount,
        })),
        pagination: PaginationSchema.parse(res.pagination),
      };
    },

    // ─── Reminders ────────────────────────────────────────────────

    async createReminder(data: {
      text: string;
      remindAt: string;
      relatedMessageId?: string;
    }): Promise<Reminder> {
      const res = await http.post('/email/reminders', data);
      return ReminderSchema.parse(res);
    },

    async listReminders(
      options: { includeCompleted?: boolean; limit?: number; offset?: number } = {},
    ): Promise<{ data: Reminder[]; pagination: Pagination }> {
      const params: Record<string, string> = {};
      if (options.includeCompleted) params.completed = 'true';
      if (options.limit !== undefined) params.limit = String(options.limit);
      if (options.offset !== undefined) params.offset = String(options.offset);

      const res = (await http.get('/email/reminders', { params })) as PaginatedResult<Reminder>;
      return {
        data: z.array(ReminderSchema).parse(res.data),
        pagination: PaginationSchema.parse(res.pagination),
      };
    },

    async getReminder(reminderId: string): Promise<Reminder> {
      const res = await http.get(`/email/reminders/${reminderId}`);
      return ReminderSchema.parse(res);
    },

    async updateReminder(
      reminderId: string,
      updates: { text?: string; remindAt?: string; completed?: boolean; pinned?: boolean; snoozedUntil?: string | null },
    ): Promise<Reminder> {
      const res = await http.put(`/email/reminders/${reminderId}`, updates);
      return ReminderSchema.parse(res);
    },

    async deleteReminder(reminderId: string): Promise<void> {
      await http.delete(`/email/reminders/${reminderId}`);
    },
  };
}

export type EmailApiInstance = ReturnType<typeof createEmailApi>;
