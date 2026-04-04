/**
 * Email Service
 *
 * Core business logic for the Oxy email system. Handles mailbox provisioning,
 * message CRUD, quota enforcement, search, and user lifecycle.
 *
 * Email addresses are always derived: {username}@oxy.so — never stored independently.
 */

import mongoose, { type SortOrder } from 'mongoose';
import { Mailbox, IMailbox } from '../models/Mailbox';
import { Message, IMessage, IEmailAddress, IAttachment } from '../models/Message';
import { Label } from '../models/Label';
import { Bundle } from '../models/Bundle';
import User, { IUser } from '../models/User';
import { getAvatarPathsBatch } from './senderAvatar.service';
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
import { Reminder } from '../models/Reminder';
import { aiLabelingService } from './aiLabeling.service';
import { cardExtractionService } from './cardExtraction.service';
import { smtpOutbound } from './smtp.outbound';

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

    // Create welcome email in the Inbox (don't fail provisioning if this fails)
    try {
      const inbox = await Mailbox.findOne({ userId, specialUse: '\\Inbox' });
      if (inbox) {
        await this.createWelcomeEmail(userId, inbox);
      }
    } catch (err) {
      logger.error('Failed to create welcome email', err instanceof Error ? err : new Error(String(err)), {
        component: 'EmailService',
        method: 'provisionMailboxes',
        userId,
      });
    }

    return this.listMailboxes(userId);
  }

  /**
   * Ensure mailboxes exist for a user, provisioning if needed.
   * Also syncs any missing default mailboxes for existing users.
   */
  // ─── Default Labels ──────────────────────────────────────────────

  private static readonly DEFAULT_BUNDLES = [
    { name: 'Promotions', icon: 'tag-outline', color: '#34A853', matchLabels: ['Shopping'], order: 0 },
    { name: 'Social', icon: 'account-group-outline', color: '#E8710A', matchLabels: ['Social'], order: 1 },
    { name: 'Updates', icon: 'bell-outline', color: '#607D8B', matchLabels: ['Updates'], order: 2 },
    { name: 'Forums', icon: 'forum-outline', color: '#795548', matchLabels: ['Forums'], order: 3 },
  ];

  private static readonly DEFAULT_LABELS = [
    { name: 'Personal', color: '#1A73E8', order: 0 },
    { name: 'Work', color: '#34A853', order: 1 },
    { name: 'Finance', color: '#FBBC04', order: 2 },
    { name: 'Shopping', color: '#EA4335', order: 3 },
    { name: 'Travel', color: '#9334E6', order: 4 },
    { name: 'Social', color: '#E8710A', order: 5 },
    { name: 'Updates', color: '#607D8B', order: 6 },
    { name: 'Forums', color: '#795548', order: 7 },
  ];

  /**
   * Seed default labels for a user if they have none.
   * Uses the same lazy-provisioning pattern as ensureMailboxes().
   */
  async ensureDefaultLabels(userId: string): Promise<void> {
    const count = await Label.countDocuments({ userId });
    if (count > 0) return;

    const docs = EmailService.DEFAULT_LABELS.map((l) => ({
      userId: new mongoose.Types.ObjectId(userId),
      name: l.name,
      color: l.color,
      order: l.order,
    }));

    try {
      await Label.insertMany(docs, { ordered: false });
      logger.info('Default labels seeded', { userId });
    } catch (err: any) {
      // Ignore duplicate key errors (race condition safe)
      if (err.code !== 11000 && !err.message?.includes('E11000')) {
        throw err;
      }
    }
  }

  async ensureMailboxes(userId: string): Promise<void> {
    const existing = await Mailbox.find({ userId });
    if (existing.length === 0) {
      await this.provisionMailboxes(userId);
      return;
    }

    // Sync missing default mailboxes (e.g., Archive added after user created)
    const existingSpecialUse = new Set(existing.map((m) => m.specialUse).filter(Boolean));
    const missing = DEFAULT_MAILBOXES.filter((mb) => mb.specialUse && !existingSpecialUse.has(mb.specialUse));

    if (missing.length > 0) {
      const docs = missing.map((mb) => ({
        userId: new mongoose.Types.ObjectId(userId),
        name: mb.name,
        path: mb.path,
        specialUse: mb.specialUse,
        retentionDays: 'retentionDays' in mb ? mb.retentionDays : null,
      }));
      await Mailbox.insertMany(docs);
      logger.info('Synced missing default mailboxes', { userId, count: missing.length });
    }
  }

  /**
   * Create a welcome email in the user's Inbox.
   * Called once during initial mailbox provisioning.
   */
  private async createWelcomeEmail(userId: string, inboxMailbox: IMailbox): Promise<void> {
    const user = await User.findById(userId);
    if (!user) return;

    const displayName = user.name?.first || user.username || 'there';
    const recipientName = [user.name?.first, user.name?.last].filter(Boolean).join(' ') || user.username || '';
    const recipientAddress = user.username ? resolveEmailAddress(user.username) : `${userId}@${EMAIL_DOMAIN}`;

    const subject = 'Welcome to Inbox by Oxy';
    const text = [
      `Hi ${displayName},`,
      '',
      'Welcome to Inbox by Oxy — your new email, built for clarity.',
      '',
      'A few things to get you started:',
      '',
      `- Your address: ${recipientAddress}`,
      '- Smart labels sort your mail automatically',
      '- Bundles group newsletters, social updates, and promos',
      '- Snooze messages to deal with them later',
      '- Pin important emails so they stay at the top',
      '',
      'We are glad to have you here. Just reply to this email if you ever need help.',
      '',
      'The Oxy Team',
    ].join('\n');

    const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" style="color-scheme: light; supported-color-schemes: light;" xml:lang="en">
  <body>
    <div style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Your new email is ready &mdash; here&#39;s what you can do&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
    <title>Inbox by Oxy</title>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <!--[if gte mso 9]><xml>
    <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
    </xml><![endif]-->
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
      <tr>
        <td align="center" valign="top" width="100%">
          <table align="center" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td>
                <table width="550" border="0" cellspacing="0" cellpadding="0" role="presentation" style="width: 550px; background-color: #ffffff; font-family: Helvetica, Arial, sans-serif;">
                  <tr>
                    <td>
                      <!-- Logo -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr>
                          <td align="center" style="padding: 32px 24px 16px;">
                            <span style="font-size: 24px; font-weight: 700; color: #000000; letter-spacing: -0.5px;">Inbox by Oxy</span>
                          </td>
                        </tr>
                      </table>
                      <!-- Greeting bar -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr>
                          <td style="padding: 0 24px;">
                            <table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation">
                              <tr>
                                <td style="border-radius: 8px; padding: 18px 24px; background-color: #000000;">
                                  <table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation">
                                    <tr>
                                      <td valign="middle" style="color: #ffffff; font-family: Helvetica, Arial, sans-serif; font-size: 16px; line-height: 20px; font-weight: bold;">
                                        Hi, ${displayName}
                                      </td>
                                      <td align="right" style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 16px; color: #999999;">
                                        ${recipientAddress}
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      <!-- Spacer -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr><td style="line-height: 0; padding-bottom: 24px;"></td></tr>
                      </table>
                      <!-- Hero -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr>
                          <td style="padding: 0 24px;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" style="border-radius: 12px; overflow: hidden; background-color: #f0f0f0;">
                              <tr>
                                <td style="padding: 48px 32px; text-align: center;">
                                  <p style="font-size: 32px; font-weight: 700; color: #000000; margin: 0 0 8px; line-height: 1.2; letter-spacing: -0.5px;">Welcome aboard</p>
                                  <p style="font-size: 16px; color: #666666; margin: 0; line-height: 1.5;">Your email, built for clarity.</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      <!-- Spacer -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr><td style="line-height: 0; padding-bottom: 24px;"></td></tr>
                      </table>
                      <!-- Features list -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr>
                          <td style="padding: 0 24px;">
                            <p style="font-size: 18px; font-weight: 700; color: #000000; margin: 0 0 20px; line-height: 1.3;">Here&#39;s what you can do now:</p>
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                              <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
                                  <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                                    <tr>
                                      <td width="32" valign="top" style="font-size: 18px; padding-right: 12px;">&#9993;</td>
                                      <td style="font-size: 15px; line-height: 1.5; color: #333333;"><strong>Your address is ready</strong><br/><span style="color: #666666;">${recipientAddress}</span></td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
                                  <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                                    <tr>
                                      <td width="32" valign="top" style="font-size: 18px; padding-right: 12px;">&#127991;</td>
                                      <td style="font-size: 15px; line-height: 1.5; color: #333333;"><strong>Smart labels</strong><br/><span style="color: #666666;">Your mail gets sorted automatically</span></td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
                                  <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                                    <tr>
                                      <td width="32" valign="top" style="font-size: 18px; padding-right: 12px;">&#128230;</td>
                                      <td style="font-size: 15px; line-height: 1.5; color: #333333;"><strong>Bundles</strong><br/><span style="color: #666666;">Newsletters, social updates, and promos grouped together</span></td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
                                  <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                                    <tr>
                                      <td width="32" valign="top" style="font-size: 18px; padding-right: 12px;">&#9200;</td>
                                      <td style="font-size: 15px; line-height: 1.5; color: #333333;"><strong>Snooze</strong><br/><span style="color: #666666;">Hide messages and bring them back when you&#39;re ready</span></td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 12px 0;">
                                  <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                                    <tr>
                                      <td width="32" valign="top" style="font-size: 18px; padding-right: 12px;">&#128204;</td>
                                      <td style="font-size: 15px; line-height: 1.5; color: #333333;"><strong>Pin</strong><br/><span style="color: #666666;">Keep important emails at the top</span></td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      <!-- Spacer -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation">
                        <tr><td style="line-height: 0; padding-bottom: 32px;"></td></tr>
                      </table>
                      <!-- Footer -->
                      <table style="width: 100%;" border="0" cellspacing="0" cellpadding="0" role="presentation" bgcolor="#ffffff">
                        <tr>
                          <td style="padding: 32px 24px; border-top: 1px solid #f0f0f0;">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation">
                              <tr>
                                <td align="left">
                                  <span style="font-size: 16px; font-weight: 700; color: #000000; letter-spacing: -0.3px;">Inbox by Oxy</span>
                                </td>
                              </tr>
                              <tr>
                                <td align="left" style="padding-top: 12px; color: #999999; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px;">
                                  This is an automated welcome message. You can reply to this email if you ever need help.
                                </td>
                              </tr>
                              <tr>
                                <td align="left" style="padding-top: 12px; color: #999999; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px;">
                                  &copy; ${new Date().getFullYear()} Oxy. All rights reserved.
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const now = new Date();
    const size = Buffer.byteLength(text, 'utf8');

    await Message.create({
      userId: new mongoose.Types.ObjectId(userId),
      mailboxId: inboxMailbox._id,
      messageId: `<welcome-${userId}-${uuidv4()}@${EMAIL_DOMAIN}>`,
      from: { name: 'Inbox by Oxy', address: `hello@${EMAIL_DOMAIN}` },
      to: [{ name: recipientName, address: recipientAddress }],
      cc: [],
      bcc: [],
      subject,
      text,
      html,
      headers: {},
      attachments: [],
      flags: { seen: false, starred: false, answered: false, forwarded: false, draft: false, pinned: false },
      encrypted: false,
      size,
      references: [],
      date: now,
      receivedAt: now,
    });

    await Mailbox.findByIdAndUpdate(inboxMailbox._id, {
      $inc: { totalMessages: 1, unseenMessages: 1, size },
    });

    logger.info('Welcome email created', { userId });
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
        .sort({ 'flags.pinned': -1, date: -1 })
        .skip(offset)
        .limit(limit)
        .lean({ virtuals: true }),
      Message.countDocuments(filter),
    ]);

    // Enrich with thread metadata (count + participants)
    const threaded = data.filter((m: any) => m.inReplyTo || (m.references && m.references.length > 0));
    if (threaded.length > 0) {
      // Collect all thread-related message IDs
      const threadIdSet = new Set<string>();
      for (const m of threaded) {
        if (m.messageId) threadIdSet.add(m.messageId);
        if (m.inReplyTo) threadIdSet.add(m.inReplyTo);
        if (m.references) m.references.forEach((r: string) => threadIdSet.add(r));
      }
      const allThreadIds = [...threadIdSet];

      const threadAgg = await Message.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            $or: [
              { messageId: { $in: allThreadIds } },
              { inReplyTo: { $in: allThreadIds } },
              { references: { $elemMatch: { $in: allThreadIds } } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            messageIds: { $addToSet: '$messageId' },
            allMessages: {
              $push: {
                messageId: '$messageId',
                inReplyTo: '$inReplyTo',
                references: '$references',
                fromAddress: '$from.address',
              },
            },
          },
        },
      ]);

      if (threadAgg.length > 0) {
        const allMessages = threadAgg[0].allMessages;
        // Build a lookup: for each message in our page, find its thread siblings
        for (const msg of data) {
          if (!msg.inReplyTo && (!msg.references || msg.references.length === 0)) continue;

          const myIds = new Set<string>();
          if (msg.messageId) myIds.add(msg.messageId);
          if (msg.inReplyTo) myIds.add(msg.inReplyTo);
          if (msg.references) msg.references.forEach((r: string) => myIds.add(r));

          const siblings = allMessages.filter((m: any) => {
            if (myIds.has(m.messageId)) return true;
            if (m.inReplyTo && myIds.has(m.inReplyTo)) return true;
            if (m.references) return m.references.some((r: string) => myIds.has(r));
            return false;
          });

          if (siblings.length > 1) {
            msg.threadCount = siblings.length;
            msg.threadParticipants = [...new Set<string>(siblings.map((s: any) => s.fromAddress))];
          }
        }
      }
    }

    await EmailService.enrichWithAvatars(data);

    return { data, total, limit, offset };
  }

  async getMessage(userId: string, messageId: string): Promise<any> {
    const msg = await Message.findOne({ _id: messageId, userId })
      .select('+text +html +headers +encryptedBody')
      .lean({ virtuals: true });
    if (msg) await EmailService.enrichWithAvatars([msg]);
    return msg;
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

    return message.toJSON();
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
    await this.ensureDefaultLabels(userId);

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

    // Fire-and-forget AI processing (non-blocking, only for non-spam)
    if (!isSpam) {
      const msgId = message._id.toString();
      aiLabelingService.classifyAndLabel(userId, msgId).catch((err) => {
        logger.warn('AI labeling failed', { msgId, error: String(err) });
      });
      cardExtractionService.extractAndUpdate(userId, msgId).catch((err) => {
        logger.warn('Card extraction failed', { msgId, error: String(err) });
      });
    }

    return message.toJSON();
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

    return message.toJSON();
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

    return message.toJSON();
  }

  // ─── Snooze ──────────────────────────────────────────────────────────

  async snoozeMessage(userId: string, messageId: string, until: Date): Promise<any> {
    const message = await Message.findOne({ _id: messageId, userId });
    if (!message) throw new NotFoundError('Message not found');

    const snoozedMailbox = await this.getMailboxBySpecialUse(userId, '\\Snoozed');
    if (!snoozedMailbox) throw new NotFoundError('Snoozed mailbox not found');

    // Already snoozed — just update the time
    if (message.snoozedUntil) {
      message.snoozedUntil = until;
      await message.save();
      return message.toJSON();
    }

    const sourceMailboxId = message.mailboxId;
    message.snoozedUntil = until;
    message.snoozedFromMailbox = sourceMailboxId;
    message.mailboxId = snoozedMailbox._id;
    await message.save();

    // Update mailbox counters
    const unseenDelta = message.flags.seen ? 0 : 1;
    await Promise.all([
      Mailbox.findByIdAndUpdate(sourceMailboxId, {
        $inc: { totalMessages: -1, unseenMessages: -unseenDelta, size: -message.size },
      }),
      Mailbox.findByIdAndUpdate(snoozedMailbox._id, {
        $inc: { totalMessages: 1, unseenMessages: unseenDelta, size: message.size },
      }),
    ]);

    logger.info('Message snoozed', { userId, messageId, until: until.toISOString() });
    return message.toJSON();
  }

  async unsnoozeMessage(userId: string, messageId: string): Promise<any> {
    const message = await Message.findOne({ _id: messageId, userId });
    if (!message) throw new NotFoundError('Message not found');
    if (!message.snoozedUntil || !message.snoozedFromMailbox) {
      throw new BadRequestError('Message is not snoozed');
    }

    const targetMailboxId = message.snoozedFromMailbox;
    const snoozedMailboxId = message.mailboxId;

    message.mailboxId = targetMailboxId;
    message.snoozedUntil = null;
    message.snoozedFromMailbox = null;
    // Mark as unseen so it stands out when it reappears
    message.flags.seen = false;
    await message.save();

    // Update mailbox counters (now unseen in target)
    await Promise.all([
      Mailbox.findByIdAndUpdate(snoozedMailboxId, {
        $inc: { totalMessages: -1, size: -message.size },
      }),
      Mailbox.findByIdAndUpdate(targetMailboxId, {
        $inc: { totalMessages: 1, unseenMessages: 1, size: message.size },
      }),
    ]);

    logger.info('Message unsnoozed', { userId, messageId });
    return message.toJSON();
  }

  /**
   * Process all snoozed messages whose snooze time has passed.
   * Called by the snooze cron job every minute.
   */
  async processSnoozedMessages(): Promise<number> {
    const now = new Date();
    const due = await Message.find({
      snoozedUntil: { $lte: now, $ne: null },
      snoozedFromMailbox: { $ne: null },
    }).select('_id userId');

    let count = 0;
    for (const msg of due) {
      try {
        await this.unsnoozeMessage(msg.userId.toString(), msg._id.toString());
        count++;
      } catch (err) {
        logger.error('Failed to unsnooze message', err instanceof Error ? err : new Error(String(err)), {
          messageId: msg._id.toString(),
        });
      }
    }

    if (count > 0) {
      logger.info('Snooze cron processed', { count });
    }
    return count;
  }

  // ─── Thread / Conversation ─────────────────────────────────────────

  async getThread(userId: string, messageId: string): Promise<any[]> {
    const anchor = await Message.findOne({ _id: messageId, userId })
      .select('+text +html +headers')
      .lean({ virtuals: true });
    if (!anchor) throw new NotFoundError('Message not found');

    // Collect all Message-IDs related to this thread
    const threadIds: string[] = [];
    if (anchor.messageId) threadIds.push(anchor.messageId);
    if (anchor.inReplyTo) threadIds.push(anchor.inReplyTo);
    if (anchor.references?.length) threadIds.push(...anchor.references);

    // Build query to find all related messages
    // This finds: messages this one references AND messages that reference this one
    const orConditions: any[] = [];

    if (threadIds.length > 0) {
      orConditions.push(
        { messageId: { $in: threadIds } },
        { inReplyTo: { $in: threadIds } },
        { references: { $in: threadIds } }
      );
    }

    // Also find messages that reply to THIS message (for when opening first message in thread)
    if (anchor.messageId) {
      orConditions.push(
        { inReplyTo: anchor.messageId },
        { references: anchor.messageId }
      );
    }

    // If no thread relations exist, return just the anchor
    if (orConditions.length === 0) return [anchor];

    const related = await Message.find({
      userId,
      $or: orConditions,
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

    await EmailService.enrichWithAvatars(thread);

    return thread;
  }

  // ─── Labels ──────────────────────────────────────────────────────────

  async listLabels(userId: string): Promise<any[]> {
    return Label.find({ userId }).sort({ order: 1, name: 1 }).lean({ virtuals: true });
  }

  async createLabel(userId: string, name: string, color: string): Promise<any> {
    const existing = await Label.findOne({ userId, name }).collation({ locale: 'en', strength: 2 });
    if (existing) throw new BadRequestError(`Label "${name}" already exists`);

    const count = await Label.countDocuments({ userId });
    const label = await Label.create({
      userId: new mongoose.Types.ObjectId(userId),
      name: name.trim(),
      color,
      order: count,
    });
    return label.toJSON();
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
    // Validate that labels being added actually exist for this user
    if (add.length > 0) {
      const existingLabels = await Label.find({ userId, name: { $in: add } }).select('name').lean();
      const existingNames = new Set(existingLabels.map((l) => l.name));
      const missing = add.filter((name) => !existingNames.has(name));
      if (missing.length > 0) {
        throw new BadRequestError(`Labels not found: ${missing.join(', ')}`);
      }
    }

    // MongoDB cannot $addToSet and $pull on the same field in one operation,
    // so we run them sequentially with the final one returning the result.
    const filter = { _id: messageId, userId };

    // Verify message exists first
    const exists = await Message.findOne(filter).select('_id').lean();
    if (!exists) throw new NotFoundError('Message not found');

    if (add.length > 0) {
      await Message.updateOne(filter, { $addToSet: { labels: { $each: add } } });
    }
    if (remove.length > 0) {
      await Message.updateOne(filter, { $pull: { labels: { $in: remove } } });
    }

    // Return the final state
    const message = await Message.findOne(filter).lean({ virtuals: true });
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
    const sort: Record<string, SortOrder | { $meta: string }> = query
      ? { score: { $meta: 'textScore' } }
      : { date: -1 };

    const [data, total] = await Promise.all([
      Message.find(filter, projection)
        .sort(sort)
        .skip(offset)
        .limit(limit)
        .lean({ virtuals: true }),
      Message.countDocuments(filter),
    ]);

    return { data, total, limit, offset };
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
      signature: user.emailSignature ?? '',
      autoReply: user.autoReply ?? { enabled: false },
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

  // ─── Subscriptions ──────────────────────────────────────────────

  /**
   * Attach `senderAvatarPath` to each message based on sender email.
   * Uses the shared SenderAvatar cache (resolved server-side, 7-day TTL).
   */
  private static async enrichWithAvatars(messages: Array<Record<string, unknown> & { from?: IEmailAddress; senderAvatarPath?: string | null }>): Promise<void> {
    if (messages.length === 0) return;
    const emails = messages.map((m) => m.from?.address).filter((e): e is string => Boolean(e));
    if (emails.length === 0) return;
    try {
      const avatarMap = await getAvatarPathsBatch(emails);
      for (const msg of messages) {
        const addr = msg.from?.address?.trim().toLowerCase();
        if (addr && avatarMap.has(addr)) {
          msg.senderAvatarPath = avatarMap.get(addr) ?? null;
        }
      }
    } catch {
      // Avatar enrichment is non-critical — don't fail message fetch
    }
  }

  /**
   * Newsletter / subscription detection patterns.
   * Matches common automated sender addresses.
   */
  private static readonly NEWSLETTER_PATTERNS = [
    /noreply/i,
    /no-reply/i,
    /donotreply/i,
    /do-not-reply/i,
    /newsletter/i,
    /marketing/i,
    /promo/i,
    /updates@/i,
    /digest@/i,
    /notification/i,
    /mailer/i,
    /news@/i,
    /info@/i,
    /announcements@/i,
    /hello@/i,
    /team@/i,
    /support@/i,
  ];

  /**
   * SSRF protection: block requests to private/internal networks.
   */
  private static readonly PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^0\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^fc00:/i,
    /^fe80:/i,
    /^::1$/,
    /^localhost$/i,
  ];

  /**
   * Aggregate subscription senders: group messages by sender address,
   * detect newsletter characteristics, and return paginated results.
   */
  async getSubscriptions(
    userId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ data: any[]; total: number }> {
    const { limit = 50, offset = 0 } = options;

    // Only aggregate from Inbox and Archive (received mail, not sent/drafts/trash)
    const receivedMailboxes = await Mailbox.find({
      userId,
      specialUse: { $in: ['\\Inbox', '\\Archive'] },
    })
      .select('_id')
      .lean();
    const mailboxIds = receivedMailboxes.map((m) => m._id);

    if (mailboxIds.length === 0) {
      return { data: [], total: 0 };
    }

    const pipeline: any[] = [
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          mailboxId: { $in: mailboxIds },
        },
      },
      {
        $group: {
          _id: '$from.address',
          name: { $last: '$from.name' },
          messageCount: { $sum: 1 },
          latestDate: { $max: '$date' },
          oldestDate: { $min: '$date' },
          latestMessageId: { $last: '$_id' },
        },
      },
      { $match: { messageCount: { $gte: 3 } } },
      { $sort: { messageCount: -1 } },
      {
        $facet: {
          data: [{ $skip: offset }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await Message.aggregate(pipeline);
    const senders = result?.data ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    if (senders.length === 0) {
      return { data: [], total };
    }

    // Phase 2: fetch List-Unsubscribe headers for each sender's latest message
    const latestMsgIds = senders.map((s: any) => s.latestMessageId);
    const latestMessages = await Message.find({ _id: { $in: latestMsgIds } })
      .select('+headers')
      .lean();

    const headerMap = new Map<string, Record<string, string>>();
    for (const msg of latestMessages) {
      const headers: Record<string, string> = {};
      if (msg.headers instanceof Map) {
        msg.headers.forEach((v: string, k: string) => {
          headers[k.toLowerCase()] = v;
        });
      } else if (msg.headers && typeof msg.headers === 'object') {
        for (const [k, v] of Object.entries(msg.headers as Record<string, string>)) {
          headers[k.toLowerCase()] = v;
        }
      }
      headerMap.set(msg._id.toString(), headers);
    }

    // Enrich senders with unsubscribe info and type detection
    const enriched = senders.map((sender: any) => {
      const headers = headerMap.get(sender.latestMessageId.toString()) || {};
      const listUnsub = headers['list-unsubscribe'] || null;
      const listUnsubPost = headers['list-unsubscribe-post'] || null;

      let type: 'list-unsubscribe' | 'pattern-match' | 'frequent' = 'frequent';
      if (listUnsub) {
        type = 'list-unsubscribe';
      } else if (
        EmailService.NEWSLETTER_PATTERNS.some((p) => p.test(sender._id))
      ) {
        type = 'pattern-match';
      }

      return {
        _id: sender._id,
        name: sender.name || sender._id.split('@')[0],
        messageCount: sender.messageCount,
        latestDate: sender.latestDate,
        oldestDate: sender.oldestDate,
        latestMessageId: sender.latestMessageId,
        hasListUnsubscribe: !!listUnsub,
        type,
      };
    });

    // Enrich subscriptions with sender avatars
    const subEmails = enriched.map((s: any) => s._id);
    try {
      const avatarMap = await getAvatarPathsBatch(subEmails);
      for (const sub of enriched) {
        const addr = sub._id.trim().toLowerCase();
        sub.senderAvatarPath = avatarMap.get(addr) ?? null;
      }
    } catch {
      // Non-critical
    }

    return { data: enriched, total };
  }

  /**
   * Unsubscribe from a sender via List-Unsubscribe header or by blocking.
   */
  async unsubscribe(
    userId: string,
    senderAddress: string,
    method: 'list-unsubscribe' | 'block' = 'list-unsubscribe',
  ): Promise<{ success: boolean; method: string }> {
    if (method === 'list-unsubscribe') {
      // Find the latest message from this sender with headers
      const latestMsg = await Message.findOne({
        userId,
        'from.address': senderAddress.toLowerCase(),
      })
        .sort({ date: -1 })
        .select('+headers')
        .lean();

      if (latestMsg?.headers) {
        const headers: Record<string, string> = {};
        if (latestMsg.headers instanceof Map) {
          latestMsg.headers.forEach((v: string, k: string) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (typeof latestMsg.headers === 'object') {
          for (const [k, v] of Object.entries(latestMsg.headers as Record<string, string>)) {
            headers[k.toLowerCase()] = v;
          }
        }

        const listUnsub = headers['list-unsubscribe'];
        const listUnsubPost = headers['list-unsubscribe-post'];

        if (listUnsub) {
          const httpMatch = listUnsub.match(/<(https:\/\/[^>]+)>/);
          const mailtoMatch = listUnsub.match(/<mailto:([^>]+)>/);

          // RFC 8058 One-Click Unsubscribe
          if (httpMatch && listUnsubPost) {
            try {
              this.validateUnsubscribeUrl(httpMatch[1]);
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10000);
              await fetch(httpMatch[1], {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'List-Unsubscribe=One-Click-Unsubscribe',
                signal: controller.signal,
              });
              clearTimeout(timeout);
              return { success: true, method: 'one-click' };
            } catch (err) {
              logger.warn('One-click unsubscribe failed, trying fallback', {
                sender: senderAddress,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // HTTP GET fallback
          if (httpMatch) {
            try {
              this.validateUnsubscribeUrl(httpMatch[1]);
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 10000);
              await fetch(httpMatch[1], { signal: controller.signal });
              clearTimeout(timeout);
              return { success: true, method: 'http' };
            } catch (err) {
              logger.warn('HTTP unsubscribe failed, trying mailto', {
                sender: senderAddress,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // Mailto fallback
          if (mailtoMatch) {
            try {
              const [address, queryString] = mailtoMatch[1].split('?');
              const params = new URLSearchParams(queryString || '');

              const user = await User.findById(userId).select('username name');
              if (user?.username) {
                await smtpOutbound.send({
                  userId,
                  from: {
                    name: user.name?.first
                      ? `${user.name.first} ${user.name.last || ''}`.trim()
                      : user.username,
                    address: resolveEmailAddress(user.username),
                  },
                  to: [{ address, name: '' }],
                  subject: params.get('subject') || 'Unsubscribe',
                  text: params.get('body') || 'Unsubscribe',
                });
                return { success: true, method: 'mailto' };
              }
            } catch (err) {
              logger.warn('Mailto unsubscribe failed', {
                sender: senderAddress,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      // Fall through to block if List-Unsubscribe methods fail
      logger.info('No List-Unsubscribe available, falling back to block', { sender: senderAddress });
    }

    // Block sender: move all messages from this sender to Spam
    const spamMailbox = await this.getMailboxBySpecialUse(userId, '\\Junk');
    if (spamMailbox) {
      // Get messages not already in spam to update counters properly
      const messagesToMove = await Message.find({
        userId,
        'from.address': senderAddress.toLowerCase(),
        mailboxId: { $ne: spamMailbox._id },
      })
        .select('mailboxId size flags')
        .lean();

      if (messagesToMove.length > 0) {
        // Group by source mailbox for counter updates
        const byMailbox = new Map<string, { count: number; unseenCount: number; totalSize: number }>();
        for (const msg of messagesToMove) {
          const key = msg.mailboxId.toString();
          const entry = byMailbox.get(key) || { count: 0, unseenCount: 0, totalSize: 0 };
          entry.count++;
          if (!msg.flags.seen) entry.unseenCount++;
          entry.totalSize += msg.size;
          byMailbox.set(key, entry);
        }

        // Move all at once
        await Message.updateMany(
          {
            userId,
            'from.address': senderAddress.toLowerCase(),
            mailboxId: { $ne: spamMailbox._id },
          },
          { $set: { mailboxId: spamMailbox._id } },
        );

        // Update source mailbox counters
        const counterUpdates = [];
        let totalMoved = 0;
        let totalUnseenMoved = 0;
        let totalSizeMoved = 0;
        for (const [mbId, entry] of byMailbox) {
          counterUpdates.push(
            Mailbox.findByIdAndUpdate(mbId, {
              $inc: {
                totalMessages: -entry.count,
                unseenMessages: -entry.unseenCount,
                size: -entry.totalSize,
              },
            }),
          );
          totalMoved += entry.count;
          totalUnseenMoved += entry.unseenCount;
          totalSizeMoved += entry.totalSize;
        }

        // Update spam mailbox counter
        counterUpdates.push(
          Mailbox.findByIdAndUpdate(spamMailbox._id, {
            $inc: {
              totalMessages: totalMoved,
              unseenMessages: totalUnseenMoved,
              size: totalSizeMoved,
            },
          }),
        );

        await Promise.all(counterUpdates);
      }
    }

    return { success: true, method: 'blocked' };
  }

  /**
   * Validate an unsubscribe URL against SSRF attacks.
   * Only allows HTTPS URLs to non-private hosts.
   */
  private validateUnsubscribeUrl(url: string): void {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS unsubscribe URLs are allowed');
    }
    if (EmailService.PRIVATE_IP_PATTERNS.some((p) => p.test(parsed.hostname))) {
      throw new Error('Private network URLs are not allowed');
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async getUserTier(userId: string): Promise<SubscriptionTier> {
    try {
      const BillingSubscription = mongoose.model('BillingSubscription');
      const subscription = await BillingSubscription.findOne({
        userId,
        status: { $in: ['active', 'trialing'] },
      }).select('plan.name').lean() as { plan?: { name?: string } } | null;

      if (!subscription?.plan?.name) return 'free';

      const planName = subscription.plan.name.toLowerCase();
      if (planName === 'business') return 'business';
      if (planName === 'pro') return 'pro';
      return 'free';
    } catch {
      // Model not registered or DB error -- default to free
      return 'free';
    }
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

  // ─── Bundles ─────────────────────────────────────────────────────

  async ensureDefaultBundles(userId: string): Promise<void> {
    const count = await Bundle.countDocuments({ userId });
    if (count > 0) return;

    const docs = EmailService.DEFAULT_BUNDLES.map((b) => ({
      userId: new mongoose.Types.ObjectId(userId),
      name: b.name,
      icon: b.icon,
      color: b.color,
      matchLabels: b.matchLabels,
      order: b.order,
      enabled: true,
      collapsed: true,
    }));

    try {
      await Bundle.insertMany(docs, { ordered: false });
      logger.info('Default bundles seeded', { userId });
    } catch (err: any) {
      if (err.code !== 11000 && !err.message?.includes('E11000')) {
        throw err;
      }
    }
  }

  async listBundles(userId: string): Promise<any[]> {
    await this.ensureDefaultBundles(userId);
    return Bundle.find({ userId }).sort({ order: 1 }).lean();
  }

  async updateBundle(
    userId: string,
    bundleId: string,
    updates: { enabled?: boolean; collapsed?: boolean; matchLabels?: string[]; order?: number },
  ): Promise<any> {
    const bundle = await Bundle.findOneAndUpdate(
      { _id: bundleId, userId },
      { $set: updates },
      { new: true },
    ).lean();
    if (!bundle) throw new NotFoundError('Bundle not found');
    return bundle;
  }

  async listBundledMessages(
    userId: string,
    mailboxId: string | null,
    options: { limit: number; offset: number },
  ): Promise<{
    primary: any[];
    bundles: Array<{ bundle: any; messages: any[]; unreadCount: number }>;
    total: number;
  }> {
    // Get enabled bundles
    await this.ensureDefaultBundles(userId);
    const bundles = await Bundle.find({ userId, enabled: true }).sort({ order: 1 }).lean();

    // Collect all label names that belong to any bundle
    const bundledLabels = new Set<string>();
    for (const b of bundles) {
      for (const l of b.matchLabels) {
        bundledLabels.add(l);
      }
    }

    // Query all messages for this mailbox
    const query: Record<string, any> = { userId };
    if (mailboxId) query.mailboxId = new mongoose.Types.ObjectId(mailboxId);

    const allMessages = await Message.find(query)
      .sort({ 'flags.pinned': -1, date: -1 })
      .skip(options.offset)
      .limit(options.limit)
      .lean();

    const total = await Message.countDocuments(query);

    // Partition into primary vs bundled
    const primary: any[] = [];
    const bundleMap = new Map<string, any[]>();

    for (const b of bundles) {
      bundleMap.set(b._id.toString(), []);
    }

    for (const msg of allMessages) {
      const msgLabels = msg.labels || [];
      let matched = false;

      for (const b of bundles) {
        if (b.matchLabels.some((l: string) => msgLabels.includes(l))) {
          bundleMap.get(b._id.toString())!.push(msg);
          matched = true;
          break; // First matching bundle wins
        }
      }

      if (!matched) {
        primary.push(msg);
      }
    }

    const bundleResults = bundles.map((b) => {
      const messages = bundleMap.get(b._id.toString()) || [];
      const unreadCount = messages.filter((m: any) => !m.flags?.seen).length;
      return { bundle: b, messages, unreadCount };
    }).filter((br) => br.messages.length > 0);

    return { primary, bundles: bundleResults, total };
  }

  // ─── Reminders ──────────────────────────────────────────────────

  async createReminder(
    userId: string,
    data: { text: string; remindAt: string; relatedMessageId?: string },
  ) {
    const reminder = await Reminder.create({
      userId,
      text: data.text,
      remindAt: new Date(data.remindAt),
      relatedMessageId: data.relatedMessageId || null,
    });
    return reminder.toJSON();
  }

  async listReminders(
    userId: string,
    options: { includeCompleted?: boolean; limit?: number; offset?: number } = {},
  ) {
    const filter: Record<string, any> = { userId };
    if (!options.includeCompleted) {
      filter.completed = false;
    }

    const total = await Reminder.countDocuments(filter);
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const reminders = await Reminder.find(filter)
      .sort({ pinned: -1, remindAt: 1 })
      .skip(offset)
      .limit(limit)
      .lean();

    return {
      data: reminders,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    };
  }

  async getReminder(userId: string, reminderId: string) {
    const reminder = await Reminder.findOne({ _id: reminderId, userId });
    if (!reminder) throw new NotFoundError('Reminder not found');
    return reminder.toJSON();
  }

  async updateReminder(
    userId: string,
    reminderId: string,
    updates: { text?: string; remindAt?: string; completed?: boolean; pinned?: boolean; snoozedUntil?: string | null },
  ) {
    const updateData: Record<string, any> = {};
    if (updates.text !== undefined) updateData.text = updates.text;
    if (updates.remindAt !== undefined) updateData.remindAt = new Date(updates.remindAt);
    if (updates.completed !== undefined) updateData.completed = updates.completed;
    if (updates.pinned !== undefined) updateData.pinned = updates.pinned;
    if (updates.snoozedUntil !== undefined) {
      updateData.snoozedUntil = updates.snoozedUntil ? new Date(updates.snoozedUntil) : null;
    }

    const reminder = await Reminder.findOneAndUpdate(
      { _id: reminderId, userId },
      { $set: updateData },
      { new: true },
    );
    if (!reminder) throw new NotFoundError('Reminder not found');
    return reminder.toJSON();
  }

  async deleteReminder(userId: string, reminderId: string) {
    const result = await Reminder.deleteOne({ _id: reminderId, userId });
    if (result.deletedCount === 0) throw new NotFoundError('Reminder not found');
  }

  async processDueReminders() {
    const now = new Date();
    const dueReminders = await Reminder.find({
      completed: false,
      remindAt: { $lte: now },
      $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
    }).lean();

    // For now, mark due reminders as "ready" by clearing snoozedUntil
    // In the future, this could push notifications
    for (const reminder of dueReminders) {
      if (reminder.snoozedUntil) {
        await Reminder.updateOne(
          { _id: reminder._id },
          { $set: { snoozedUntil: null } },
        );
      }
    }

    return dueReminders.length;
  }
}

export const emailService = new EmailService();
export default emailService;
