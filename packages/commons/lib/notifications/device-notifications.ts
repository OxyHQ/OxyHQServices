/**
 * The ONLY place Commons touches `expo-notifications`.
 *
 * Everything here is native-only and loaded through a dynamic `import()`, so a
 * web bundle (Commons ships none, but the guard keeps the module honest) and a
 * build without the native module degrade to "notifications unavailable" rather
 * than throwing at module-evaluation time.
 *
 * ## The token is an EXPO push token — never a raw device token
 *
 * {@link getExpoPushToken} calls `getExpoPushTokenAsync()`, which returns the
 * `ExponentPushToken[…]` handle Expo's push service delivers through.
 * `getDevicePushTokenAsync()` — the raw APNs/FCM token — is deliberately NOT
 * used anywhere: registering one of those looks entirely successful and then
 * every push silently fails at delivery time. `@oxyhq/core`'s
 * `registerPushToken` rejects a raw device token before sending, and this module
 * is the reason it never has to.
 */

import { Platform } from 'react-native';
import { logger } from '@oxyhq/core';
import type { PushTokenPlatform } from '@oxyhq/core';

type NotificationsModule = typeof import('expo-notifications');

const LOG_CONTEXT = { component: 'device-notifications' } as const;

/** Must match `IDENTITY_APPROVAL_PUSH_CHANNEL` on the API push sender. */
export const AUTH_APPROVAL_NOTIFICATION_CHANNEL = 'auth-approval';

/**
 * Load `expo-notifications`, or `null` when it cannot serve this platform/build.
 *
 * The dynamic import is intentional: the module registry caches it, so repeated
 * calls are cheap, and no module-level mutable cache is introduced here.
 */
async function loadNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    return await import('expo-notifications');
  } catch (error) {
    logger.warn(
      '[commons] expo-notifications is unavailable in this build — push is disabled',
      LOG_CONTEXT,
      error,
    );
    return null;
  }
}

/**
 * The platform tag the push-token registry stores this installation under, or
 * `null` on a platform Oxy does not deliver push to.
 */
export function pushTokenPlatform(): PushTokenPlatform | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return null;
}

/**
 * Whether the OS notification permission is ALREADY granted.
 *
 * Never prompts — onboarding owns the single permission request
 * ({@link requestNotificationPermission}), so the app can re-check on every cold
 * boot without ever asking the user twice.
 */
export async function hasNotificationPermission(): Promise<boolean> {
  const notifications = await loadNotifications();
  if (!notifications) {
    return false;
  }
  try {
    const permissions = await notifications.getPermissionsAsync();
    return permissions.granted === true;
  } catch (error) {
    logger.warn('[commons] could not read the notification permission', LOG_CONTEXT, error);
    return false;
  }
}

/**
 * Prompt for the OS notification permission. Onboarding is the only caller.
 *
 * @returns Whether notifications are granted after the prompt (already-granted
 *   installations resolve `true` without a second system dialog).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const notifications = await loadNotifications();
  if (!notifications) {
    return false;
  }
  try {
    const existing = await notifications.getPermissionsAsync();
    if (existing.granted === true) {
      return true;
    }
    const requested = await notifications.requestPermissionsAsync();
    return requested.granted === true;
  } catch (error) {
    logger.warn('[commons] notification permission request failed', LOG_CONTEXT, error);
    return false;
  }
}

/**
 * Ensure the Android channel used for sign-in approval pushes exists.
 *
 * Without this, Android 8+ may drop notifications sent to an unknown channel id.
 */
export async function ensureAuthApprovalNotificationChannel(): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications || Platform.OS !== 'android') {
    return;
  }
  try {
    await notifications.setNotificationChannelAsync(AUTH_APPROVAL_NOTIFICATION_CHANNEL, {
      name: 'Sign-in requests',
      importance: notifications.AndroidImportance.HIGH,
      description: 'Alerts when another device requests approval to sign in',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  } catch (error) {
    logger.warn('[commons] could not create the auth-approval notification channel', LOG_CONTEXT, error);
  }
}

/**
 * This installation's Expo push token (`ExponentPushToken[…]`), or `null` when
 * it cannot be minted (no permission, no EAS project id, offline).
 *
 * Deliberately `getExpoPushTokenAsync` — see the module header for why the raw
 * device-token variant is never used. The project id is resolved by
 * `expo-notifications` itself from the app config, so there is no second,
 * drifting copy of that lookup here.
 */
export async function getExpoPushToken(): Promise<string | null> {
  const notifications = await loadNotifications();
  if (!notifications) {
    return null;
  }
  try {
    const token = await notifications.getExpoPushTokenAsync();
    return token.data.length > 0 ? token.data : null;
  } catch (error) {
    logger.warn('[commons] could not mint an Expo push token', LOG_CONTEXT, error);
    return null;
  }
}

/**
 * Take the payload of the notification that COLD-LAUNCHED the app, if any.
 *
 * "Take" is literal: the response is cleared from `expo-notifications` once
 * read, so a listener attached later in the same launch is not handed the same
 * tap again. (The claim ledger in `auth-request-push.ts` is the belt to this
 * braces — clearing is best-effort across OS/module versions.)
 *
 * @returns The raw `content.data` of the launching notification, or `null`.
 */
export async function takeLaunchNotificationData(): Promise<unknown> {
  const notifications = await loadNotifications();
  if (!notifications) {
    return null;
  }
  try {
    const response = notifications.getLastNotificationResponse();
    if (!response) {
      return null;
    }
    const data: unknown = response.notification.request.content.data;
    try {
      notifications.clearLastNotificationResponse();
    } catch (clearError) {
      logger.warn(
        '[commons] could not clear the launching notification response',
        LOG_CONTEXT,
        clearError,
      );
    }
    return data;
  } catch (error) {
    logger.warn('[commons] could not read the launching notification', LOG_CONTEXT, error);
    return null;
  }
}

/**
 * Subscribe to notification TAPS (responses) while the app is running.
 *
 * @param listener - Receives the raw, untrusted `content.data` of the tapped
 *   notification. Parsing/validation is the caller's job.
 * @returns An unsubscribe function. Safe to call even if the subscription could
 *   not be established.
 */
export async function subscribeToNotificationResponses(
  listener: (data: unknown) => void,
): Promise<() => void> {
  const notifications = await loadNotifications();
  if (!notifications) {
    return () => undefined;
  }
  try {
    const subscription = notifications.addNotificationResponseReceivedListener((response) => {
      listener(response.notification.request.content.data);
    });
    return () => subscription.remove();
  } catch (error) {
    logger.warn('[commons] could not subscribe to notification taps', LOG_CONTEXT, error);
    return () => undefined;
  }
}
