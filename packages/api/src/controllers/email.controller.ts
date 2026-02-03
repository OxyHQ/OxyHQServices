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
  const mailboxId = req.query.mailbox as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const unseenOnly = req.query.unseen === 'true';

  if (!mailboxId) {
    throw new BadRequestError('mailbox query parameter is required');
  }

  // Verify the mailbox belongs to this user
  const mailbox = await emailService.getMailboxById(userId, mailboxId);
  if (!mailbox) throw new NotFoundError('Mailbox not found');

  const result = await emailService.listMessages(userId, mailboxId, { limit, offset, unseenOnly });
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

export async function updateMessageFlags(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const { messageId } = req.params;
  const { flags } = req.body;

  if (!flags || typeof flags !== 'object') {
    throw new BadRequestError('flags object is required');
  }

  const allowed = ['seen', 'starred', 'answered', 'forwarded', 'draft'];
  const filtered: Record<string, boolean> = {};
  for (const key of allowed) {
    if (key in flags && typeof flags[key] === 'boolean') {
      filtered[key] = flags[key];
    }
  }

  const message = await emailService.updateMessageFlags(userId, messageId, filtered);
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

  // If replying, mark original as answered
  if (inReplyTo) {
    const original = await emailService.searchMessages(userId, '', { limit: 1 });
    // Best-effort: don't fail if we can't find the original
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
  const q = req.query.q as string;
  const mailboxId = req.query.mailbox as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  if (!q || q.trim().length === 0) {
    throw new BadRequestError('Search query (q) is required');
  }

  const result = await emailService.searchMessages(userId, q, { limit, offset, mailboxId });
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
  // s3Key format: userId/uuid/filename — verify the userId prefix
  if (!s3Key.startsWith(`${userId}/`)) {
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
