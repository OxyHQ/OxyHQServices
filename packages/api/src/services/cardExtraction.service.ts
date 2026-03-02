/**
 * Card Extraction Service
 *
 * Extracts structured data cards (trips, purchases, events, bills, packages)
 * and key highlights from incoming emails using the Alia AI API.
 * Runs as fire-and-forget after message storage — never blocks email delivery.
 */

import axios from 'axios';
import { Message, CardType } from '../models/Message';
import { AI_LABELING_CONFIG } from '../config/email.config';
import { logger } from '../utils/logger';

const ALIA_BASE_URL = 'https://api.alia.onl/v1';
const ALIA_API_KEY = process.env.ALIA_API_KEY;

interface ExtractedCard {
  type: CardType;
  data: Record<string, any>;
  confidence: number;
}

interface ExtractedHighlight {
  type: string;
  value: string;
  label: string;
}

interface ExtractionResult {
  card: ExtractedCard | null;
  highlights: ExtractedHighlight[];
}

class CardExtractionService {
  /**
   * Extract structured card data and highlights from a message.
   * Fire-and-forget — failures are logged, never thrown.
   */
  async extractAndUpdate(userId: string, messageId: string): Promise<void> {
    try {
      if (!ALIA_API_KEY) return;

      const message = await Message.findOne({ _id: messageId, userId })
        .select('+text +html subject from to date attachments')
        .lean();
      if (!message) return;

      const textContent = (message.text || '').slice(0, 3000);
      if (!textContent && !message.subject) return;

      const fromStr = `${message.from.name || ''} <${message.from.address}>`.trim();

      const { system, user } = this.buildPrompt({
        from: fromStr,
        subject: message.subject,
        body: textContent,
        date: message.date instanceof Date ? message.date.toISOString() : String(message.date),
        hasAttachments: (message.attachments?.length ?? 0) > 0,
      });

      const response = await axios.post(
        `${ALIA_BASE_URL}/chat/completions`,
        {
          model: AI_LABELING_CONFIG.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 800,
          temperature: 0.1,
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ALIA_API_KEY}`,
          },
          timeout: 15000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content || '';
      const result = this.parseResult(content);

      if (!result.card && result.highlights.length === 0) return;

      const update: Record<string, any> = {};
      if (result.card) {
        update.card = {
          type: result.card.type,
          data: result.card.data,
          confidence: result.card.confidence,
          extractedAt: new Date(),
        };
      }
      if (result.highlights.length > 0) {
        update.highlights = result.highlights;
      }

      await Message.updateOne({ _id: messageId, userId }, { $set: update });
      logger.info('Card extraction complete', {
        messageId,
        cardType: result.card?.type ?? 'none',
        highlightCount: result.highlights.length,
      });
    } catch (error) {
      logger.warn('Card extraction failed', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildPrompt(email: {
    from: string;
    subject: string;
    body: string;
    date: string;
    hasAttachments: boolean;
  }) {
    return {
      system:
        'You are a structured data extractor for emails. Analyze the email and extract:\n' +
        '1. A "card" if the email contains actionable structured data. Card types:\n' +
        '   - "trip": flights, hotels, car rentals (fields: airline, flightNumber, departure, arrival, departureTime, arrivalTime, confirmationCode, hotel, checkIn, checkOut)\n' +
        '   - "purchase": order confirmations, receipts (fields: merchant, amount, currency, orderNumber, items, trackingUrl)\n' +
        '   - "event": calendar events, invitations (fields: title, startTime, endTime, location, organizer, rsvpUrl)\n' +
        '   - "bill": bills, invoices, payment due (fields: biller, amount, currency, dueDate, accountNumber, payUrl)\n' +
        '   - "package": shipping/delivery notifications (fields: carrier, trackingNumber, trackingUrl, estimatedDelivery, status, merchant)\n' +
        '2. "highlights": key data points (dates, prices, tracking numbers, confirmation codes, addresses)\n\n' +
        'Respond with ONLY valid JSON in this format:\n' +
        '{\n' +
        '  "card": { "type": "...", "data": { ... }, "confidence": 0.0-1.0 } | null,\n' +
        '  "highlights": [{ "type": "date|price|tracking|confirmation|address|phone|link", "value": "...", "label": "..." }]\n' +
        '}\n\n' +
        'Rules:\n' +
        '- Only create a card if confidence >= 0.7\n' +
        '- Include only fields that are actually present in the email\n' +
        '- For highlights, use short human-readable labels (e.g., "Due date", "Order total", "Tracking #")\n' +
        '- If the email is not transactional (e.g., newsletter, social, personal), return {"card": null, "highlights": []}\n' +
        '- Dates should be in ISO 8601 format when possible',
      user:
        `From: ${email.from}\n` +
        `Subject: ${email.subject}\n` +
        `Date: ${email.date}\n` +
        `Has attachments: ${email.hasAttachments}\n\n` +
        `Body:\n${email.body}`,
    };
  }

  private parseResult(aiResponse: string): ExtractionResult {
    const empty: ExtractionResult = { card: null, highlights: [] };
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return empty;

      const parsed = JSON.parse(jsonMatch[0]);

      let card: ExtractedCard | null = null;
      if (parsed.card && typeof parsed.card === 'object') {
        const validTypes: CardType[] = ['trip', 'purchase', 'event', 'bill', 'package'];
        if (
          validTypes.includes(parsed.card.type) &&
          typeof parsed.card.data === 'object' &&
          typeof parsed.card.confidence === 'number' &&
          parsed.card.confidence >= 0.7
        ) {
          card = {
            type: parsed.card.type,
            data: parsed.card.data,
            confidence: parsed.card.confidence,
          };
        }
      }

      const highlights: ExtractedHighlight[] = [];
      if (Array.isArray(parsed.highlights)) {
        for (const h of parsed.highlights) {
          if (
            h &&
            typeof h.type === 'string' &&
            typeof h.value === 'string' &&
            typeof h.label === 'string'
          ) {
            highlights.push({
              type: h.type,
              value: h.value,
              label: h.label,
            });
          }
        }
      }

      return { card, highlights };
    } catch {
      return empty;
    }
  }
}

export const cardExtractionService = new CardExtractionService();
