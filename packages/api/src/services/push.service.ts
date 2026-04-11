/**
 * Push Notification Service
 *
 * Sends push notifications via the Expo Push API.
 * Uses a simple HTTP POST — no SDK dependency required on the backend.
 */

import { PushToken } from '../models/PushToken';
import { logger } from '../utils/logger';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Send a push notification to all registered devices for a user.
 * Fire-and-forget — callers should not await this in critical paths.
 */
async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const tokens = await PushToken.find({ userId }).select('token').lean();

    if (tokens.length === 0) {
      return;
    }

    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data,
      sound: 'default' as const,
      channelId: 'email',
    }));

    // Expo recommends batching up to 100 notifications per request
    const chunks = chunkArray(messages, 100);

    for (const chunk of chunks) {
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });

        if (!response.ok) {
          logger.warn('Expo push API returned non-OK status', {
            status: response.status,
            userId,
          });
          continue;
        }

        const result = await response.json() as { data: ExpoPushTicket[] };

        // Clean up invalid tokens (DeviceNotRegistered)
        if (result.data) {
          for (let i = 0; i < result.data.length; i++) {
            const ticket = result.data[i];
            if (
              ticket.status === 'error' &&
              ticket.details &&
              (ticket.details as Record<string, unknown>).error === 'DeviceNotRegistered'
            ) {
              const invalidToken = chunk[i].to;
              logger.info('Removing invalid push token', { userId, token: invalidToken });
              await PushToken.deleteOne({ userId, token: invalidToken });
            }
          }
        }
      } catch (err) {
        logger.warn('Failed to send push notification chunk', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.warn('Failed to send push notification', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Split an array into chunks of the given size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export const pushService = {
  sendPushNotification,
};

export default pushService;
