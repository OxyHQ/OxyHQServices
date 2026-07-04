import type { DeviceSessionState } from '@oxyhq/contracts';
import { SessionClient, type SessionClientHost } from '../SessionClient';

const stateWith = (rev: number, active: string | null, accountIds: string[]): DeviceSessionState => ({
  deviceId: 'd1',
  accounts: accountIds.map((id, i) => ({ accountId: id, sessionId: `s-${id}`, authuser: i })),
  activeAccountId: active,
  revision: rev,
  updatedAt: 1720000000000,
});

const sync = (state: DeviceSessionState) => ({ state, activeToken: { accessToken: `jwt-${state.revision}`, expiresAt: 'x' } });

function makeHost(makeRequest: jest.Mock, currentAccountId: string | null = null): SessionClientHost {
  return {
    makeRequest,
    getBaseURL: () => 'http://test.invalid',
    getAccessToken: () => 't',
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    getCurrentAccountId: () => currentAccountId,
  };
}

class TestClient extends SessionClient {
  public apply(raw: unknown): boolean {
    return this.applyState(raw);
  }
}

describe('SessionClient.registerAndActivate', () => {
  it('adds then switches to the explicit target when it is not already active', async () => {
    const makeRequest = jest
      .fn()
      // add → device set has a1 active, a2 present but not active
      .mockResolvedValueOnce(sync(stateWith(1, 'a1', ['a1', 'a2'])))
      // switch → a2 becomes active
      .mockResolvedValueOnce(sync(stateWith(2, 'a2', ['a1', 'a2'])));
    const c = new SessionClient(makeHost(makeRequest));

    await c.registerAndActivate('a2');

    expect(makeRequest).toHaveBeenNthCalledWith(1, 'POST', '/session/device/add', undefined, { cache: false });
    expect(makeRequest).toHaveBeenNthCalledWith(2, 'POST', '/session/device/switch', { accountId: 'a2' }, { cache: false });
    expect(c.getState()?.activeAccountId).toBe('a2');
  });

  it('falls back to the host current-account ref when no target is passed', async () => {
    const makeRequest = jest
      .fn()
      .mockResolvedValueOnce(sync(stateWith(1, 'a1', ['a1', 'a2'])))
      .mockResolvedValueOnce(sync(stateWith(2, 'a2', ['a1', 'a2'])));
    const c = new SessionClient(makeHost(makeRequest, 'a2'));

    await c.registerAndActivate();

    expect(makeRequest).toHaveBeenNthCalledWith(2, 'POST', '/session/device/switch', { accountId: 'a2' }, { cache: false });
  });

  it('does NOT switch when the added account is already active', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(sync(stateWith(1, 'a1', ['a1'])));
    const c = new SessionClient(makeHost(makeRequest));

    await c.registerAndActivate('a1');

    expect(makeRequest).toHaveBeenCalledTimes(1);
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/add', undefined, { cache: false });
  });
});

describe('SessionClient onUnauthenticated', () => {
  it('fires when an applied state has zero accounts (device signout-all)', () => {
    const onUnauthenticated = jest.fn();
    const c = new TestClient(makeHost(jest.fn()), { onUnauthenticated });

    c.apply(stateWith(1, 'a1', ['a1']));
    expect(onUnauthenticated).not.toHaveBeenCalled();

    c.apply(stateWith(2, null, []));
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a stale (non-applied) empty state', () => {
    const onUnauthenticated = jest.fn();
    const c = new TestClient(makeHost(jest.fn()), { onUnauthenticated });

    c.apply(stateWith(5, 'a1', ['a1']));
    // revision 4 <= 5 → rejected, so onUnauthenticated must NOT fire.
    c.apply(stateWith(4, null, []));
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
