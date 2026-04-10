/**
 * Email Inbound Webhook Route
 *
 * Receives inbound email from Cloudflare Email Routing via a worker webhook.
 * Replaces the direct SMTP inbound server (port 25) which is blocked by
 * DigitalOcean.
 *
 * Flow:
 *   1. Cloudflare Email Routing receives email for *@oxy.so
 *   2. Cloudflare Email Worker forwards raw MIME to this webhook
 *   3. This route parses, spam-checks, and stores the message
 *
 * Security: Authenticated via a shared secret in the Authorization header.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { emailService } from '../services/email.service';
import { spamService } from '../services/spam.service';
import { EMAIL_DOMAIN, extractUsername, extractAliasTag } from '../config/email.config';
import { getEnvVar } from '../config/env';
import User from '../models/User';
import { logger } from '../utils/logger';

const router = Router();

const INBOUND_WEBHOOK_SECRET = getEnvVar('EMAIL_INBOUND_WEBHOOK_SECRET', '');

// Rate limit: 60 emails per minute (generous for inbound webhook)
const inboundRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: () => 'email-inbound-global',
  message: 'Too many inbound emails, please try again later.',
});

/**
 * Verify the webhook secret from the Authorization header.
 */
function verifyWebhookSecret(req: Request, res: Response): boolean {
  if (!INBOUND_WEBHOOK_SECRET) {
    logger.error('EMAIL_INBOUND_WEBHOOK_SECRET is not configured');
    res.status(500).json({ error: 'Webhook not configured' });
    return false;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${INBOUND_WEBHOOK_SECRET}`) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return false;
  }

  return true;
}

/**
 * POST /email/inbound
 *
 * Accepts raw RFC 5322 MIME email as the request body.
 * Content-Type should be message/rfc822 or application/octet-stream.
 *
 * Headers:
 *   Authorization: Bearer <EMAIL_INBOUND_WEBHOOK_SECRET>
 *   X-Envelope-From: sender@example.com (optional, from SMTP MAIL FROM)
 *   X-Envelope-To: recipient@oxy.so (comma-separated if multiple)
 */
router.post(
  '/',
  inboundRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    if (!verifyWebhookSecret(req, res)) return;

    const rawMessage = req.body as Buffer;
    if (!rawMessage || rawMessage.length === 0) {
      return res.status(400).json({ error: 'Empty message body' });
    }

    // Extract envelope recipients from header (set by Cloudflare Worker)
    const envelopeTo = (req.headers['x-envelope-to'] as string || '')
      .split(',')
      .map((addr) => addr.trim().toLowerCase())
      .filter(Boolean);

    if (envelopeTo.length === 0) {
      return res.status(400).json({ error: 'Missing X-Envelope-To header' });
    }

    // Validate at least one recipient exists
    const validRecipients: Array<{ address: string; username: string; aliasTag?: string }> = [];
    for (const addr of envelopeTo) {
      const username = extractUsername(addr);
      if (!username) continue;

      const user = await User.findOne({ username }).select('_id').lean();
      if (!user) {
        logger.info('Inbound webhook: recipient not found', { address: addr });
        continue;
      }

      validRecipients.push({
        address: addr,
        username,
        aliasTag: extractAliasTag(addr) ?? undefined,
      });
    }

    if (validRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipients found' });
    }

    // Spam check (if Rspamd is available)
    const spamResult = await spamService.check(rawMessage);
    if (spamService.shouldReject(spamResult.score)) {
      logger.info('Inbound webhook: rejected spam', {
        score: spamResult.score,
        from: req.headers['x-envelope-from'],
      });
      return res.status(400).json({ error: 'Message rejected as spam' });
    }

    // Parse MIME
    const parsed: ParsedMail = await simpleParser(rawMessage);

    const fromAddr = parsed.from?.value?.[0];
    const toAddrs = (parsed.to && !Array.isArray(parsed.to) ? [parsed.to] : parsed.to || [])
      .flatMap((addr) => addr.value);
    const ccAddrs = (parsed.cc && !Array.isArray(parsed.cc) ? [parsed.cc] : parsed.cc || [])
      .flatMap((addr) => addr.value);

    // Convert attachments
    const attachments = (parsed.attachments || []).map((att) => ({
      filename: att.filename || 'attachment',
      contentType: att.contentType || 'application/octet-stream',
      content: att.content,
      contentId: att.contentId,
      isInline: att.contentDisposition === 'inline',
    }));

    // Extract headers
    const headersObj: Record<string, string> = {};
    if (parsed.headers) {
      parsed.headers.forEach((value, key) => {
        headersObj[key] = typeof value === 'string' ? value : JSON.stringify(value);
      });
    }

    const envelopeFrom = (req.headers['x-envelope-from'] as string || '').toLowerCase();
    const senderAddress = fromAddr?.address || envelopeFrom;

    // Deliver to each valid recipient
    const results: Array<{ recipient: string; status: string }> = [];
    for (const rcpt of validRecipients) {
      try {
        await emailService.storeIncomingMessage({
          recipientUsername: rcpt.username,
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
          aliasTag: rcpt.aliasTag,
          rawSize: rawMessage.length,
        });

        results.push({ recipient: rcpt.address, status: 'delivered' });
        logger.info('Inbound webhook: message delivered', {
          from: senderAddress,
          to: rcpt.address,
          subject: parsed.subject,
        });
      } catch (err) {
        logger.error('Inbound webhook: delivery failed', err instanceof Error ? err : new Error(String(err)), {
          recipient: rcpt.address,
        });
        results.push({ recipient: rcpt.address, status: 'failed' });
      }
    }

    res.status(200).json({
      accepted: results.filter((r) => r.status === 'delivered').length,
      rejected: results.filter((r) => r.status === 'failed').length,
      results,
    });
  })
);

export default router;
