/**
 * @jest-environment node
 *
 * Regression coverage for the device-flow sign-in bugs:
 *
 *   BUG 1 (native): tapping "Sign In with Oxy" opens `OxyAuthScreen`, which
 *   creates a device-flow AuthSession and opens auth.oxy.so/authorize. The
 *   user signs in successfully, the API authorizes the session and notifies
 *   the client via the auth-session socket — but the screen then called
 *   `switchSession` DIRECTLY without first claiming the bearer with the
 *   secret `sessionToken`. The session was authorized server-side but the app
 *   never became authenticated ("nothing happens").
 *
 *   BUG 2 (session-sync cutover regression): once claiming was fixed,
 *   `completeDeviceFlowSignIn` still committed the claimed session through
 *   `switchSession`. After the session-sync cutover, `switchSession` became an
 *   account-SWITCH between accounts already registered on the device and
 *   throws `No device account found for session "..."` for a freshly-claimed
 *   session that was never registered — surfacing as "Authorization
 *   successful but failed to complete sign in." The fix commits the claimed
 *   session through `commitSession` (`useOxy().handleWebSession`) instead —
 *   the same path a fresh password sign-in uses to register the account
 *   into the device's session set.
 *
 *   These tests pin the order (claim before commit), the fail-fast behaviour
 *   on a claim that returns no usable session, and propagation of a
 *   `commitSession` failure.
 */

import type { SessionLoginResponse, User } from '@oxyhq/core';
import {
  completeDeviceFlowSignIn,
  type DeviceFlowClient,
} from '../deviceFlowSignIn';

const SESSION_ID = 'session-id-123';
const SESSION_TOKEN = 'a'.repeat(32);
const ACCESS_TOKEN = 'access-token-abc';
const USER = {
  id: 'user-1',
  username: 'nate',
  name: { displayName: 'Nate' },
  privacySettings: {},
} as User;
// The session carries only the minimal shape (`id`/`username`/`name`/`avatar`)
// — this is what `commitSession` receives, not the full claimed `User`.
const MINIMAL_USER = { id: USER.id, username: USER.username, name: USER.name, avatar: undefined };

describe('completeDeviceFlowSignIn', () => {
  it('claims the sessionToken BEFORE committing the session', async () => {
    const order: string[] = [];

    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async (token: string) => {
        expect(token).toBe(SESSION_TOKEN);
        order.push('claim');
        return {
          accessToken: ACCESS_TOKEN,
          sessionId: SESSION_ID,
          deviceId: 'device-1',
          expiresAt: '2026-01-01T00:00:00.000Z',
          user: USER,
        };
      }),
    };
    const commitSession = jest.fn(async (session: SessionLoginResponse): Promise<void> => {
      expect(session).toEqual({
        sessionId: SESSION_ID,
        deviceId: 'device-1',
        expiresAt: '2026-01-01T00:00:00.000Z',
        user: MINIMAL_USER,
        accessToken: ACCESS_TOKEN,
      });
      order.push('commit');
    });

    const user = await completeDeviceFlowSignIn({
      oxyServices,
      sessionId: SESSION_ID,
      sessionToken: SESSION_TOKEN,
      commitSession,
    });

    expect(order).toEqual(['claim', 'commit']);
    expect(oxyServices.claimSessionByToken).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(commitSession).toHaveBeenCalledTimes(1);
    expect(user).toBe(USER);
  });

  it('falls back to the delivered sessionId/deviceId/expiresAt when the claim omits them', async () => {
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => ({
        accessToken: ACCESS_TOKEN,
        user: USER,
      })),
    };
    const commitSession = jest.fn(async (): Promise<void> => {});

    await completeDeviceFlowSignIn({
      oxyServices,
      sessionId: SESSION_ID,
      sessionToken: SESSION_TOKEN,
      commitSession,
    });

    expect(commitSession).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      deviceId: '',
      expiresAt: '',
      user: MINIMAL_USER,
      accessToken: ACCESS_TOKEN,
    });
  });

  it('does NOT commit the session when the claim fails (the original native regression)', async () => {
    const claimError = new Error('claim failed (401)');
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => {
        throw claimError;
      }),
    };
    const commitSession = jest.fn(async (): Promise<void> => {});

    await expect(
      completeDeviceFlowSignIn({
        oxyServices,
        sessionId: SESSION_ID,
        sessionToken: SESSION_TOKEN,
        commitSession,
      }),
    ).rejects.toThrow('claim failed (401)');

    // The bearer was never planted, so we must not attempt the bearer-protected
    // commit — surfacing the failure to the caller instead.
    expect(commitSession).not.toHaveBeenCalled();
  });

  it('throws when the claim returns no accessToken (the session-sync regression guard)', async () => {
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => ({ sessionId: SESSION_ID, user: USER })),
    };
    const commitSession = jest.fn(async (): Promise<void> => {});

    await expect(
      completeDeviceFlowSignIn({
        oxyServices,
        sessionId: SESSION_ID,
        sessionToken: SESSION_TOKEN,
        commitSession,
      }),
    ).rejects.toThrow('Device-flow claim did not return a usable session');

    expect(commitSession).not.toHaveBeenCalled();
  });

  it('throws when the claim returns no user', async () => {
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => ({ accessToken: ACCESS_TOKEN, sessionId: SESSION_ID })),
    };
    const commitSession = jest.fn(async (): Promise<void> => {});

    await expect(
      completeDeviceFlowSignIn({
        oxyServices,
        sessionId: SESSION_ID,
        sessionToken: SESSION_TOKEN,
        commitSession,
      }),
    ).rejects.toThrow('Device-flow claim did not return a usable session');

    expect(commitSession).not.toHaveBeenCalled();
  });

  it('propagates a commitSession failure after a successful claim', async () => {
    const commitError = new Error('session invalid');
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => ({
        accessToken: ACCESS_TOKEN,
        sessionId: SESSION_ID,
        user: USER,
      })),
    };
    const commitSession = jest.fn(async (): Promise<void> => {
      throw commitError;
    });

    await expect(
      completeDeviceFlowSignIn({
        oxyServices,
        sessionId: SESSION_ID,
        sessionToken: SESSION_TOKEN,
        commitSession,
      }),
    ).rejects.toThrow('session invalid');

    expect(oxyServices.claimSessionByToken).toHaveBeenCalledTimes(1);
    expect(commitSession).toHaveBeenCalledTimes(1);
  });
});
