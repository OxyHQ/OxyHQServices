/**
 * Email Service
 *
 * Core business logic for the Oxy email system. Handles mailbox provisioning,
 * message CRUD, quota enforcement, search, and user lifecycle.
 *
 * Email addresses are always derived: {username}@oxy.so — never stored independently.
 */

import mongoose from 'mongoose';
import { Mailbox, IMailbox } from '../models/Mailbox';
import { Message, IMessage, IEmailAddress, IAttachment } from '../models/Message';
import { Label } from '../models/Label';
import User, { IUser } from '../models/User';
import {
  DEFAULT_MAILBOXES,
  EMAIL_QUOTAS,
  EMAIL_S3_CONFIG,
  EMAIL_DOMAIN,
  resolveEmailAddress,
  extractUsername,
  extractAliasTag,
  SubscriptionTier,
} from '../config/email.config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../utils/logger';
import { NotFoundError, BadRequestError } from '../utils/error';
import { v4 as uuidv4 } from 'uuid';

// Dedicated S3 client for the email attachments bucket
const emailS3 = new S3Client({
  region: EMAIL_S3_CONFIG.region,
  credentials: {
    accessKeyId: EMAIL_S3_CONFIG.accessKeyId,
    secretAccessKey: EMAIL_S3_CONFIG.secretAccessKey,
  },
  ...(EMAIL_S3_CONFIG.endpoint ? { endpoint: EMAIL_S3_CONFIG.endpoint, forcePathStyle: true } : {}),
});

class EmailService {
  // ─── Mailbox Management ───────────────────────────────────────────

  /**
   * Provision default mailboxes for a user.
   * Called lazily on first email access or explicitly after signup.
   */
  async provisionMailboxes(userId: string): Promise<IMailbox[]> {
    const existing = await Mailbox.findOne({ userId });
    if (existing) {
      return this.listMailboxes(userId);
    }

    const docs = DEFAULT_MAILBOXES.map((mb) => ({
      userId: new mongoose.Types.ObjectId(userId),
      name: mb.name,
      path: mb.path,
      specialUse: mb.specialUse,
      retentionDays: 'retentionDays' in mb ? mb.retentionDays : null,
    }));

    await Mailbox.insertMany(docs);
    logger.info('Email mailboxes provisioned', { userId });
    return this.listMailboxes(userId);
  }

  /**
   * Ensure mailboxes exist for a user, provisioning if needed.
   */
  async ensureMailboxes(userId: string): Promise<void> {
    const count = await Mailbox.countDocuments({ userId });
    if (count === 0) {
      await this.provisionMailboxes(userId);
    }
  }

  async listMailboxes(userId: string): Promise<any[]> {
    return Mailbox.find({ userId }).sort({ path: 1 }).lean({ virtuals: true });
  }

  async getMailboxBySpecialUse(userId: string, specialUse: string): Promise<any> {
    return Mailbox.findOne({ userId, specialUse }).lean({ virtuals: true });
  }

  async getMailboxById(userId: string, mailboxId: string): Promise<any> {
    return Mailbox.findOne({ _id: mailboxId, userId }).lean({ virtuals: true });
  }

  async createMailbox(userId: string, name: string, parentPath?: string): Promise<IMailbox> {
    const path = parentPath ? `${parentPath}/${name}` : name;

    const existing = await Mailbox.findOne({ userId, path });
    if (existing) {
      throw new BadRequestError(`Mailbox "${path}" already exists`);
    }

    const mailbox = await Mailbox.create({
      userId: new mongoose.Types.ObjectId(userId),
      name,
      path,
    });

    return mailbox.toJSON() as unknown as IMailbox;
  }

  async deleteMailbox(userId: string, mailboxId: string): Promise<void> {
    const mailbox = await Mailbox.findOne({ _id: mailboxId, userId });
    if (!mailbox) {
      throw new NotFoundError('Mailbox not found');
    }
    if (mailbox.specialUse) {
      throw new BadRequestError('Cannot delete a system mailbox');
    }

    // Delete all messages in the mailbox
    await this.deleteAttachmentsForMailbox(userId, mailboxId);
    await Message.deleteMany({ userId, mailboxId });
    await Mailbox.findByIdAndDelete(mailboxId);
  }

  // ─── Messages ─────────────────────────────────────────────────────

