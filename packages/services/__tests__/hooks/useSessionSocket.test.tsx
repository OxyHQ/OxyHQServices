/**
 * Tests for `useSessionSocket`'s session_update handler.
 *
 * The whitelist enforced by the switch is critical: in earlier versions
 * a fall-through default branch matched the `session_created` event
 * fired immediately after sign-in and triggered an instant remote
 * sign-out — see the comment in `useSessionSocket.ts`. These tests pin
 * the current behavior:
 *
 *   1. `session_created` / `session_update` → just refresh, NEVER sign out.
 *   2. Unknown events → log a warning, NEVER sign out.
 *   3. `session_removed` → sign out only when the removed session is
 *      the active one. Other sessions trigger a refresh.
 *   4. `device_removed` → sign out only when the removed device matches
 *      the current device.
 *   5. `sessions_removed` → sign out only when the active session id is
 *      in the removed list.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { toast } from '@oxyhq/bloom';
import io from 'socket.io-client';
import { useSessionSocket } from '../../src/ui/hooks/useSessionSocket';

interface MockSocket {
  emit: (e: string, ...args: unknown[]) => boolean;
}
type MockIo = jest.Mock & { __sockets: MockSocket[]; __reset: () => void };
const mockIo = io as unknown as MockIo;
const mockToastInfo = toast.info as unknown as jest.Mock;

interface Handlers {
  refreshSessions: jest.Mock;
  clearSessionState: jest.Mock;
  onRemoteSignOut: jest.Mock;
  onSessionRemoved: jest.Mock;
  getAccessToken: jest.Mock;
}

const baseProps = (overrides: Partial<Handlers> = {}) => ({
  userId: 'user-1',
  activeSessionId: 'session-1',
  currentDeviceId: 'device-1',
  refreshSessions: overrides.refreshSessions ?? jest.fn(async () => undefined),
  clearSessionState: overrides.clearSessionState ?? jest.fn(async () => undefined),
  baseURL: 'https://api.example.com',
  getAccessToken: overrides.getAccessToken ?? jest.fn(() => 'token-abc'),
  onRemoteSignOut: overrides.onRemoteSignOut ?? jest.fn(),
  onSessionRemoved: overrides.onSessionRemoved ?? jest.fn(),
});

describe('useSessionSocket — strict event whitelist', () => {
  beforeEach(() => {
    mockIo.__reset();
    mockIo.mockClear();
  });

  const latestSocket = () => mockIo.__sockets[mockIo.__sockets.length - 1];

  it('connects to the configured baseURL with a token-supplying auth callback', async () => {
    const getAccessToken = jest.fn(() => 'tok');
    renderHook(() => useSessionSocket(baseProps({ getAccessToken })));

    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1));

    const [url, options] = mockIo.mock.calls[0] as [
      string,
      { auth: (cb: (data: { token: string }) => void) => void },
    ];
    expect(url).toBe('https://api.example.com');

    let captured: { token: string } | null = null;
    options.auth((data) => {
      captured = data;
    });
    expect(captured).toEqual({ token: 'tok' });
    expect(getAccessToken).toHaveBeenCalled();
  });

  it('does NOT trigger sign-out on `session_created`', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'session_created',
      sessionId: 'session-1', // same id as active — would have killed the session in the old fall-through
    });

    await waitFor(() => expect(props.refreshSessions).toHaveBeenCalled());
    expect(props.onRemoteSignOut).not.toHaveBeenCalled();
    expect(props.clearSessionState).not.toHaveBeenCalled();
  });

  it('does NOT trigger sign-out on `session_update`', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'session_update',
      sessionId: 'session-1',
    });

    await waitFor(() => expect(props.refreshSessions).toHaveBeenCalled());
    expect(props.onRemoteSignOut).not.toHaveBeenCalled();
  });

  it('does NOT trigger sign-out on unknown event types', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'totally_unknown_event',
      sessionId: 'session-1',
    });

    // Allow microtask queue to drain.
    await new Promise((r) => setTimeout(r, 10));
    expect(props.onRemoteSignOut).not.toHaveBeenCalled();
    expect(props.clearSessionState).not.toHaveBeenCalled();
    expect(props.refreshSessions).not.toHaveBeenCalled();
  });

  it('signs out on `session_removed` when the removed session is active', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'session_removed',
      sessionId: 'session-1',
    });

    await waitFor(() => expect(props.onRemoteSignOut).toHaveBeenCalledTimes(1));
    expect(props.clearSessionState).toHaveBeenCalledTimes(1);
    expect(props.onSessionRemoved).toHaveBeenCalledWith('session-1');
  });

  it('refreshes (does not sign out) on `session_removed` for a non-active session', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'session_removed',
      sessionId: 'some-other-session',
    });

    await waitFor(() => expect(props.refreshSessions).toHaveBeenCalled());
    expect(props.onRemoteSignOut).not.toHaveBeenCalled();
    expect(props.clearSessionState).not.toHaveBeenCalled();
    expect(props.onSessionRemoved).toHaveBeenCalledWith('some-other-session');
  });

  it('signs out on `device_removed` when the deviceId matches the current device', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'device_removed',
      deviceId: 'device-1',
      sessionIds: ['session-1', 'session-2'],
    });

    await waitFor(() => expect(props.onRemoteSignOut).toHaveBeenCalledTimes(1));
    expect(props.clearSessionState).toHaveBeenCalledTimes(1);
    expect(props.onSessionRemoved).toHaveBeenCalledWith('session-1');
    expect(props.onSessionRemoved).toHaveBeenCalledWith('session-2');
  });

  it('only refreshes on `device_removed` for a different deviceId', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'device_removed',
      deviceId: 'some-other-device',
      sessionIds: ['session-99'],
    });

    await waitFor(() => expect(props.refreshSessions).toHaveBeenCalled());
    expect(props.onRemoteSignOut).not.toHaveBeenCalled();
    expect(props.onSessionRemoved).toHaveBeenCalledWith('session-99');
  });

  it('signs out on `sessions_removed` when active session is in the list', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'sessions_removed',
      sessionIds: ['session-0', 'session-1', 'session-2'],
    });

    await waitFor(() => expect(props.onRemoteSignOut).toHaveBeenCalledTimes(1));
    expect(props.clearSessionState).toHaveBeenCalledTimes(1);
    expect(props.onSessionRemoved).toHaveBeenCalledTimes(3);
  });

  it('only refreshes on `sessions_removed` when active session is not in the list', async () => {
    const props = baseProps();
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'sessions_removed',
      sessionIds: ['session-99', 'session-100'],
    });

    await waitFor(() => expect(props.refreshSessions).toHaveBeenCalled());
    expect(props.onRemoteSignOut).not.toHaveBeenCalled();
  });

  it('falls back to toast.info when onRemoteSignOut callback is undefined', async () => {
    mockToastInfo.mockClear();

    const clearSessionState = jest.fn(async () => undefined);
    const props = {
      ...baseProps(),
      onRemoteSignOut: undefined,
      clearSessionState,
    };
    renderHook(() => useSessionSocket(props));
    await waitFor(() => expect(mockIo).toHaveBeenCalled());

    latestSocket().emit('session_update', {
      type: 'session_removed',
      sessionId: 'session-1',
    });

    await waitFor(() => expect(clearSessionState).toHaveBeenCalled());
    expect(mockToastInfo).toHaveBeenCalledWith(
      expect.stringContaining('signed out remotely'),
    );
  });

  it('does not connect when userId is missing', () => {
    const props = { ...baseProps(), userId: null };
    renderHook(() => useSessionSocket(props));
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('does not connect when baseURL is missing', () => {
    const props = { ...baseProps(), baseURL: '' };
    renderHook(() => useSessionSocket(props));
    expect(mockIo).not.toHaveBeenCalled();
  });
});
