/**
 * @jest-environment-options {"url": "https://accounts.oxy.so/"}
 *
 * Lifecycle tests for the web "Sign in with Oxy" (QR) hook. We stub OxyServices
 * (start/poll/claim) and `qrcode` so the flow runs with no network/canvas, and
 * assert the phase machine: start → render QR → poll → claim → commit, plus the
 * expired / denied / missing-clientId branches.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import type { OxyServices } from '@oxyhq/core';
import {
  useCommonsSignIn,
  type CommonsClaimResult,
} from '../../src/hooks/useCommonsSignIn';

// Stub `qrcode` so the hook renders a deterministic data URL without a canvas.
jest.mock(
  'qrcode',
  () => {
    const toDataURL = jest.fn(async () => 'data:image/png;base64,QR');
    return { __esModule: true, default: { toDataURL }, toDataURL };
  },
  { virtual: true },
);

const QR_PAYLOAD = 'oxycommons://approve?v=1&code=code-1';

const claimResult: CommonsClaimResult = {
  accessToken: 'at-1',
  sessionId: 's1',
  deviceId: 'd1',
  expiresAt: '2026-06-26T00:05:00.000Z',
  user: { id: 'u1', username: 'nate', name: { displayName: 'Nate' } },
};

interface StubServices {
  startCommonsSignIn: jest.Mock;
  pollCommonsSignIn: jest.Mock;
  claimSessionByToken: jest.Mock;
}

function makeServices(overrides: Partial<StubServices> = {}): StubServices {
  return {
    startCommonsSignIn: jest.fn(async () => ({
      sessionToken: 'secret-token',
      authorizeCode: 'code-1',
      qrPayload: QR_PAYLOAD,
      expiresAt: Date.now() + 5 * 60 * 1000,
      status: 'pending',
    })),
    pollCommonsSignIn: jest.fn(async () => ({ authorized: false, status: 'pending' })),
    claimSessionByToken: jest.fn(async () => claimResult),
    ...overrides,
  };
}

function renderCommons(services: StubServices, onAuthenticated?: jest.Mock, onError?: jest.Mock) {
  return renderHook(() =>
    useCommonsSignIn({
      oxyServices: services as unknown as OxyServices,
      clientId: 'oxy_dk_test',
      onAuthenticated,
      onError,
      pollIntervalMs: 10,
    }),
  );
}

describe('useCommonsSignIn', () => {
  it('starts a session, renders the QR, polls, claims, and commits', async () => {
    // Stay `pending` until we flip `approved`, so the transient `waiting` phase
    // is observable before approval drives the flow to completion.
    let approved = false;
    const services = makeServices({
      pollCommonsSignIn: jest.fn(async () =>
        approved ? { authorized: true, sessionId: 's1' } : { authorized: false, status: 'pending' },
      ),
    });
    const onAuthenticated = jest.fn(async () => undefined);
    const { result } = renderCommons(services, onAuthenticated);

    expect(result.current.phase).toBe('idle');

    act(() => result.current.start());

    // QR is rendered and we sit in `waiting`.
    await waitFor(() => expect(result.current.phase).toBe('waiting'));
    expect(services.startCommonsSignIn).toHaveBeenCalledWith({ clientId: 'oxy_dk_test' });
    expect(result.current.qrPayload).toBe(QR_PAYLOAD);
    expect(result.current.qrImageDataUrl).toBe('data:image/png;base64,QR');
    expect(result.current.isActive).toBe(true);

    // Approve → the next poll authorizes → claim → commit.
    act(() => {
      approved = true;
    });
    await waitFor(() => expect(result.current.phase).toBe('authorized'));
    expect(services.claimSessionByToken).toHaveBeenCalledWith('secret-token');
    expect(onAuthenticated).toHaveBeenCalledWith(claimResult);
    expect(result.current.isActive).toBe(false);
  });

  it('moves to `expired` when the server reports the session expired', async () => {
    const services = makeServices({
      pollCommonsSignIn: jest.fn(async () => ({ authorized: false, status: 'expired' })),
    });
    const onAuthenticated = jest.fn(async () => undefined);
    const { result } = renderCommons(services, onAuthenticated);

    act(() => result.current.start());

    await waitFor(() => expect(result.current.phase).toBe('expired'));
    expect(services.claimSessionByToken).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('moves to `denied` when the approver cancels', async () => {
    const services = makeServices({
      pollCommonsSignIn: jest.fn(async () => ({ authorized: false, status: 'cancelled' })),
    });
    const { result } = renderCommons(services);

    act(() => result.current.start());

    await waitFor(() => expect(result.current.phase).toBe('denied'));
    expect(services.claimSessionByToken).not.toHaveBeenCalled();
  });

  it('fails fast with no clientId and never hits the network', async () => {
    const services = makeServices();
    const onError = jest.fn();
    const { result } = renderHook(() =>
      useCommonsSignIn({
        oxyServices: services as unknown as OxyServices,
        clientId: null,
        onError,
      }),
    );

    act(() => result.current.start());

    expect(result.current.phase).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(services.startCommonsSignIn).not.toHaveBeenCalled();
  });

  it('reset() cancels an active flow back to idle', async () => {
    const services = makeServices();
    const { result } = renderCommons(services);

    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe('waiting'));

    act(() => result.current.reset());

    expect(result.current.phase).toBe('idle');
    expect(result.current.qrPayload).toBeNull();
    expect(result.current.qrImageDataUrl).toBeNull();
  });
});
