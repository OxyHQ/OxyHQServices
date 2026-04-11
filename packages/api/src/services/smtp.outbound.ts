import nodemailer, { Transporter } from 'nodemailer';
import {
  SMTP_OUTBOUND_CONFIG,
  DKIM_CONFIG,
  EMAIL_DOMAIN,
  EMAIL_S3_CONFIG,
  resolveEmailAddress,
} from '../config/email.config';
import { emailService } from './email.service';
import { IEmailAddress, IAttachment } from '../models/Message';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { getRedisClient } from '../config/redis';

const emailS3 = new S3Client({
  region: EMAIL_S3_CONFIG.region,
  credentials: {
    accessKeyId: EMAIL_S3_CONFIG.accessKeyId,
    secretAccessKey: EMAIL_S3_CONFIG.secretAccessKey,
  },
  ...(EMAIL_S3_CONFIG.endpoint ? { endpoint: EMAIL_S3_CONFIG.endpoint, forcePathStyle: true } : {}),
});

interface OutboundMessage {
  userId: string;
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
  /** When true, add Disposition-Notification-To header requesting a read receipt */
  requestReadReceipt?: boolean;
}

interface QueuedMessage extends OutboundMessage {
  id: string;
  attempts: number;
  nextRetry: number;
  messageId: string;
}

const REDIS_QUEUE_KEY = 'smtp:retry:queue';
const REDIS_SCHEDULE_KEY = 'smtp:retry:schedule';

