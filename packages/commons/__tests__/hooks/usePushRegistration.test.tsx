import { act, renderHook, waitFor } from '@testing-library/react';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';
import { OXY_CLIENT_ID } from '@/constants/oxy';

const mockHasNotificationPermission = jest.fn<Promise<boolean>, []>();
const mockGetExpoPushToken = jest.fn<Promise<string | null>, []>();

// Replace the native adapter so the REAL orchestration + Commons client-id
// wiring runs, without loading `expo-notifications`.
jest.mock('@/lib/notifications/device-notifications', () => ({
  hasNotificationPermission: () => mockHasNotificationPermission(),
  getExpoPushToken: () => mockGetExpoPushToken(),
  pushTokenPlatform: () => 'android',
  requestNotificationPermission: () => Promise.resolve(false),
  // The stand-in must expose the WHOLE adapter surface: the orchestration
  // awaits the Android channel step before it ever asks for a token, so a
  // missing export here aborts registration and the failure reads as "the
  // hook stopped registering" rather than "the mock is incomplete".
  ensureAuthApprovalNotificationChannel: () => Promise.resolve(),
}));

// Imported AFTER jest.mock so the hook sees the patched adapter.
// eslint-disable-next-line import/first
import { usePushRegistration } from '@/hooks/notifications/usePushRegistration';

const EXPO_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

interface PushMocks {
  registerPushToken: jest.Mock;
  unregisterPushToken: jest.Mock;
}

function installSession(
  overrides: { canUsePrivateApi?: boolean; userId?: string; deviceId?: string } = {},
): PushMocks {
  const services: PushMocks = {
    registerPushToken: jest.fn(async () => undefined),
    unregisterPushToken: jest.fn(async () => undefined),
  };
  __setOxyState({
    isAuthenticated: overrides.canUsePrivateApi ?? false,
    canUsePrivateApi: overrides.canUsePrivateApi ?? false,
    user: { id: overrides.userId ?? 'user-1', username: 'nate' },
    oxyServices: services,
    sessionClient: overrides.deviceId
      ? { getState: () => ({ deviceId: overrides.deviceId ?? '' }) }
      : null,
  });
  return services;
}

/**
 * Registration is what lets a desktop "Continue with Oxy" reach this phone, so
 * the hook's contract is entirely about NOT firing too early: a bearer-authed
 * call before the session resolves is a guaranteed 401, and a registration
 * without the OS permission is one the user never agreed to.
 */
describe('usePushRegistration', () => {
  beforeEach(() => {
    __resetOxyState();
    mockHasNotificationPermission.mockReset().mockResolvedValue(true);
    mockGetExpoPushToken.mockReset().mockResolvedValue(EXPO_TOKEN);
  });

  it('does not register before a session exists', async () => {
    const services = installSession({ canUsePrivateApi: false });

    renderHook(() => usePushRegistration());

    // Give any stray async work a chance to run before asserting the negative.
    await act(async () => {
      await Promise.resolve();
    });
    expect(services.registerPushToken).not.toHaveBeenCalled();
  });

  it('registers once the session resolves, scoped to the Commons client id', async () => {
    const services = installSession({ canUsePrivateApi: false });

    renderHook(() => usePushRegistration());
    expect(services.registerPushToken).not.toHaveBeenCalled();

    act(() => {
      __setOxyState({ isAuthenticated: true, canUsePrivateApi: true });
    });

    await waitFor(() => expect(services.registerPushToken).toHaveBeenCalledTimes(1));
    expect(services.registerPushToken).toHaveBeenCalledWith({
      expoPushToken: EXPO_TOKEN,
      platform: 'android',
      clientId: OXY_CLIENT_ID,
    });
  });

  it("threads the device session's deviceId when one is available", async () => {
    const services = installSession({ canUsePrivateApi: true, deviceId: 'device-9' });

    renderHook(() => usePushRegistration());

    await waitFor(() => expect(services.registerPushToken).toHaveBeenCalledTimes(1));
    expect(services.registerPushToken).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'device-9' }),
    );
  });

  it('does not register while the OS permission is not granted', async () => {
    mockHasNotificationPermission.mockResolvedValue(false);
    const services = installSession({ canUsePrivateApi: true });

    renderHook(() => usePushRegistration());

    await act(async () => {
      await Promise.resolve();
    });
    expect(services.registerPushToken).not.toHaveBeenCalled();
  });

  it('never prompts for the permission — onboarding owns the single dialog', async () => {
    const services = installSession({ canUsePrivateApi: true });

    renderHook(() => usePushRegistration());

    await waitFor(() => expect(services.registerPushToken).toHaveBeenCalledTimes(1));
    // The adapter's request-permission entry point is not part of this path.
    expect(mockHasNotificationPermission).toHaveBeenCalled();
  });

  it('registers at most once per identity, across re-renders', async () => {
    const services = installSession({ canUsePrivateApi: true });

    const { rerender } = renderHook(() => usePushRegistration());
    await waitFor(() => expect(services.registerPushToken).toHaveBeenCalledTimes(1));

    rerender();
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(services.registerPushToken).toHaveBeenCalledTimes(1);
  });

  it('swallows a registration failure — push is a convenience, not a gate', async () => {
    const services = installSession({ canUsePrivateApi: true });
    services.registerPushToken.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => usePushRegistration());

    await waitFor(() => expect(services.registerPushToken).toHaveBeenCalledTimes(1));
    expect(result.current).toBeUndefined();
  });
});
