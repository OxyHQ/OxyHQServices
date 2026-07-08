/**
 * Push-notification token registration.
 *
 * Wires the `pushNotifications` inbox preference to the backend push-token
 * endpoints (`registerPushToken` / `unregisterPushToken` on the email API).
 *
 * Native only: Expo device push tokens (APNs / FCM) require a real device.
 * Web push needs a VAPID + service-worker flow that isn't wired yet, so this
 * hook is a documented no-op on web (see `NotificationsSection`). The single
 * effect below opens the "connection" (permission + token → register) and
 * tears it down (unregister) when the pref is turned off or the user signs
 * out — mirroring the socket lifecycle pattern.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useOxy } from '@oxyhq/services';

import { useInboxPrefs } from '@/contexts/inbox-prefs-context';
import { useEmailStore } from '@/hooks/useEmail';

type NativePlatform = 'ios' | 'android';

export function usePushRegistration() {
  const { prefs } = useInboxPrefs();
  const { user } = useOxy();
  const api = useEmailStore((s) => s._api);

  const enabled = prefs.pushNotifications;
  const userId = user?.id ?? null;

  // The token currently registered with the backend, so cleanup can
  // unregister exactly what was registered even after the pref flips.
  const registeredTokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Web + signed-out + no API + pref off → nothing to register.
    if (Platform.OS === 'web' || !enabled || !userId || !api) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const Notifications = await import('expo-notifications');

        const settings = await Notifications.getPermissionsAsync();
        let granted = settings.granted;
        if (!granted && settings.canAskAgain) {
          const request = await Notifications.requestPermissionsAsync();
          granted = request.granted;
        }
        if (!granted || cancelled) return;

        const tokenResult = await Notifications.getDevicePushTokenAsync();
        const token = typeof tokenResult.data === 'string' ? tokenResult.data : String(tokenResult.data);
        if (cancelled || !token) return;

        await api.registerPushToken(token, Platform.OS as NativePlatform);
        registeredTokenRef.current = token;
      } catch {
        // Permission denial, simulator with no push support, or a transient
        // network error — non-fatal. The pref stays on; registration retries
        // on the next mount / pref toggle.
      }
    })();

    return () => {
      cancelled = true;
      const token = registeredTokenRef.current;
      if (token && api) {
        registeredTokenRef.current = null;
        api.unregisterPushToken(token).catch(() => {
          // Best-effort unregister; a stale token is pruned server-side when
          // a push delivery fails.
        });
      }
    };
  }, [enabled, userId, api]);
}
