import { z } from 'zod';

// POST /email/mailboxes
export const createMailboxSchema = z.object({
  name: z.string().trim().min(1),
  parentPath: z.string().trim().optional(),
});

// Params with :mailboxId
export const mailboxIdParams = z.object({
  mailboxId: z.string().trim().min(1),
});

// Params with :messageId
export const messageIdParams = z.object({
  messageId: z.string().trim().min(1),
});

// PUT /email/messages/:messageId/flags
export const updateFlagsSchema = z.object({
  flags: z.object({
    seen: z.boolean().optional(),
    starred: z.boolean().optional(),
    answered: z.boolean().optional(),
    forwarded: z.boolean().optional(),
    draft: z.boolean().optional(),
    pinned: z.boolean().optional(),
  }),
});

// PUT /email/messages/:messageId/labels
export const updateLabelsSchema = z.object({
  add: z.array(z.string()).optional().default([]),
  remove: z.array(z.string()).optional().default([]),
});

// POST /email/messages/:messageId/move
export const moveMessageSchema = z.object({
  mailboxId: z.string().trim().min(1),
});

// POST /email/messages/:messageId/snooze
export const snoozeMessageSchema = z.object({
  until: z.string().trim().min(1),
});

// POST /email/messages/bulk/flags
export const bulkUpdateFlagsSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(100),
  flags: z.object({
    seen: z.boolean().optional(),
    starred: z.boolean().optional(),
    answered: z.boolean().optional(),
    forwarded: z.boolean().optional(),
    draft: z.boolean().optional(),
    pinned: z.boolean().optional(),
  }),
});

// POST /email/messages/bulk/move
export const bulkMoveMessagesSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(100),
  mailboxId: z.string().trim().min(1),
});

// POST /email/labels
export const createLabelSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().optional(),
});

// Params with :labelId
export const labelIdParams = z.object({
  labelId: z.string().trim().min(1),
});

// PUT /email/labels/:labelId
export const updateLabelSchema = z.object({
  name: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

// POST /email/messages (send)
export const sendMessageSchema = z.object({
  to: z.array(z.string().min(1)).min(1),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  attachments: z.array(z.any()).optional(),
});

// POST /email/drafts
export const saveDraftSchema = z.object({
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  existingDraftId: z.string().optional(),
});

// POST /email/subscriptions/unsubscribe
export const unsubscribeSchema = z.object({
  senderAddress: z.string().trim().min(1),
  method: z.enum(['list-unsubscribe', 'block']).optional(),
});

// PUT /email/bundles/:bundleId
export const bundleIdParams = z.object({
  bundleId: z.string().trim().min(1),
});

export const updateBundleSchema = z.object({
  enabled: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  matchLabels: z.array(z.string()).optional(),
  order: z.number().optional(),
});

// PUT /email/settings
export const updateEmailSettingsSchema = z.object({
  signature: z.string().optional(),
  autoReply: z.any().optional(),
});

// POST /email/reminders
export const createReminderSchema = z.object({
  text: z.string().trim().min(1),
  remindAt: z.string().trim().min(1),
  relatedMessageId: z.string().optional(),
});

// Params with :reminderId
export const reminderIdParams = z.object({
  reminderId: z.string().trim().min(1),
});

// PUT /email/reminders/:reminderId
export const updateReminderSchema = z.object({
  text: z.string().trim().optional(),
  remindAt: z.string().trim().optional(),
  status: z.enum(['pending', 'completed', 'dismissed']).optional(),
});
