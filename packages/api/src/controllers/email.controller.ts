/**
 * Email Controller
 *
 * Request handlers for all /email routes.
 * Delegates to emailService for business logic and smtpOutbound for sending.
 */

import { Request, Response } from 'express';
import { emailService } from '../services/email.service';
import { smtpOutbound } from '../services/smtp.outbound';
import { resolveEmailAddress, EMAIL_DOMAIN } from '../config/email.config';
import User from '../models/User';
import { Message } from '../models/Message';
import {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
} from '../utils/error';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: { id: string };
}

// ─── Mailboxes ────────────────────────────────────────────────────

export async function listMailboxes(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  await emailService.ensureMailboxes(userId);
  const mailboxes = await emailService.listMailboxes(userId);
  res.json({ data: mailboxes });
}

export async function createMailbox(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { name, parentPath } = req.body;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('Mailbox name is required');
  }

  const mailbox = await emailService.createMailbox(userId, name.trim(), parentPath);
  res.status(201).json({ data: mailbox });
}

export async function deleteMailbox(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { mailboxId } = req.params;

  await emailService.deleteMailbox(userId, mailboxId);
  res.json({ data: { message: 'Mailbox deleted' } });
}

// ─── Messages ─────────────────────────────────────────────────────

export async function listMessages(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const mailboxId = req.query.mailbox as string | undefined;
  const starred = req.query.starred === 'true';
  const label = req.query.label as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const unseenOnly = req.query.unseen === 'true';

  // Must have at least one filter: mailbox, starred, or label
  if (!mailboxId && !starred && !label) {
    throw new BadRequestError('mailbox, starred, or label query parameter is required');
  }

  // Verify the mailbox belongs to this user (if provided)
  if (mailboxId) {
    const mailbox = await emailService.getMailboxById(userId, mailboxId);
    if (!mailbox) throw new NotFoundError('Mailbox not found');
  }

  const result = await emailService.listMessages(userId, mailboxId || null, {
    limit, offset, unseenOnly, starred, label,
  });
  res.json({
    data: result.data,
    pagination: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.offset + result.limit < result.total,
    },
  });
}

export async function getMessage(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;

  const message = await emailService.getMessage(userId, messageId);
  if (!message) throw new NotFoundError('Message not found');

  // Auto-mark as seen when fetched
  if (!message.flags.seen) {
    await emailService.updateMessageFlags(userId, messageId, { seen: true });
    message.flags.seen = true;
  }

  res.json({ data: message });
}

export async function getThread(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;

  const thread = await emailService.getThread(userId, messageId);
  res.json({ data: thread });
}

export async function updateMessageFlags(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;
  const { flags } = req.body;

  if (!flags || typeof flags !== 'object') {
    throw new BadRequestError('flags object is required');
  }

  const allowed = ['seen', 'starred', 'answered', 'forwarded', 'draft', 'pinned'];
  const filtered: Record<string, boolean> = {};
  for (const key of allowed) {
    if (key in flags && typeof flags[key] === 'boolean') {
      filtered[key] = flags[key];
    }
  }

  const message = await emailService.updateMessageFlags(userId, messageId, filtered);
  res.json({ data: message });
}

export async function updateMessageLabels(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;
  const { add = [], remove = [] } = req.body;

  if (!Array.isArray(add) || !Array.isArray(remove)) {
    throw new BadRequestError('add and remove must be arrays');
  }

  const message = await emailService.updateMessageLabels(userId, messageId, add, remove);
  res.json({ data: message });
}

export async function moveMessage(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;
  const { mailboxId } = req.body;

  if (!mailboxId) {
    throw new BadRequestError('mailboxId is required');
  }

  const message = await emailService.moveMessage(userId, messageId, mailboxId);
  res.json({ data: message });
}

export async function deleteMessage(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;
  const permanent = req.query.permanent === 'true';

  await emailService.deleteMessage(userId, messageId, permanent);
  res.json({ data: { message: 'Message deleted' } });
}

// ─── Snooze ──────────────────────────────────────────────────────

