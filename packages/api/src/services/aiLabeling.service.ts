/**
 * AI Email Labeling Service
 *
 * Classifies incoming emails using the Alia AI API and applies matching labels.
 * Runs as fire-and-forget after message storage — never blocks email delivery.
 */

import axios from 'axios';
import { Label } from '../models/Label';
import { Message } from '../models/Message';
import { AI_LABELING_CONFIG } from '../config/email.config';
import { logger } from '../utils/logger';

const ALIA_BASE_URL = 'https://api.alia.onl/v1';
const ALIA_API_KEY = process.env.ALIA_API_KEY;

class AiLabelingService {
  /**
   * Classify a message and apply labels.
   * Fire-and-forget — failures are logged, never thrown.
   */
  async classifyAndLabel(userId: string, messageId: string): Promise<void> {
    try {
      if (!AI_LABELING_CONFIG.enabled || !ALIA_API_KEY) {
        return;
      }

      // Fetch user's labels
      const labels = await Label.find({ userId }).select('name').lean();
      if (labels.length === 0) return;

      const labelNames = labels.map((l) => l.name);

      // Fetch message content for classification
      const message = await Message.findOne({ _id: messageId, userId })
        .select('subject from to text')
        .lean();
      if (!message) return;

      const textPreview = (message.text || '').slice(0, AI_LABELING_CONFIG.maxBodyChars);
      const fromStr = `${message.from.name || ''} <${message.from.address}>`.trim();

      const { system, user } = this.buildPrompt(labelNames, {
        from: fromStr,
        subject: message.subject,
        body: textPreview,
      });

      const response = await axios.post(
        `${ALIA_BASE_URL}/chat/completions`,
        {
          model: AI_LABELING_CONFIG.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 100,
          temperature: 0.1,
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ALIA_API_KEY}`,
          },
          timeout: AI_LABELING_CONFIG.timeout,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content || '';
      const assignedLabels = this.parseLabels(content, labelNames);

      if (assignedLabels.length > 0) {
        await Message.updateOne(
          { _id: messageId, userId },
          { $addToSet: { labels: { $each: assignedLabels } } },
        );
        logger.info('AI labels applied', { messageId, labels: assignedLabels });
      }
    } catch (error) {
      // Never throw — this is fire-and-forget
      logger.warn('AI labeling failed', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildPrompt(
    labelNames: string[],
    email: { from: string; subject: string; body: string },
  ) {
    return {
      system:
        'You are an email classifier. Given an email and a list of available labels, determine which labels apply. ' +
        'Respond with ONLY a JSON array of matching label names. Use only labels from the provided list. ' +
        'Apply 1-2 labels that best fit. If no labels clearly match, respond with an empty array []. ' +
        'Never invent labels outside the list.',
      user:
        `Available labels: ${JSON.stringify(labelNames)}\n\n` +
        `Email:\nFrom: ${email.from}\nSubject: ${email.subject}\nBody: ${email.body}\n\n` +
        'Which labels apply? Respond with a JSON array only.',
    };
  }

  private parseLabels(aiResponse: string, validLabels: string[]): string[] {
    try {
      // Extract JSON array from response (handle markdown code blocks)
      const jsonMatch = aiResponse.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      // Validate against actual labels (case-insensitive match)
      const validSet = new Map(validLabels.map((l) => [l.toLowerCase(), l]));
      return parsed
        .filter((item: unknown): item is string => typeof item === 'string')
        .map((item: string) => validSet.get(item.toLowerCase()))
        .filter((name): name is string => !!name);
    } catch {
      return [];
    }
  }
}

export const aiLabelingService = new AiLabelingService();
