/**
 * @jest-environment jsdom
 *
 * `useOxyAuthSession` — "Sign in with Oxy" handoff surface (Workstream C3).
 *
 * The device-flow hook now surfaces the PUBLIC `authorizeCode` and the
 * structured `qrPayload` string from the extended `POST /auth/session/create`
 * response, plus an `openSameDeviceApproval()` action that deep-links the
 * `qrPayload` so the native Oxy identity app can approve on the same device. The
 * legacy socket/poll/claim machinery is unchanged; these tests pin only the new
 * handoff fields.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { Linking } from 'react-native';
import type { OxyServices } from '@oxyhq/core';
import { useOxyAuthSession } from '../../src/ui/hooks/useOxyAuthSession';

function buildStub(createResponse: Record<string, unknown>) {
  const makeRequest = jest.fn(async (method: string, path: string) => {
    if (method === 'POST' && path === '/auth/session/create') {
      return createResponse;
    }
    // Poll status — keep the session pending so the flow never completes.
    return { authorized: false };
  });
  const stub = {
    getBaseURL: () => 'https://api.mention.earth',
    config: {},
    makeRequest,
  };
  return { stub: stub as unknown as OxyServices, makeRequest };
}

describe('useOxyAuthSession — Sign in with Oxy handoff fields', () => {
  let openURLSpy: jest.SpyInstance;

  beforeEach(() => {
    openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    openURLSpy.mockRestore();
  });

  it('surfaces authorizeCode + qrPayload and deep-links qrPayload on same-device approval', async () => {
    const { stub } = buildStub({
      authorizeCode: 'code-xyz',
      qrPayload: 'oxycommons://approve?v=1&code=code-xyz',
      status: 'pending',
    });

    const { result, unmount } = renderHook(() =>
      useOxyAuthSession(stub, 'oxy_dk_test', undefined),
    );

    await waitFor(() => expect(result.current.qrPayload).toBe('oxycommons://approve?v=1&code=code-xyz'));
    expect(result.current.authorizeCode).toBe('code-xyz');
    // The legacy token QR is still produced for backward compatibility.
    expect(result.current.qrData).toMatch(/^oxyauth:\/\//);

    await act(async () => {
      await result.current.openSameDeviceApproval();
    });
    expect(openURLSpy).toHaveBeenCalledWith('oxycommons://approve?v=1&code=code-xyz');

    unmount();
  });

  it('leaves the handoff fields null and no-ops same-device approval when the backend omits them', async () => {
    const { stub } = buildStub({ status: 'pending' });

    const { result, unmount } = renderHook(() =>
      useOxyAuthSession(stub, 'oxy_dk_test', undefined),
    );

    // The session is created (the POST resolved) but no handoff fields exist.
    await waitFor(() => expect(result.current.isWaiting).toBe(true));
    expect(result.current.authorizeCode).toBeNull();
    expect(result.current.qrPayload).toBeNull();

    await act(async () => {
      await result.current.openSameDeviceApproval();
    });
    expect(openURLSpy).not.toHaveBeenCalled();

    unmount();
  });
});