export async function snoozeMessage(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;
  const { until } = req.body;

  if (!until || typeof until !== 'string') {
    throw new BadRequestError('until (ISO date string) is required');
  }

  const untilDate = new Date(until);
  if (isNaN(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
    throw new BadRequestError('until must be a valid future date');
  }

  const message = await emailService.snoozeMessage(userId, messageId, untilDate);
  res.json({ data: message });
}

export async function unsnoozeMessage(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;

  const message = await emailService.unsnoozeMessage(userId, messageId);
  res.json({ data: message });
}

// ─── Labels ──────────────────────────────────────────────────────

export async function listLabels(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const labels = await emailService.listLabels(userId);
  res.json({ data: labels });
}

export async function createLabel(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { name, color } = req.body;

  if (!name || typeof name !== 'string') {
    throw new BadRequestError('Label name is required');
  }

  const label = await emailService.createLabel(userId, name.trim(), color || '#4285f4');
  res.status(201).json({ data: label });
}

export async function updateLabel(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { labelId } = req.params;
  const { name, color } = req.body;

  const updates: { name?: string; color?: string } = {};
  if (name) updates.name = name.trim();
  if (color) updates.color = color;

  const label = await emailService.updateLabel(userId, labelId, updates);
  res.json({ data: label });
}

export async function deleteLabel(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { labelId } = req.params;

  await emailService.deleteLabel(userId, labelId);
  res.json({ data: { message: 'Label deleted' } });
}

// ─── Compose & Send ─────────────────────────────────────────────

export async function sendMessage(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { to, cc, bcc, subject, text, html, inReplyTo, references, attachments } = req.body;

  if (!to || !Array.isArray(to) || to.length === 0) {
    throw new BadRequestError('At least one recipient (to) is required');
  }

  // Enforce send limit
  await emailService.enforceSendLimit(userId);

  // Get sender info
  const user = await User.findById(userId).select('username name');
  if (!user || !user.username) {
    throw new BadRequestError('User must have a username to send email');
  }

  const fromAddress = resolveEmailAddress(user.username);
  const fromName = user.name?.first
    ? `${user.name.first} ${user.name.last || ''}`.trim()
    : user.username;

  const result = await smtpOutbound.send({
    userId,
    from: { name: fromName, address: fromAddress },
    to,
    cc,
    bcc,
    subject: subject || '',
    text,
    html,
    inReplyTo,
    references,
    attachments,
  });

  // If replying, mark original message as answered (best-effort)
  if (inReplyTo) {
    try {
      const original = await Message.findOne({ userId, messageId: inReplyTo });
      if (original) {
        await emailService.updateMessageFlags(userId, original._id.toString(), { answered: true });
      }
    } catch {
      // Best-effort: don't fail the send if we can't update the original
    }
  }

  res.status(202).json({
    data: {
      messageId: result.messageId,
      queued: result.queued,
      message: result.queued ? 'Message queued for delivery' : 'Message sent',
    },
  });
}

export async function saveDraft(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { to, cc, bcc, subject, text, html, inReplyTo, references, existingDraftId } = req.body;

  const draft = await emailService.saveDraft(userId, {
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    inReplyTo,
    references,
    existingDraftId,
  });

  res.status(201).json({ data: draft });
}

// ─── Search ─────────────────────────────────────────────────────

export async function searchMessages(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const q = req.query.q as string | undefined;
  const mailboxId = req.query.mailbox as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const subject = req.query.subject as string | undefined;
  const hasAttachment = req.query.hasAttachment === 'true';
  const dateAfter = req.query.dateAfter as string | undefined;
  const dateBefore = req.query.dateBefore as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  // At least one search criterion required
  if (!q && !from && !to && !subject && !hasAttachment && !dateAfter && !dateBefore) {
    throw new BadRequestError('At least one search parameter is required');
  }

  const result = await emailService.searchMessages(userId, q || '', {
    limit, offset, mailboxId, from, to, subject,
    hasAttachment: hasAttachment || undefined,
    dateAfter, dateBefore,
  });
  res.json({
    data: result.data,
    pagination: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.offset + result.limit < result.total,
    },
  });
}

// ─── Quota ──────────────────────────────────────────────────────

export async function getQuota(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const quota = await emailService.getQuotaUsage(userId);
  res.json({ data: quota });
}

// ─── Attachments ────────────────────────────────────────────────

export async function uploadAttachment(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const file = req.file;

  if (!file) {
    throw new BadRequestError('File is required');
  }

  const attachment = await emailService.uploadAttachment(userId, {
    buffer: file.buffer,
    originalname: file.originalname,
    mimetype: file.mimetype,
  });

  res.status(201).json({ data: attachment });
}

