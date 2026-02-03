/**
 * SMTP Outbound Service
 *
 * Sends email using nodemailer with DKIM signing.
 * Supports both direct delivery and relay through an external SMTP server.
 * Includes a simple in-memory retry queue with exponential backoff.
 */

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

// Dedicated S3 client for fetching email attachments when sending
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
}

interface QueuedMessage extends OutboundMessage {
  id: string;
  attempts: number;
  nextRetry: number;
  messageId: string;
}

class SmtpOutboundService {
  private transporter: Transporter;
  private queue: Map<string, QueuedMessage> = new Map();
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
      : {
          // Direct delivery (MX resolution)
          direct: true,
        };

    // DKIM signing
    if (DKIM_CONFIG.privateKey) {
      (transportConfig as any).dkim = {
        domainName: DKIM_CONFIG.domainName,
        keySelector: DKIM_CONFIG.keySelector,
        privateKey: DKIM_CONFIG.privateKey,
      };
    }

    return nodemailer.createTransport(transportConfig as any);
  }

  /**
   * Send an email immediately. On failure, queue for retry.
   */
  async send(message: OutboundMessage): Promise<{ messageId: string; queued: boolean }> {
    const messageId = `<${uuidv4()}@${EMAIL_DOMAIN}>`;

    // Prepare nodemailer attachments from S3 keys
    const nmAttachments = await this.resolveAttachments(message.attachments || []);

    const mailOptions = {
      messageId,
      from: `${message.from.name || ''} <${message.from.address}>`.trim(),
      to: message.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
      cc: message.cc
        ?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
        .join(', '),
      bcc: message.bcc
        ?.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
        .join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
      inReplyTo: message.inReplyTo,
      references: message.references?.join(' '),
      attachments: nmAttachments,
    };

    try {
      await this.transporter.sendMail(mailOptions);

      // Store in Sent folder
      const size = Buffer.byteLength(
        (message.text || '') + (message.html || ''),
        'utf8'
      );
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
      this.enqueue({ ...message, messageId });
      return { messageId, queued: true };
    }
  }

  /**
   * Resolve S3 attachment keys into buffers for nodemailer.
   */
  private async resolveAttachments(
    attachments: IAttachment[]
  ): Promise<Array<{ filename: string; content: Buffer; contentType: string; cid?: string }>> {
    const results = [];
    for (const att of attachments) {
      try {
        const response = await emailS3.send(
          new GetObjectCommand({
            Bucket: EMAIL_S3_CONFIG.bucket,
            Key: att.s3Key,
          })
        );
        const body = await response.Body?.transformToByteArray();
        if (body) {
          results.push({
            filename: att.filename,
            content: Buffer.from(body),
            contentType: att.contentType,
            ...(att.contentId ? { cid: att.contentId } : {}),
          });
        }
      } catch (error) {
        logger.error('Failed to fetch attachment from S3', error instanceof Error ? error : new Error(String(error)), {
          s3Key: att.s3Key,
        });
      }
    }
    return results;
  }

  // ─── Retry queue ──────────────────────────────────────────────────

  private enqueue(message: OutboundMessage & { messageId: string }): void {
    const id = uuidv4();
    const queued: QueuedMessage = {
      ...message,
      id,
      attempts: 0,
      nextRetry: Date.now() + SMTP_OUTBOUND_CONFIG.retryDelays[0],
    };
    this.queue.set(id, queued);
    this.ensureRetryTimer();
  }

  private ensureRetryTimer(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => this.processQueue(), 30_000);
  }

  private async processQueue(): Promise<void> {
    const now = Date.now();
    for (const [id, msg] of this.queue) {
      if (msg.nextRetry > now) continue;

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

        // Store in Sent
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

        this.queue.delete(id);
        logger.info('Queued email sent on retry', { messageId: msg.messageId, attempts: msg.attempts });
      } catch (error) {
        if (msg.attempts >= SMTP_OUTBOUND_CONFIG.maxRetries) {
          this.queue.delete(id);
          logger.error('Email permanently failed after max retries', error instanceof Error ? error : new Error(String(error)), {
            messageId: msg.messageId,
          });
          // TODO: generate a bounce notification message to the sender
        } else {
          const delayIndex = Math.min(msg.attempts, SMTP_OUTBOUND_CONFIG.retryDelays.length - 1);
          msg.nextRetry = now + SMTP_OUTBOUND_CONFIG.retryDelays[delayIndex];
          logger.warn('Email retry scheduled', {
            messageId: msg.messageId,
            attempt: msg.attempts,
            nextRetry: new Date(msg.nextRetry).toISOString(),
          });
        }
      }
    }

    // Stop timer if queue is empty
    if (this.queue.size === 0 && this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Shut down: clear the retry timer.
   */
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
