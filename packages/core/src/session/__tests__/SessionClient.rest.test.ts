import type { DeviceSessionState } from '@oxyhq/contracts';
import { SessionClient, type SessionClientHost } from '../SessionClient';

const STATE = (rev: number): DeviceSessionState => ({
  deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: rev, updatedAt: 1720000000000,
});

function makeHost(makeRequest: jest.Mock): SessionClientHost {
  return { makeRequest, getBaseURL: () => 'http://test.invalid', getAccessToken: () => 't', onTokensChanged: () => () => undefined };
}

describe('SessionClient REST', () => {
  it('bootstrap GETs /session/device/state and applies it', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(3));
    const c = new SessionClient(makeHost(makeRequest));
    await c.bootstrap();
    expect(makeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
    expect(c.getState()?.revision).toBe(3);
  });

  it('switchAccount POSTs and applies the returned state', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(4));
    const c = new SessionClient(makeHost(makeRequest));
    await c.switchAccount('a1');
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/switch', { accountId: 'a1' }, { cache: false });
    expect(c.getState()?.revision).toBe(4);
  });

  it('signOut one account POSTs { accountId }', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(5));
    const c = new SessionClient(makeHost(makeRequest));
    await c.signOut({ accountId: 'a1' });
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/signout', { accountId: 'a1' }, { cache: false });
  });

  it('signOut all POSTs { all: true }', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(6));
    const c = new SessionClient(makeHost(makeRequest));
    await c.signOut({ all: true });
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/signout', { all: true }, { cache: false });
  });

  it('addCurrentAccount POSTs /session/device/add with no body', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(2));
    const c = new SessionClient(makeHost(makeRequest));
    await c.addCurrentAccount();
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/add', undefined, { cache: false });
  });

  it('does not throw / does not apply when the server returns invalid state', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce({ bogus: true });
    const c = new SessionClient(makeHost(makeRequest));
    await c.bootstrap();
    expect(c.getState()).toBeNull();
  });
});
