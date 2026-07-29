import { useEffect } from 'react';
import {
  installForegroundNotificationHandler,
  type ForegroundPresentation,
} from '@oxyhq/services/notifications';

import { emailMessageIdFromPush } from '@/lib/notifications/email-push';

/**
 * Show new-mail notifications while Inbox is open.
 *
 * `expo-notifications` suppresses foreground banners by default. Without this
 * handler, the one moment the user is actively reading mail is the one moment a
 * new message produces no visible signal.
 */
export function useForegroundNotificationHandler(): void {
  useEffect(() => {
    void installForegroundNotificationHandler((data): ForegroundPresentation =>
      emailMessageIdFromPush(data) === null ? 'suppress' : 'show',
    );
  }, []);
}
