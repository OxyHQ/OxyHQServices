import { Platform } from 'react-native';

/**
 * `expo-notifications` is stubbed so the adapter's real logic runs against a
 * controllable module. The single most important assertion in this file is that
 * `getDevicePushTokenAsync` is NEVER called: a raw APNs/FCM token registers
 * "successfully" and then silently fails at delivery forever, so the only way to
 * make that class of bug impossible is to never obtain one.
 */
jest.mock(
  'expo-notifications',
  () => ({
    __esModule: true,
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    getDevicePushTokenAsync: jest.fn(),
    getLastNotificationResponse: jest.fn(),
    clearLastNotificationResponse: jest.fn(),
    addNotificationResponseReceivedListener: jest.fn(),
  }),
  { virtual: true },
);

interface NotificationsStub {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
  getDevicePushTokenAsync: jest.Mock;
  getLastNotificationResponse: jest.Mock;
  clearLastNotificationResponse: jest.Mock;
  addNotificationResponseReceivedListener: jest.Mock;
}

const notifications = jest.requireMock('expo-notifications') as NotificationsStub;

// eslint-disable-next-line import/first
import {
  getExpoPushToken,
  hasNotificationPermission,
  pushTokenPlatform,
  requestNotificationPermission,
  subscribeToNotificationResponses,
  takeLaunchNotificationData,
} from '@/lib/notifications/device-notifications';

const EXPO_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const RAW_DEVICE_TOKEN = '740f4707bebcf74f9b7c25d48e3358945f6aa01da5ddb387462c7eaf61bb78ad';

function notificationResponse(data: unknown) {
  return { notification: { request: { content: { data } } } };
}

describe('device notifications adapter', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'ios';
    notifications.getPermissionsAsync.mockReset();
    notifications.requestPermissionsAsync.mockReset();
    notifications.getExpoPushTokenAsync.mockReset();
    notifications.getDevicePushTokenAsync.mockReset();
    notifications.getLastNotificationResponse.mockReset();
    notifications.clearLastNotificationResponse.mockReset();
    notifications.addNotificationResponseReceivedListener.mockReset();

    notifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    notifications.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    notifications.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: EXPO_TOKEN });
    notifications.getDevicePushTokenAsync.mockResolvedValue({ type: 'apns', data: RAW_DEVICE_TOKEN });
    notifications.getLastNotificationResponse.mockReturnValue(null);
    notifications.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() });
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  describe('getExpoPushToken', () => {
    it('mints an EXPO push token and never touches the raw device token', async () => {
      await expect(getExpoPushToken()).resolves.toBe(EXPO_TOKEN);

      expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
      expect(notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
    });

    it('resolves null (never a partial/garbage token) when the mint fails', async () => {
      notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('no EAS projectId'));

      await expect(getExpoPushToken()).resolves.toBeNull();
    });

    it('resolves null for an empty token', async () => {
      notifications.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: '' });

      await expect(getExpoPushToken()).resolves.toBeNull();
    });
  });

  describe('permissions', () => {
    it('checks the permission without ever prompting', async () => {
      await expect(hasNotificationPermission()).resolves.toBe(true);

      expect(notifications.getPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('reports a denied permission as not granted', async () => {
      notifications.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });

      await expect(hasNotificationPermission()).resolves.toBe(false);
    });

    it('does not show a second system dialog when already granted', async () => {
      await expect(requestNotificationPermission()).resolves.toBe(true);

      expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('prompts exactly once when the permission is undetermined', async () => {
      notifications.getPermissionsAsync.mockResolvedValue({
        granted: false,
        status: 'undetermined',
      });

      await expect(requestNotificationPermission()).resolves.toBe(true);

      expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('takeLaunchNotificationData', () => {
    it('returns the launching payload and clears it so it cannot be handled twice', async () => {
      const data = { type: 'oxy_commons_auth_request', approvalUrl: 'oxycommons://approve?code=a' };
      notifications.getLastNotificationResponse.mockReturnValue(notificationResponse(data));

      await expect(takeLaunchNotificationData()).resolves.toEqual(data);
      expect(notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    });

    it('returns null when no notification launched the app', async () => {
      await expect(takeLaunchNotificationData()).resolves.toBeNull();
      expect(notifications.clearLastNotificationResponse).not.toHaveBeenCalled();
    });
  });

  describe('subscribeToNotificationResponses', () => {
    it('forwards the raw payload of a tapped notification and unsubscribes cleanly', async () => {
      const remove = jest.fn();
      notifications.addNotificationResponseReceivedListener.mockReturnValue({ remove });
      const received: unknown[] = [];

      const unsubscribe = await subscribeToNotificationResponses((data) => received.push(data));

      const [listener] = notifications.addNotificationResponseReceivedListener.mock.calls[0] as [
        (response: ReturnType<typeof notificationResponse>) => void,
      ];
      listener(notificationResponse({ type: 'oxy_commons_auth_request' }));

      expect(received).toEqual([{ type: 'oxy_commons_auth_request' }]);

      unsubscribe();
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });

  describe('platform gating', () => {
    it('maps the running platform to the registry tag', () => {
      Platform.OS = 'ios';
      expect(pushTokenPlatform()).toBe('ios');
      Platform.OS = 'android';
      expect(pushTokenPlatform()).toBe('android');
      Platform.OS = 'macos';
      expect(pushTokenPlatform()).toBeNull();
    });

    it('never loads the native module on web', async () => {
      Platform.OS = 'web';

      await expect(hasNotificationPermission()).resolves.toBe(false);
      await expect(getExpoPushToken()).resolves.toBeNull();
      await expect(takeLaunchNotificationData()).resolves.toBeNull();
      const unsubscribe = await subscribeToNotificationResponses(() => undefined);
      unsubscribe();

      expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
      expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
      expect(notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    });
  });
});