  async listMessages(
    userId: string,
    mailboxId: string | null,
    options: { limit?: number; offset?: number; unseenOnly?: boolean; starred?: boolean; label?: string } = {}
  ): Promise<{ data: any[]; total: number; limit: number; offset: number }> {
    const { limit = 50, offset = 0, unseenOnly = false, starred = false, label } = options;

    const filter: Record<string, unknown> = { userId };
    if (mailboxId) {
      filter.mailboxId = mailboxId;
    }
    if (starred) {
      filter['flags.starred'] = true;
    }
    if (unseenOnly) {
      filter['flags.seen'] = false;
    }
    if (label) {
      filter.labels = label;
    }

    const [data, total] = await Promise.all([
      Message.find(filter)
        .sort({ date: -1 })
        .skip(offset)
        .limit(limit)
        .lean({ virtuals: true }),
      Message.countDocuments(filter),
    ]);

    return { data: data as any[], total, limit, offset };
  }

  async getMessage(userId: string, messageId: string): Promise<any> {
    return Message.findOne({ _id: messageId, userId })
      .select('+text +html +headers +encryptedBody')
      .lean({ virtuals: true });
  }

  async updateMessageFlags(
    userId: string,
    messageId: string,
    flags: Partial<IMessage['flags']>
  ): Promise<any> {
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(flags)) {
      update[`flags.${key}`] = value;
    }

    const message = await Message.findOneAndUpdate(
      { _id: messageId, userId },
      { $set: update },
      { new: true }
    ).lean({ virtuals: true });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    // Update unseen count on mailbox when seen flag changes
    if ('seen' in flags) {
      const inc = flags.seen ? -1 : 1;
      await Mailbox.findByIdAndUpdate(message.mailboxId, {
        $inc: { unseenMessages: inc },
      });
    }