class SmtpOutboundService {
  private transporter: Transporter;
  private localQueue: Map<string, QueuedMessage> = new Map();
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.transporter = this.createTransporter();
  }

  private createTransporter(): Transporter {
    const transportConfig: Record<string, unknown> = SMTP_OUTBOUND_CONFIG.relayHost
      ? {
          host: SMTP_OUTBOUND_CONFIG.relayHost,
          port: SMTP_OUTBOUND_CONFIG.relayPort,
          secure: SMTP_OUTBOUND_CONFIG.relayPort === 465,
          auth:
            SMTP_OUTBOUND_CONFIG.relayUser && SMTP_OUTBOUND_CONFIG.relayPass
              ? {
                  user: SMTP_OUTBOUND_CONFIG.relayUser,
                  pass: SMTP_OUTBOUND_CONFIG.relayPass,
                }
              : undefined,
        }
      : { direct: true };

    if (DKIM_CONFIG.privateKey) {
      (transportConfig as any).dkim = {
        domainName: DKIM_CONFIG.domainName,
        keySelector: DKIM_CONFIG.keySelector,
        privateKey: DKIM_CONFIG.privateKey,
      };
    }

    return nodemailer.createTransport(transportConfig as any);
  }

  async send(message: OutboundMessage): Promise<{ messageId: string; queued: boolean }> {
    const messageId = `<${uuidv4()}@${EMAIL_DOMAIN}>`;
    const nmAttachments = await this.resolveAttachments(message.attachments || []);

    const mailOptions = {
      messageId,
      from: `${message.from.name || ''} <${message.from.address}>`.trim(),
      to: message.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      cc: message.cc?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      bcc: message.bcc?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
      inReplyTo: message.inReplyTo,
      references: message.references?.join(' '),
      attachments: nmAttachments,
      headers: message.requestReadReceipt
        ? { 'Disposition-Notification-To': `${message.from.name || ''} <${message.from.address}>`.trim() }
        : undefined,
    };

    try {
      await this.transporter.sendMail(mailOptions);

      const size = Buffer.byteLength((message.text || '') + (message.html || ''), 'utf8');
      await emailService.storeSentMessage(message.userId, {
        messageId,
        from: message.from,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        text: message.text,
        html: message.html,
        inReplyTo: message.inReplyTo,
        references: message.references,
        attachments: message.attachments,
        size,
      });

      logger.info('Email sent', {
        messageId,
        to: message.to.map((a) => a.address).join(', '),
      });

      return { messageId, queued: false };
    } catch (error) {
      logger.error('Email send failed, queuing for retry', error instanceof Error ? error : new Error(String(error)));
      await this.enqueue({ ...message, messageId });
      return { messageId, queued: true };
    }
  }

  /**
   * Send a message via SMTP without storing it in the Sent mailbox.
   * Used for scheduled messages that are already stored.
   */
  async sendRaw(message: OutboundMessage): Promise<void> {
    const messageId = `<${uuidv4()}@${EMAIL_DOMAIN}>`;
    const nmAttachments = await this.resolveAttachments(message.attachments || []);

    const mailOptions = {
      messageId,
      from: `${message.from.name || ''} <${message.from.address}>`.trim(),
      to: message.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      cc: message.cc?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      bcc: message.bcc?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
      inReplyTo: message.inReplyTo,
      references: message.references?.join(' '),
      attachments: nmAttachments,
    };

    await this.transporter.sendMail(mailOptions);

    logger.info('Scheduled email sent', {
      messageId,
      to: message.to.map((a) => a.address).join(', '),
    });
  }

  /**
   * Send an MDN (Message Disposition Notification) per RFC 3798.
   * This is a multipart/report message with a human-readable part and a machine-readable
   * disposition-notification part.
   */
  async sendMdn(params: {
    from: IEmailAddress;
    to: string;
    originalRecipient: string;
    originalMessageId: string;
    originalSubject: string;
  }): Promise<void> {
    const mdnMessageId = `<${uuidv4()}@${EMAIL_DOMAIN}>`;
    const boundary = `----=_MDN_${uuidv4().replace(/-/g, '')}`;
    const reportingUA = 'inbox.oxy.so; Inbox by Oxy';
    const now = new Date().toUTCString();

    // Human-readable part
    const humanText = [
      `Your message was displayed to ${params.originalRecipient}.`,
      '',
      `  Subject: ${params.originalSubject}`,
      `  Date: ${now}`,
      '',
      'This is a Message Disposition Notification (MDN) confirming that',
      'the message was displayed by the recipient\'s mail client.',
    ].join('\r\n');

    // Machine-readable part (RFC 3798 Section 3.2.6)
    const disposition = [
      `Reporting-UA: ${reportingUA}`,
      `Original-Recipient: rfc822;${params.originalRecipient}`,
      `Final-Recipient: rfc822;${params.originalRecipient}`,
      `Original-Message-ID: ${params.originalMessageId}`,
      'Disposition: manual-action/MDN-sent-manually; displayed',
    ].join('\r\n');

    // Build the raw MIME message
    const rawMessage = [
      `From: ${params.from.name || ''} <${params.from.address}>`.trim(),
      `To: ${params.to}`,
      `Subject: Read: ${params.originalSubject}`,
      `Date: ${now}`,
      `Message-ID: ${mdnMessageId}`,
      `In-Reply-To: ${params.originalMessageId}`,
      `References: ${params.originalMessageId}`,
      'MIME-Version: 1.0',
      'Auto-Submitted: auto-replied',
      `Content-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      humanText,
      '',
      `--${boundary}`,
      'Content-Type: message/disposition-notification',
      'Content-Transfer-Encoding: 7bit',
      '',
      disposition,
      '',
      `--${boundary}--`,
    ].join('\r\n');

    await this.transporter.sendMail({
      envelope: {
        from: params.from.address,
        to: params.to,
      },
      raw: rawMessage,
    });

    logger.info('MDN sent', {
      messageId: mdnMessageId,
      to: params.to,
      originalMessageId: params.originalMessageId,
    });
  }

  private async resolveAttachments(
    attachments: IAttachment[]
  ): Promise<Array<{ filename: string; content: Buffer; contentType: string; cid?: string }>> {
    const results = await Promise.all(
      attachments.map(async (att) => {
        try {
          const response = await emailS3.send(
            new GetObjectCommand({ Bucket: EMAIL_S3_CONFIG.bucket, Key: att.s3Key })
          );
          const body = await response.Body?.transformToByteArray();
          if (body) {
            return {
              filename: att.filename,
              content: Buffer.from(body),
              contentType: att.contentType,
              ...(att.contentId ? { cid: att.contentId } : {}),
            };
          }
        } catch (error) {
          logger.error('Failed to fetch attachment from S3', error instanceof Error ? error : new Error(String(error)), {
            s3Key: att.s3Key,
          });
        }
        return null;
      })
    );
    return results.filter(Boolean) as any;
  }

  // --- Retry queue (Redis-backed with local fallback) ---

  private async enqueue(message: OutboundMessage & { messageId: string }): Promise<void> {
    const id = uuidv4();
    const queued: QueuedMessage = {
      ...message,
      id,
      attempts: 0,
      nextRetry: Date.now() + SMTP_OUTBOUND_CONFIG.retryDelays[0],
    };

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      try {
        await redis.hset(REDIS_QUEUE_KEY, id, JSON.stringify(queued));
        await redis.zadd(REDIS_SCHEDULE_KEY, queued.nextRetry, id);
      } catch {
        this.localQueue.set(id, queued);
      }
    } else {
      this.localQueue.set(id, queued);
    }

    this.ensureRetryTimer();
  }

  private ensureRetryTimer(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => this.processQueue(), 30_000);
  }

  private async processQueue(): Promise<void> {
    const now = Date.now();

    // Process Redis queue
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      try {
        const dueIds = await redis.zrangebyscore(REDIS_SCHEDULE_KEY, 0, now);
        for (const id of dueIds) {
          const data = await redis.hget(REDIS_QUEUE_KEY, id);
          if (!data) {
            await redis.zrem(REDIS_SCHEDULE_KEY, id);
            continue;
          }
          const msg: QueuedMessage = JSON.parse(data);
          await this.retryMessage(id, msg, redis);
        }
      } catch (error) {
        logger.error('Error processing Redis SMTP queue', error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Process local fallback queue
    for (const [id, msg] of this.localQueue) {
      if (msg.nextRetry > now) continue;
      await this.retryMessage(id, msg, null);
    }

    // Stop timer if both queues are empty
    const redisEmpty = !redis || redis.status !== 'ready'
      ? true
      : (await redis.zcard(REDIS_SCHEDULE_KEY).catch(() => 0)) === 0;

    if (this.localQueue.size === 0 && redisEmpty && this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async retryMessage(id: string, msg: QueuedMessage, redis: ReturnType<typeof getRedisClient>): Promise<void> {
    msg.attempts++;

    try {
      const nmAttachments = await this.resolveAttachments(msg.attachments || []);
      await this.transporter.sendMail({
        messageId: msg.messageId,
        from: `${msg.from.name || ''} <${msg.from.address}>`.trim(),
        to: msg.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
        cc: msg.cc?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
        bcc: msg.bcc?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        inReplyTo: msg.inReplyTo,
        references: msg.references?.join(' '),
        attachments: nmAttachments,
      });

      const size = Buffer.byteLength((msg.text || '') + (msg.html || ''), 'utf8');
      await emailService.storeSentMessage(msg.userId, {
        messageId: msg.messageId,
        from: msg.from,
        to: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        inReplyTo: msg.inReplyTo,
        references: msg.references,
        attachments: msg.attachments,
        size,
      });

      // Remove from queue
      if (redis && redis.status === 'ready') {
        await redis.hdel(REDIS_QUEUE_KEY, id);
        await redis.zrem(REDIS_SCHEDULE_KEY, id);
      } else {
        this.localQueue.delete(id);
      }

      logger.info('Queued email sent on retry', { messageId: msg.messageId, attempts: msg.attempts });
    } catch (error) {
      if (msg.attempts >= SMTP_OUTBOUND_CONFIG.maxRetries) {
        if (redis && redis.status === 'ready') {
          await redis.hdel(REDIS_QUEUE_KEY, id);
          await redis.zrem(REDIS_SCHEDULE_KEY, id);
        } else {
          this.localQueue.delete(id);
        }
        logger.error('Email permanently failed after max retries', error instanceof Error ? error : new Error(String(error)), {
          messageId: msg.messageId,
        });
      } else {
        const delayIndex = Math.min(msg.attempts, SMTP_OUTBOUND_CONFIG.retryDelays.length - 1);
        msg.nextRetry = Date.now() + SMTP_OUTBOUND_CONFIG.retryDelays[delayIndex];

        if (redis && redis.status === 'ready') {
          await redis.hset(REDIS_QUEUE_KEY, id, JSON.stringify(msg));
          await redis.zadd(REDIS_SCHEDULE_KEY, msg.nextRetry, id);
        }

        logger.warn('Email retry scheduled', {
          messageId: msg.messageId,
          attempt: msg.attempts,
          nextRetry: new Date(msg.nextRetry).toISOString(),
        });
      }
    }
  }

  shutdown(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    this.transporter.close();
  }
}

export const smtpOutbound = new SmtpOutboundService();
export default smtpOutbound;
