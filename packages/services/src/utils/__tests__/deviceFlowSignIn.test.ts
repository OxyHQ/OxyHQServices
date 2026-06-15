/**
 * @jest-environment node
 *
 * Regression coverage for the NATIVE device-flow sign-in bug:
 *
 *   On native, tapping "Sign In with Oxy" opens `OxyAuthScreen`, which creates
 *   a device-flow AuthSession and opens auth.oxy.so/authorize. The user signs
 *   in successfully, the API authorizes the session and notifies the client via
 *   the auth-session socket — but the screen then called `switchSession`
 *   DIRECTLY without first claiming the bearer with the secret `sessionToken`.
 *   `switchSession` -> `getTokenBySession` (`GET /session/token/:id`) requires a
 *   bearer the client did not yet hold, so it 401'd: the session was authorized
 *   server-side but the app never became authenticated ("nothing happens").
 *
 *   The web `SignInModal` already claimed first; the native screen did not.
 *   `completeDeviceFlowSignIn` consolidates the claim->switch sequence so both
 *   paths are identical. These tests pin the ORDER (claim before switch) and the
 *   fail-fast behaviour.
 */

import type { User } from '@oxyhq/core';
import {
  completeDeviceFlowSignIn,
  type DeviceFlowClient,
} from '../deviceFlowSignIn';

const SESSION_ID = 'session-id-123';
const SESSION_TOKEN = 'a'.repeat(32);
const USER = { id: 'user-1', username: 'nate', privacySettings: {} } as User;

describe('completeDeviceFlowSignIn', () => {
  it('claims the sessionToken BEFORE switching the session', async () => {
    const order: string[] = [];

    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async (token: string) => {
        expect(token).toBe(SESSION_TOKEN);
        order.push('claim');
      }),
    };
    const switchSession = jest.fn(async (sessionId: string): Promise<User> => {
      expect(sessionId).toBe(SESSION_ID);
      order.push('switch');
      return USER;
    });

    const user = await completeDeviceFlowSignIn({
      oxyServices,
      sessionId: SESSION_ID,
      sessionToken: SESSION_TOKEN,
      switchSession,
    });

    expect(order).toEqual(['claim', 'switch']);
    expect(oxyServices.claimSessionByToken).toHaveBeenCalledWith(SESSION_TOKEN);
    expect(switchSession).toHaveBeenCalledWith(SESSION_ID);
    expect(user).toBe(USER);
  });

  it('does NOT switch the session when the claim fails (the native regression)', async () => {
    const claimError = new Error('claim failed (401)');
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => {
        throw claimError;
      }),
    };
    const switchSession = jest.fn(async (): Promise<User> => USER);

    await expect(
      completeDeviceFlowSignIn({
        oxyServices,
        sessionId: SESSION_ID,
        sessionToken: SESSION_TOKEN,
        switchSession,
      }),
    ).rejects.toThrow('claim failed (401)');

    // The bearer was never planted, so we must not attempt the bearer-protected
    // switch — surfacing the failure to the caller instead.
    expect(switchSession).not.toHaveBeenCalled();
  });

  it('propagates a switchSession failure after a successful claim', async () => {
    const switchError = new Error('session invalid');
    const oxyServices: DeviceFlowClient = {
      claimSessionByToken: jest.fn(async () => undefined),
    };
    const switchSession = jest.fn(async (): Promise<User> => {
      throw switchError;
    });

    await expect(
      completeDeviceFlowSignIn({
        oxyServices,
        sessionId: SESSION_ID,
        sessionToken: SESSION_TOKEN,
        switchSession,
      }),
    ).rejects.toThrow('session invalid');

    expect(oxyServices.claimSessionByToken).toHaveBeenCalledTimes(1);
    expect(switchSession).toHaveBeenCalledTimes(1);
  });
});