    return message;
  }

  async moveMessage(userId: string, messageId: string, targetMailboxId: string): Promise<any> {
    const [message, targetMailbox] = await Promise.all([
      Message.findOne({ _id: messageId, userId }),
      Mailbox.findOne({ _id: targetMailboxId, userId }),
    ]);

    if (!message) throw new NotFoundError('Message not found');
    if (!targetMailbox) throw new NotFoundError('Target mailbox not found');

    const sourceMailboxId = message.mailboxId;

    message.mailboxId = targetMailbox._id;
    await message.save();

    // Update counters on both mailboxes
    const unseenDelta = message.flags.seen ? 0 : 1;
    await Promise.all([
      Mailbox.findByIdAndUpdate(sourceMailboxId, {
        $inc: { totalMessages: -1, unseenMessages: -unseenDelta, size: -message.size },
      }),
      Mailbox.findByIdAndUpdate(targetMailboxId, {
        $inc: { totalMessages: 1, unseenMessages: unseenDelta, size: message.size },
      }),
    ]);

    return message.toJSON() as any;
  }

  async deleteMessage(userId: string, messageId: string, permanent: boolean = false): Promise<void> {
    const message = await Message.findOne({ _id: messageId, userId });
    if (!message) throw new NotFoundError('Message not found');

    if (permanent) {
      // Delete attachments from S3
      await this.deleteMessageAttachments(message);
      await Message.findByIdAndDelete(messageId);
      await Mailbox.findByIdAndUpdate(message.mailboxId, {
        $inc: {
          totalMessages: -1,
          unseenMessages: message.flags.seen ? 0 : -1,
          size: -message.size,
        },
      });
    } else {
      // Move to Trash
      const trash = await this.getMailboxBySpecialUse(userId, '\\Trash');
      if (!trash) throw new NotFoundError('Trash mailbox not found');
      await this.moveMessage(userId, messageId, trash._id.toString());
    }
  }

  // ─── Storing an incoming message (from SMTP inbound) ──────────────

  async storeIncomingMessage(params: {
    recipientUsername: string;
    from: IEmailAddress;
    to: IEmailAddress[];
    cc?: IEmailAddress[];
    subject: string;
    text?: string;
    html?: string;
    messageId: string;
    inReplyTo?: string;
    references?: string[];
    date: Date;
    headers: Record<string, string>;
    attachments?: Array<{
      filename: string;
      contentType: string;
      content: Buffer;
      contentId?: string;
      isInline?: boolean;
    }>;
    spamScore?: number;
    spamAction?: string;
    aliasTag?: string;
    rawSize: number;
  }): Promise<any> {
    // Resolve the recipient user
    const user = await User.findOne({ username: params.recipientUsername });
    if (!user) throw new NotFoundError('Recipient user not found');

    const userId = user._id.toString();
    await this.ensureMailboxes(userId);

    // Check quota
    await this.enforceQuota(userId, params.rawSize);

    // Determine target mailbox (Spam or Inbox)
    const isSpam = (params.spamScore ?? 0) >= 5;
    const targetSpecialUse = isSpam ? '\\Junk' : '\\Inbox';
    const mailbox = await this.getMailboxBySpecialUse(userId, targetSpecialUse);
    if (!mailbox) throw new NotFoundError('Target mailbox not found');

    // Upload attachments to S3
    const storedAttachments: IAttachment[] = [];
    if (params.attachments && params.attachments.length > 0) {
      for (const att of params.attachments) {
        const s3Key = `${userId}/${uuidv4()}/${att.filename}`;
        await emailS3.send(
          new PutObjectCommand({
            Bucket: EMAIL_S3_CONFIG.bucket,
            Key: s3Key,
            Body: att.content,
            ContentType: att.contentType,
          })
        );
        storedAttachments.push({
          filename: att.filename,
          contentType: att.contentType,
          size: att.content.length,
          s3Key,
          contentId: att.contentId,
          isInline: att.isInline ?? false,
        });
      }
    }

    const totalSize =
      params.rawSize +
      storedAttachments.reduce((sum, a) => sum + a.size, 0);

    const message = await Message.create({
      userId: user._id,
      mailboxId: mailbox._id,
      messageId: params.messageId,
      from: params.from,
      to: params.to,
      cc: params.cc ?? [],
      bcc: [],
      subject: params.subject,
      text: params.text,
      html: params.html,
      headers: params.headers,
      attachments: storedAttachments,
      flags: { seen: false, starred: false, answered: false, forwarded: false, draft: false },
      encrypted: false,
      spamScore: params.spamScore,
      spamAction: params.spamAction,
      size: totalSize,
      inReplyTo: params.inReplyTo,
      references: params.references ?? [],
      aliasTag: params.aliasTag,
      date: params.date,
      receivedAt: new Date(),
    });

    // Update mailbox counters
    await Mailbox.findByIdAndUpdate(mailbox._id, {
      $inc: { totalMessages: 1, unseenMessages: 1, size: totalSize },
    });

    logger.info('Incoming email stored', {
      userId,
      from: params.from.address,
      subject: params.subject,
      mailbox: mailbox.name,
    });

    return message.toJSON() as any;
  }

  // ─── Compose & save draft / send ──────────────────────────────────

  async saveDraft(
    userId: string,
    draft: {
      to?: IEmailAddress[];
      cc?: IEmailAddress[];
      bcc?: IEmailAddress[];
      subject?: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      existingDraftId?: string;
    }
  ): Promise<any> {
    await this.ensureMailboxes(userId);
    const draftsMailbox = await this.getMailboxBySpecialUse(userId, '\\Drafts');
    if (!draftsMailbox) throw new NotFoundError('Drafts mailbox not found');

    const user = await User.findById(userId);
    if (!user || !user.username) throw new BadRequestError('User must have a username to send email');

    const fromAddress = resolveEmailAddress(user.username);
    const size = Buffer.byteLength(
      (draft.text || '') + (draft.html || ''),
      'utf8'
    );

    if (draft.existingDraftId) {
      // Update existing draft
      const updated = await Message.findOneAndUpdate(
        { _id: draft.existingDraftId, userId, 'flags.draft': true },
        {
          $set: {
            to: draft.to ?? [],
            cc: draft.cc ?? [],
            bcc: draft.bcc ?? [],
            subject: draft.subject ?? '',
            text: draft.text,
            html: draft.html,
            inReplyTo: draft.inReplyTo,
            references: draft.references ?? [],
            size,
            date: new Date(),
          },
        },
        { new: true }
      ).lean({ virtuals: true });

      if (updated) return updated;
    }

    // Create new draft
    const message = await Message.create({
      userId: new mongoose.Types.ObjectId(userId),
      mailboxId: draftsMailbox._id,
      messageId: `<${uuidv4()}@${EMAIL_DOMAIN}>`,
      from: { name: user.name?.first ? `${user.name.first} ${user.name.last || ''}`.trim() : user.username, address: fromAddress },
      to: draft.to ?? [],
      cc: draft.cc ?? [],
      bcc: draft.bcc ?? [],
      subject: draft.subject ?? '',
      text: draft.text,
      html: draft.html,
      headers: {},
      attachments: [],
      flags: { seen: true, starred: false, answered: false, forwarded: false, draft: true },
      size,
      inReplyTo: draft.inReplyTo,
      references: draft.references ?? [],
      date: new Date(),
      receivedAt: new Date(),
    });

    await Mailbox.findByIdAndUpdate(draftsMailbox._id, {
      $inc: { totalMessages: 1, size },
    });

    return message.toJSON() as any;
  }

  /**
   * Move a sent message to the Sent mailbox after it has been dispatched.
   */
  async storeSentMessage(
    userId: string,
    messageData: {
      messageId: string;
      from: IEmailAddress;
      to: IEmailAddress[];
      cc?: IEmailAddress[];
      bcc?: IEmailAddress[];
      subject: string;
      text?: string;
      html?: string;
      inReplyTo?: string;
      references?: string[];
      attachments?: IAttachment[];
      size: number;
    }
  ): Promise<any> {
    await this.ensureMailboxes(userId);
    const sentMailbox = await this.getMailboxBySpecialUse(userId, '\\Sent');
    if (!sentMailbox) throw new NotFoundError('Sent mailbox not found');

    const message = await Message.create({
      userId: new mongoose.Types.ObjectId(userId),
      mailboxId: sentMailbox._id,
      messageId: messageData.messageId,
      from: messageData.from,
      to: messageData.to,
      cc: messageData.cc ?? [],
      bcc: messageData.bcc ?? [],
      subject: messageData.subject,
      text: messageData.text,
      html: messageData.html,
      headers: {},
      attachments: messageData.attachments ?? [],
      flags: { seen: true, starred: false, answered: false, forwarded: false, draft: false },
      size: messageData.size,
      inReplyTo: messageData.inReplyTo,
      references: messageData.references ?? [],
      date: new Date(),
      receivedAt: new Date(),
    });

    await Mailbox.findByIdAndUpdate(sentMailbox._id, {
      $inc: { totalMessages: 1, size: messageData.size },
    });

    return message.toJSON() as any;
  }

  // ─── Thread / Conversation ─────────────────────────────────────────

  async getThread(userId: string, messageId: string): Promise<any[]> {
    const anchor = await Message.findOne({ _id: messageId, userId })
      .select('+text +html +headers')
      .lean({ virtuals: true });
    if (!anchor) throw new NotFoundError('Message not found');

    const threadIds: string[] = [];
    if (anchor.messageId) threadIds.push(anchor.messageId);
    if (anchor.inReplyTo) threadIds.push(anchor.inReplyTo);
    if (anchor.references?.length) threadIds.push(...anchor.references);

    if (threadIds.length === 0) return [anchor];

    const related = await Message.find({
      userId,
      $or: [
        { messageId: { $in: threadIds } },
        { inReplyTo: { $in: threadIds } },
        { references: { $in: threadIds } },
      ],
    })
      .select('+text +html +headers')
      .sort({ date: 1 })
      .lean({ virtuals: true });

    // Deduplicate (anchor may appear in results)
    const seen = new Set<string>();
    const thread: any[] = [];
    for (const msg of related) {
      const id = msg._id.toString();
      if (!seen.has(id)) {
        seen.add(id);
        thread.push(msg);
      }
    }
    if (!seen.has(anchor._id.toString())) {
      thread.push(anchor);
      thread.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    return thread;
  }

  // ─── Labels ──────────────────────────────────────────────────────────

  async listLabels(userId: string): Promise<any[]> {
    return Label.find({ userId }).sort({ order: 1, name: 1 }).lean({ virtuals: true });
  }

  async createLabel(userId: string, name: string, color: string): Promise<any> {
    const existing = await Label.findOne({ userId, name });
    if (existing) throw new BadRequestError(`Label "${name}" already exists`);

    const count = await Label.countDocuments({ userId });
    const label = await Label.create({
      userId: new mongoose.Types.ObjectId(userId),
      name: name.trim(),
      color,
      order: count,
    });
    return label.toJSON() as any;
  }

  async updateLabel(userId: string, labelId: string, updates: { name?: string; color?: string }): Promise<any> {
    const label = await Label.findOneAndUpdate(
      { _id: labelId, userId },
      { $set: updates },
      { new: true }
    ).lean({ virtuals: true });
    if (!label) throw new NotFoundError('Label not found');
    return label;
  }

  async deleteLabel(userId: string, labelId: string): Promise<void> {
    const label = await Label.findOne({ _id: labelId, userId });
    if (!label) throw new NotFoundError('Label not found');

    // Remove label from all messages
    await Message.updateMany(
      { userId, labels: label.name },
      { $pull: { labels: label.name } }
    );
    await Label.findByIdAndDelete(labelId);
  }

  async updateMessageLabels(userId: string, messageId: string, add: string[], remove: string[]): Promise<any> {
    const update: Record<string, unknown> = {};
    if (add.length > 0) {
      update.$addToSet = { labels: { $each: add } };
    }
    if (remove.length > 0) {
      update.$pull = { labels: { $in: remove } };
    }

    // Need two operations if both add and remove (can't $addToSet and $pull same field)
    let message;
    if (add.length > 0) {
      message = await Message.findOneAndUpdate(
        { _id: messageId, userId },
        { $addToSet: { labels: { $each: add } } },
        { new: true }
      ).lean({ virtuals: true });
    }
    if (remove.length > 0) {
      message = await Message.findOneAndUpdate(
        { _id: messageId, userId },
        { $pull: { labels: { $in: remove } } },
        { new: true }
      ).lean({ virtuals: true });
    }
    if (!message) throw new NotFoundError('Message not found');
    return message;
  }

  // ─── Search ───────────────────────────────────────────────────────

  async searchMessages(
    userId: string,
    query: string,
    options: {
      limit?: number;
      offset?: number;
      mailboxId?: string;
      from?: string;
      to?: string;
      subject?: string;
      hasAttachment?: boolean;
      dateAfter?: string;
      dateBefore?: string;
    } = {}
  ): Promise<{ data: any[]; total: number; limit: number; offset: number }> {
    const { limit = 50, offset = 0, mailboxId, from, to, subject, hasAttachment, dateAfter, dateBefore } = options;

    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (query) {
      filter.$text = { $search: query };
    }
    if (mailboxId) {
      filter.mailboxId = new mongoose.Types.ObjectId(mailboxId);
    }
    if (from) {
      filter['from.address'] = { $regex: from, $options: 'i' };
    }
    if (to) {
      filter['to.address'] = { $regex: to, $options: 'i' };
    }
    if (subject) {
      filter.subject = { $regex: subject, $options: 'i' };
    }
    if (hasAttachment) {
      filter['attachments.0'] = { $exists: true };
    }
    if (dateAfter || dateBefore) {
      const dateFilter: Record<string, Date> = {};
      if (dateAfter) dateFilter.$gte = new Date(dateAfter);
      if (dateBefore) dateFilter.$lte = new Date(dateBefore);
      filter.date = dateFilter;
    }

    const projection = query ? { score: { $meta: 'textScore' } } : {};
    const sort = query ? { score: { $meta: 'textScore' } } : { date: -1 as const };

    const [data, total] = await Promise.all([
      Message.find(filter, projection)
        .sort(sort as any)
        .skip(offset)
        .limit(limit)
        .lean({ virtuals: true }),
      Message.countDocuments(filter),
    ]);

    return { data: data as any[], total, limit, offset };
  }

  // ─── Quota ────────────────────────────────────────────────────────

  async getQuotaUsage(userId: string): Promise<{ used: number; limit: number; percentage: number }> {
    const result = await Mailbox.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, totalSize: { $sum: '$size' } } },
    ]);
    const used = result[0]?.totalSize ?? 0;
    const tier = await this.getUserTier(userId);
    const limit = EMAIL_QUOTAS[tier].storage;
    return { used, limit, percentage: limit > 0 ? (used / limit) * 100 : 0 };
  }

  async enforceQuota(userId: string, additionalBytes: number): Promise<void> {
    const { used, limit } = await this.getQuotaUsage(userId);
    if (used + additionalBytes > limit) {
      throw new BadRequestError('Email storage quota exceeded');
    }
  }

  async getDailySendCount(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const sentMailbox = await this.getMailboxBySpecialUse(userId, '\\Sent');
    if (!sentMailbox) return 0;

    return Message.countDocuments({
      userId,
      mailboxId: sentMailbox._id,
      receivedAt: { $gte: startOfDay },
    });
  }

  async enforceSendLimit(userId: string): Promise<void> {
    const tier = await this.getUserTier(userId);
    const limit = EMAIL_QUOTAS[tier].dailySendLimit;
    const count = await this.getDailySendCount(userId);
    if (count >= limit) {
      throw new BadRequestError('Daily send limit reached');
    }
  }

  // ─── Attachments ──────────────────────────────────────────────────

  async uploadAttachment(
    userId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string }
  ): Promise<IAttachment> {
    const tier = await this.getUserTier(userId);
    const maxSize = EMAIL_QUOTAS[tier].maxAttachmentSize;
    if (file.buffer.length > maxSize) {
      throw new BadRequestError(
        `Attachment exceeds maximum size of ${Math.round(maxSize / (1024 * 1024))} MB`
      );
    }

    const s3Key = `${userId}/${uuidv4()}/${file.originalname}`;
    await emailS3.send(
      new PutObjectCommand({
        Bucket: EMAIL_S3_CONFIG.bucket,
        Key: s3Key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    return {
      filename: file.originalname,
      contentType: file.mimetype,
      size: file.buffer.length,
      s3Key,
      isInline: false,
    };
  }

  async getAttachmentUrl(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: EMAIL_S3_CONFIG.bucket,
      Key: s3Key,
    });
    return getSignedUrl(emailS3, command, { expiresIn: 3600 });
  }

  // ─── User lifecycle ───────────────────────────────────────────────

  /**
   * Delete all email data for a user (mailboxes, messages, S3 attachments).
   * Called when the Oxy account is deleted.
   */
  async deleteAllUserData(userId: string): Promise<void> {
    // Delete all attachment files from S3
    await this.deleteAttachmentsForUser(userId);

    // Delete all messages and mailboxes
    await Message.deleteMany({ userId });
    await Mailbox.deleteMany({ userId });

    logger.info('All email data deleted for user', { userId });
  }

  /**
   * Resolve an incoming email address to a user.
   * Returns the user and alias tag (if any).
   */
  async resolveRecipient(
    emailAddress: string
  ): Promise<{ user: IUser; aliasTag: string | null } | null> {
    const username = extractUsername(emailAddress);
    if (!username) return null;

    const user = await User.findOne({ username });
    if (!user) return null;

    const aliasTag = extractAliasTag(emailAddress);
    return { user, aliasTag };
  }

  // ─── Email settings ───────────────────────────────────────────────

  async getEmailSettings(userId: string): Promise<{
    signature?: string;
    autoReply?: { enabled: boolean; subject?: string; body?: string; startDate?: Date; endDate?: Date };
    address: string;
  }> {
    const user = await User.findById(userId).select('+emailSignature +autoReply +username');
    if (!user) throw new NotFoundError('User not found');
    return {
      signature: (user as any).emailSignature ?? '',
      autoReply: (user as any).autoReply ?? { enabled: false },
      address: user.username ? resolveEmailAddress(user.username) : '',
    };
  }

  async updateEmailSettings(
    userId: string,
    settings: {
      signature?: string;
      autoReply?: { enabled: boolean; subject?: string; body?: string; startDate?: Date; endDate?: Date };
    }
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (settings.signature !== undefined) update.emailSignature = settings.signature;
    if (settings.autoReply !== undefined) update.autoReply = settings.autoReply;

    await User.findByIdAndUpdate(userId, { $set: update });
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async getUserTier(userId: string): Promise<SubscriptionTier> {
    // TODO: integrate with subscription service when ready
    // For now default to free tier
    return 'free';
  }

  private async deleteMessageAttachments(message: any): Promise<void> {
    for (const att of message.attachments) {
      try {
        await emailS3.send(
          new DeleteObjectCommand({
            Bucket: EMAIL_S3_CONFIG.bucket,
            Key: att.s3Key,
          })
        );
      } catch (error) {
        logger.error('Failed to delete attachment from S3', error instanceof Error ? error : new Error(String(error)), {
          s3Key: att.s3Key,
        });
      }
    }
  }

  private async deleteAttachmentsForMailbox(userId: string, mailboxId: string): Promise<void> {
    const cursor = Message.find({ userId, mailboxId })
      .select('attachments')
      .cursor();

    for await (const msg of cursor) {
      await this.deleteMessageAttachments(msg as IMessage);
    }
  }

  private async deleteAttachmentsForUser(userId: string): Promise<void> {
    const cursor = Message.find({ userId })
      .select('attachments')
      .cursor();

    for await (const msg of cursor) {
      await this.deleteMessageAttachments(msg as IMessage);
    }
  }
}

export const emailService = new EmailService();
export default emailService;