export async function getAttachmentUrl(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { s3Key } = req.params;

  // Verify the attachment belongs to a message owned by this user
  // Check both the S3 key prefix and that a message with this attachment exists
  if (!s3Key.startsWith(`${userId}/`)) {
    throw new UnauthorizedError('Not authorized to access this attachment');
  }

  const ownsAttachment = await Message.exists({
    userId,
    'attachments.s3Key': s3Key,
  });
  if (!ownsAttachment) {
    throw new UnauthorizedError('Not authorized to access this attachment');
  }

  const url = await emailService.getAttachmentUrl(s3Key);
  res.json({ data: { url } });
}

// ─── Settings ───────────────────────────────────────────────────

export async function getEmailSettings(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const settings = await emailService.getEmailSettings(userId);
  res.json({ data: settings });
}

export async function updateEmailSettings(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { signature, autoReply } = req.body;

  await emailService.updateEmailSettings(userId, { signature, autoReply });
  res.json({ data: { message: 'Settings updated' } });
}

// ─── Subscriptions ──────────────────────────────────────────────

export async function listSubscriptions(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await emailService.getSubscriptions(userId, { limit, offset });
  res.json({
    data: result.data,
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total,
    },
  });
}

export async function unsubscribe(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { senderAddress, method } = req.body;

  if (!senderAddress || typeof senderAddress !== 'string') {
    throw new BadRequestError('senderAddress is required');
  }

  const allowedMethods = ['list-unsubscribe', 'block'];
  if (method && !allowedMethods.includes(method)) {
    throw new BadRequestError('method must be "list-unsubscribe" or "block"');
  }

  const result = await emailService.unsubscribe(userId, senderAddress, method || 'list-unsubscribe');
  res.json({ data: result });
}

// ─── Bundles ──────────────────────────────────────────────────────

export async function listBundles(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const bundles = await emailService.listBundles(userId);
  res.json({ data: bundles });
}

export async function updateBundle(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { bundleId } = req.params;
  const { enabled, collapsed, matchLabels, order } = req.body;

  const updates: Record<string, any> = {};
  if (typeof enabled === 'boolean') updates.enabled = enabled;
  if (typeof collapsed === 'boolean') updates.collapsed = collapsed;
  if (Array.isArray(matchLabels)) updates.matchLabels = matchLabels;
  if (typeof order === 'number') updates.order = order;

  const bundle = await emailService.updateBundle(userId, bundleId, updates);
  res.json({ data: bundle });
}

export async function listBundledMessages(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const mailboxId = req.query.mailbox as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await emailService.listBundledMessages(userId, mailboxId || null, { limit, offset });
  res.json({
    data: {
      primary: result.primary,
      bundles: result.bundles,
    },
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total,
    },
  });
}

// ─── Reminders ──────────────────────────────────────────────────

export async function createReminder(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { text, remindAt, relatedMessageId } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new BadRequestError('Reminder text is required');
  }
  if (!remindAt) {
    throw new BadRequestError('remindAt is required');
  }
  const remindDate = new Date(remindAt);
  if (isNaN(remindDate.getTime()) || remindDate <= new Date()) {
    throw new BadRequestError('remindAt must be a valid future date');
  }

  const reminder = await emailService.createReminder(userId, {
    text: text.trim(),
    remindAt,
    relatedMessageId,
  });
  res.status(201).json({ data: reminder });
}

export async function listReminders(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const includeCompleted = req.query.completed === 'true';
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await emailService.listReminders(userId, { includeCompleted, limit, offset });
  res.json({ data: result.data, pagination: result.pagination });
}

export async function getReminder(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const reminder = await emailService.getReminder(userId, req.params.reminderId);
  res.json({ data: reminder });
}

export async function updateReminder(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { reminderId } = req.params;
  const { text, remindAt, completed, pinned, snoozedUntil } = req.body;

  const updates: Record<string, any> = {};
  if (text !== undefined) updates.text = text;
  if (remindAt !== undefined) updates.remindAt = remindAt;
  if (completed !== undefined) updates.completed = completed;
  if (pinned !== undefined) updates.pinned = pinned;
  if (snoozedUntil !== undefined) updates.snoozedUntil = snoozedUntil;

  const reminder = await emailService.updateReminder(userId, reminderId, updates);
  res.json({ data: reminder });
}

export async function deleteReminder(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  await emailService.deleteReminder(userId, req.params.reminderId);
  res.status(204).send();
}
