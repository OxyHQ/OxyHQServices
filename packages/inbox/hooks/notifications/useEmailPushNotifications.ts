import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { logger } from '@oxyhq/core';
import { subscribeToNotificationResponses, takeLaunchNotificationData } from '@oxyhq/services';

import { useMessageActions } from '@/hooks/useMessageActions';
import {
  claimEmailMessageId,
  emailMessageIdFromPush,
} from '@/lib/notifications/email-push';

const LOG_CONTEXT = { component: 'useEmailPushNotifications' } as const;

export async function coldLaunchEmailMessageId(): Promise<string | null> {
  const data = await takeLaunchNotificationData();
  const messageId = emailMessageIdFromPush(data);
  if (!messageId) {
    return null;
  }
  return claimEmailMessageId(messageId) ? messageId : null;
}

/**
 * Route a tapped new-mail push to the conversation screen.
 *
 * @param enabled - Gate on the SDK private-API readiness signal so navigation
 *   does not fire before the signed-in navigator is mounted.
 */
export function useEmailPushNotifications(enabled: boolean): void {
  const router = useRouter();
  const { prepareOpenMessage } = useMessageActions();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void coldLaunchEmailMessageId().then((messageId) => {
      if (!messageId || cancelled) return;
      prepareOpenMessage(messageId);
      router.push(`/conversation/${messageId}`);
    });

    void subscribeToNotificationResponses((data) => {
      const messageId = emailMessageIdFromPush(data);
      if (!messageId || !claimEmailMessageId(messageId)) return;
      prepareOpenMessage(messageId);
      router.push(`/conversation/${messageId}`);
    })
      .then((off) => {
        if (cancelled) {
          off();
          return;
        }
        unsubscribe = off;
      })
      .catch((error: unknown) => {
        logger.warn('[inbox] could not listen for email pushes', LOG_CONTEXT, error);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled, router, prepareOpenMessage]);
}
