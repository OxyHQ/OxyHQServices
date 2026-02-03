/**
 * SMTP Inbound Server
 *
 * Receives incoming email from the internet using the `smtp-server` library.
 * Validates recipients against Oxy users, runs spam checks via Rspamd,
 * parses MIME with `mailparser`, and stores messages through the email service.
 */

import { SMTPServer, SMTPServerSession, SMTPServerAddress, SMTPServerDataStream } from 'smtp-server';
import { simpleParser, ParsedMail } from 'mailparser';
import { SMTP_INBOUND_CONFIG, EMAIL_DOMAIN, extractUsername, extractAliasTag } from '../config/email.config';
import { emailService } from './email.service';
import { spamService } from './spam.service';
import User from '../models/User';
import { logger } from '../utils/logger';
import fs from 'fs';

let smtpServer: SMTPServer | null = null;

/**
 * Create and start the SMTP inbound server.
 */
export function startSmtpInbound(): SMTPServer {
  const tlsOptions =
    SMTP_INBOUND_CONFIG.tls.key && SMTP_INBOUND_CONFIG.tls.cert
      ? {
          key: fs.readFileSync(SMTP_INBOUND_CONFIG.tls.key),
          cert: fs.readFileSync(SMTP_INBOUND_CONFIG.tls.cert),
        }
      : undefined;

  smtpServer = new SMTPServer({
    name: EMAIL_DOMAIN,
    banner: SMTP_INBOUND_CONFIG.banner,
    size: SMTP_INBOUND_CONFIG.maxMessageSize,
    disabledCommands: ['AUTH'], // We don't require auth for inbound mail
    authOptional: true,
    ...(tlsOptions ? { secure: false, key: tlsOptions.key, cert: tlsOptions.cert } : {}),

    /**
     * Validate RCPT TO addresses — reject if the user doesn't exist.
     */
    async onRcptTo(
      address: SMTPServerAddress,
      _session: SMTPServerSession,
      callback: (err?: Error | null) => void
    ) {
      try {
        const emailAddr = address.address.toLowerCase();
        const username = extractUsername(emailAddr);

        if (!username) {
          return callback(new Error(`550 Recipient rejected: not our domain`));
        }

        const user = await User.findOne({ username }).select('_id').lean();
        if (!user) {
          return callback(new Error(`550 Recipient not found: ${emailAddr}`));
        }

        callback();
      } catch (error) {
        logger.error('SMTP RCPT TO error', error instanceof Error ? error : new Error(String(error)));
        callback(new Error('451 Temporary error, try again later'));
      }
    },

    /**
     * Process the incoming message data.
     */
    async onData(
      stream: SMTPServerDataStream,
      session: SMTPServerSession,
      callback: (err?: Error | null) => void
    ) {
      try {
        // Collect the raw message into a buffer
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const rawMessage = Buffer.concat(chunks);

        // Spam check
        const spamResult = await spamService.check(rawMessage);
        if (spamService.shouldReject(spamResult.score)) {
          logger.info('Rejected spam message', {
            score: spamResult.score,
            from: session.envelope.mailFrom,
          });
          return callback(new Error('550 Message rejected as spam'));
        }

        // Parse MIME
        const parsed: ParsedMail = await simpleParser(rawMessage);

        // Deliver to each recipient
        const recipients = session.envelope.rcptTo || [];
        for (const rcpt of recipients) {
          const recipientAddr = rcpt.address.toLowerCase();
          const username = extractUsername(recipientAddr);
          if (!username) continue;

          const aliasTag = extractAliasTag(recipientAddr);

          const fromAddr = parsed.from?.value?.[0];
          const toAddrs = (parsed.to && !Array.isArray(parsed.to) ? [parsed.to] : parsed.to || [])
            .flatMap((addr) => addr.value);
          const ccAddrs = (parsed.cc && !Array.isArray(parsed.cc) ? [parsed.cc] : parsed.cc || [])
            .flatMap((addr) => addr.value);

          // Convert mailparser attachments
          const attachments = (parsed.attachments || []).map((att) => ({
            filename: att.filename || 'attachment',
            contentType: att.contentType || 'application/octet-stream',
            content: att.content,
            contentId: att.contentId,
            isInline: att.contentDisposition === 'inline',
          }));

          const headersObj: Record<string, string> = {};
          if (parsed.headers) {
            parsed.headers.forEach((value, key) => {
              headersObj[key] = typeof value === 'string' ? value : JSON.stringify(value);
            });
          }

          const mailFrom = session.envelope.mailFrom as { address: string } | false;
          const senderAddress = fromAddr?.address || (mailFrom ? mailFrom.address : '');
          await emailService.storeIncomingMessage({
            recipientUsername: username,
            from: {
              name: fromAddr?.name || '',
              address: senderAddress,
            },
            to: toAddrs.map((a) => ({ name: a.name || '', address: a.address || '' })),
            cc: ccAddrs.map((a) => ({ name: a.name || '', address: a.address || '' })),
            subject: parsed.subject || '',
            text: parsed.text,
            html: typeof parsed.html === 'string' ? parsed.html : undefined,
            messageId: parsed.messageId || `<${Date.now()}@${EMAIL_DOMAIN}>`,
            inReplyTo: parsed.inReplyTo || undefined,
            references: Array.isArray(parsed.references)
              ? parsed.references
              : parsed.references
                ? [parsed.references]
                : [],
            date: parsed.date || new Date(),
            headers: headersObj,
            attachments,
            spamScore: spamResult.score,
            spamAction: spamResult.action,
            aliasTag: aliasTag ?? undefined,
            rawSize: rawMessage.length,
          });
        }

        callback();
      } catch (error) {
        logger.error('SMTP data processing error', error instanceof Error ? error : new Error(String(error)));
        callback(new Error('451 Message processing failed'));
      }
    },

  });

  smtpServer.on('error', (err: Error) => {
    logger.error('SMTP server error', err);
  });

  smtpServer.listen(SMTP_INBOUND_CONFIG.port, SMTP_INBOUND_CONFIG.host, () => {
    logger.info('SMTP inbound server started', {
      port: SMTP_INBOUND_CONFIG.port,
      host: SMTP_INBOUND_CONFIG.host,
    });
  });

  return smtpServer;
}

/**
 * Gracefully shut down the SMTP server.
 */
export function stopSmtpInbound(): Promise<void> {
  return new Promise((resolve) => {
    if (smtpServer) {
      smtpServer.close(() => {
        logger.info('SMTP inbound server stopped');
        smtpServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
