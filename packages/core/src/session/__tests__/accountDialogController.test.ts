import type { DeviceSessionState } from '@oxyhq/contracts';
import type { OxyServices } from '../../OxyServices';
import type { User } from '../../models/interfaces';
import type { SessionLoginResponse, MinimalUserData } from '../../models/session';
import type { AccountNode } from '../../mixins/OxyServices.accounts';
import { SessionClient, type SessionClientHost } from '../SessionClient';
import type { MinimalSocket, SocketIOFactory } from '../socketLoader';
import { logger } from '../../logger';
import {
  AccountDialogController,
  createAccountDialogController,
} from '../accountDialogController';

// A SessionClient whose applied state can be driven directly (applyState is
// protected on the base) — mirrors the existing TestClient pattern.
class TestSessionClient extends SessionClient {
  set(state: DeviceSessionState): void {
    this.applyState(state);
  }
}

function host(): SessionClientHost {
  return {
    makeRequest: jest.fn(),
    getBaseURL: () => 'http://test.invalid',
    getAccessToken: () => 'token',
    getDeviceCredential: () => null,
    onTokensChanged: () => () => undefined,
    setTokens: jest.fn(),
    getCurrentAccountId: () => null,
  };
}

function state(
  accounts: Array<{ accountId: string; sessionId: string }>,
  activeAccountId: string | null,
  revision = 1,
): DeviceSessionState {
  return {
    deviceId: 'device-1',
    accounts: accounts.map((a) => ({ accountId: a.accountId, sessionId: a.sessionId, authuser: 0 })),
    activeAccountId,
    revision,
    updatedAt: 1_720_000_000_000,
  };
}

function user(id: string, over: Partial<User> = {}): User {
  return {
    id,
    publicKey: `pk_${id}`,
    username: `user_${id}`,
    name: { displayName: `User ${id}` },
    ...over,
  } as User;
}

function graphNode(id: string, over: Partial<AccountNode> = {}): AccountNode {
  return {
    accountId: id,
    kind: 'organization',
    parentAccountId: null,
    account: user(id),
    relationship: 'owner',
    callerMembership: null,
    ...over,
  };
}

interface OxyMock {
  getAccessToken: jest.Mock;
  getBaseURL: jest.Mock;
  onTokensChanged: jest.Mock;
  listAccounts: jest.Mock;
  getUsersByIds: jest.Mock;
  getFileDownloadUrl: jest.Mock;
  switchToAccount: jest.Mock;
  startCommonsSignIn: jest.Mock;
  pollCommonsSignIn: jest.Mock;
  claimSessionByToken: jest.Mock;
  signInWithSharedIdentity: jest.Mock;
  /**
   * Test helper: set the current access token and fire every registered
   * `onTokensChanged` listener (mirrors `OxyServices.setTokens`/`clearTokens`).
   * With no listener yet registered (before `start()`), it just sets the token.
   */
  emitTokenChange: (token: string | null) => void;
}

function makeOxy(): OxyMock {
  const tokenListeners = new Set<(token: string | null) => void>();
  // Authenticated by default (mirrors a warm start with a planted bearer).
  let currentToken: string | null = 'access-token';
  return {
    getAccessToken: jest.fn(() => currentToken),
    getBaseURL: jest.fn(() => 'http://test.invalid'),
    onTokensChanged: jest.fn((listener: (token: string | null) => void) => {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    }),
    listAccounts: jest.fn().mockResolvedValue([]),
    getUsersByIds: jest.fn().mockResolvedValue([]),
    getFileDownloadUrl: jest.fn((id: string) => `https://cdn/${id}`),
    switchToAccount: jest.fn(),
    startCommonsSignIn: jest.fn(),
    pollCommonsSignIn: jest.fn(),
    claimSessionByToken: jest.fn(),
    signInWithSharedIdentity: jest.fn().mockResolvedValue(null),
    emitTokenChange: (token: string | null) => {
      currentToken = token;
      for (const listener of tokenListeners) {
        listener(token);
      }
    },
  };
}

/** Flush pending microtasks (a `start()`-triggered `refresh()` cannot be awaited directly). */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  controller: AccountDialogController;
  oxy: OxyMock;
  sc: TestSessionClient;
  commitSession: jest.Mock;
  onSignedIn: jest.Mock;
}

function makeHarness(over: Partial<{ clientId: string | null }> = {}): Harness {
  const oxy = makeOxy();
  const sc = new TestSessionClient(host());
  const commitSession = jest.fn().mockResolvedValue(undefined);
  const onSignedIn = jest.fn();
  const controller = createAccountDialogController({
    oxyServices: oxy as unknown as OxyServices,
    sessionClient: sc,
    clientId: 'clientId' in over ? over.clientId : 'oxy_dk_test',
    commitSession,
    onSignedIn,
    pollIntervalMs: 1000,
  });
  return { controller, oxy, sc, commitSession, onSignedIn };
}

describe('AccountDialogController — initial + views', () => {
  it('starts on the accounts view with an empty list and idle sign-in', () => {
    const { controller } = makeHarness();
    const snap = controller.getSnapshot();
    expect(snap.view).toBe('accounts');
    expect(snap.accounts).toEqual([]);
    expect(snap.activeAccountId).toBeNull();
    expect(snap.loading).toBe(false);
    expect(snap.switchingAccountId).toBeNull();
    expect(snap.signIn.phase).toBe('idle');
    expect(snap.commonsAvailability).toBe('unknown');
  });

  it('setView / add / close move between views and notify subscribers', () => {
    const { controller } = makeHarness();
    const seen: string[] = [];
    controller.subscribe((s) => seen.push(s.view));

    controller.add();
    expect(controller.getSnapshot().view).toBe('add');
    controller.setView('signin');
    expect(controller.getSnapshot().view).toBe('signin');
    controller.close();
    expect(controller.getSnapshot().view).toBe('accounts');

    expect(seen).toEqual(['add', 'signin', 'accounts']);
  });

  it('startSignup moves to the signup view and notifies subscribers', () => {
    const { controller } = makeHarness();
    const seen: string[] = [];
    controller.subscribe((s) => seen.push(s.view));

    controller.startSignup();
    expect(controller.getSnapshot().view).toBe('signup');
    controller.close();
    expect(controller.getSnapshot().view).toBe('accounts');

    expect(seen).toEqual(['signup', 'accounts']);
  });

  it('getSnapshot returns a stable reference until a change occurs', () => {
    const { controller } = makeHarness();
    const a = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(a);
    controller.setView('add');
    expect(controller.getSnapshot()).not.toBe(a);
  });
});

describe('AccountDialogController — account list', () => {
  it('refresh loads graph + profiles and projects the unified list', async () => {
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.getUsersByIds.mockResolvedValue([user('a1'), user('org1')]);
    oxy.listAccounts.mockResolvedValue([graphNode('org1')]);

    await controller.refresh();

    const snap = controller.getSnapshot();
    expect(oxy.getUsersByIds).toHaveBeenCalledWith(['a1', 'org1']);
    expect(snap.accounts.map((r) => r.accountId)).toEqual(['a1', 'org1']);
    expect(snap.activeAccountId).toBe('a1');
    expect(snap.accounts[0].isCurrent).toBe(true);
    expect(snap.accounts[1].onDevice).toBe(false);
    expect(snap.loading).toBe(false);
  });

  it('start subscribes to SessionClient so a device-state change re-projects', async () => {
    const { controller, oxy, sc } = makeHarness();
    oxy.getUsersByIds.mockResolvedValue([user('a1')]);
    controller.start();
    await Promise.resolve();
    await Promise.resolve();

    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    // The subscription re-projects synchronously from the new device state.
    expect(controller.getSnapshot().activeAccountId).toBe('a1');
    controller.destroy();
  });

  it('keeps device rows and surfaces the error when listAccounts fails', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.getUsersByIds.mockResolvedValue([user('a1')]);
    oxy.listAccounts.mockRejectedValue(new Error('graph boom'));

    await controller.refresh();

    const snap = controller.getSnapshot();
    expect(snap.error).toBe('graph boom');
    expect(snap.accounts.map((r) => r.accountId)).toEqual(['a1']);
    // A genuine (non-401) failure STILL warns.
    expect(warnSpy).toHaveBeenCalledWith(
      '[AccountDialogController] listAccounts failed',
      { component: 'AccountDialogController' },
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('treats a 401 from listAccounts as the signed-out edge — debug, no surfaced error, no warn', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.getUsersByIds.mockResolvedValue([user('a1')]);
    // A stale/revoked bearer 401s: an EXPECTED signed-out outcome, not a failure.
    oxy.listAccounts.mockRejectedValue(
      Object.assign(new Error('Invalid or missing authorization header'), { status: 401 }),
    );

    await controller.refresh();

    const snap = controller.getSnapshot();
    // Never surface an error for a normal signed-out state; device rows still render.
    expect(snap.error).toBeNull();
    expect(snap.accounts.map((r) => r.accountId)).toEqual(['a1']);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      '[AccountDialogController] listAccounts unauthorized (signed out)',
      { component: 'AccountDialogController' },
      expect.objectContaining({ status: 401 }),
    );
    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });
});

describe('AccountDialogController — auth-gated graph fetch (prod sign-out fix)', () => {
  it('start() while signed out does NOT call the private listAccounts / getUsersByIds and does not error', async () => {
    const { controller, oxy, sc } = makeHarness();
    oxy.emitTokenChange(null); // cold boot: no bearer planted yet (no listeners registered pre-start)
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));

    controller.start();
    await flush();

    expect(oxy.listAccounts).not.toHaveBeenCalled();
    expect(oxy.getUsersByIds).not.toHaveBeenCalled();
    const snap = controller.getSnapshot();
    expect(snap.error).toBeNull();
    expect(snap.loading).toBe(false);
    controller.destroy();
  });

  it('refresh() while signed out re-projects device-only and skips the network call', async () => {
    const { controller, oxy } = makeHarness();
    oxy.emitTokenChange(null);

    await controller.refresh();

    expect(oxy.listAccounts).not.toHaveBeenCalled();
    const snap = controller.getSnapshot();
    expect(snap.loading).toBe(false);
    expect(snap.error).toBeNull();
  });

  it('start() while authenticated fetches the graph exactly once', async () => {
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.listAccounts.mockResolvedValue([graphNode('org1')]);
    oxy.getUsersByIds.mockResolvedValue([user('a1'), user('org1')]);

    controller.start();
    await flush();

    expect(oxy.listAccounts).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().accounts.map((r) => r.accountId)).toEqual(['a1', 'org1']);
    controller.destroy();
  });

  it('fetches the graph once when the bearer is planted after a signed-out start', async () => {
    const { controller, oxy } = makeHarness();
    oxy.emitTokenChange(null);
    controller.start();
    await flush();
    expect(oxy.listAccounts).not.toHaveBeenCalled();

    // Cold-boot restore plants the token → onTokensChanged → single graph fetch.
    oxy.emitTokenChange('access-token');
    await flush();
    expect(oxy.listAccounts).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it('drops the graph and re-projects device-only (no fetch) when the token is cleared', async () => {
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.listAccounts.mockResolvedValue([graphNode('org1')]);
    oxy.getUsersByIds.mockResolvedValue([user('a1'), user('org1')]);
    controller.start();
    await flush();
    expect(controller.getSnapshot().accounts.map((r) => r.accountId)).toEqual(['a1', 'org1']);

    oxy.listAccounts.mockClear();
    oxy.emitTokenChange(null); // a 401 cleared the bearer
    await flush();

    expect(oxy.listAccounts).not.toHaveBeenCalled();
    // Graph-only org1 is gone; the device row survives.
    expect(controller.getSnapshot().accounts.map((r) => r.accountId)).toEqual(['a1']);
    controller.destroy();
  });

  it('does not loop when listAccounts rejects — at most one call per refresh, no re-trigger on device changes', async () => {
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.getUsersByIds.mockResolvedValue([user('a1')]);
    oxy.listAccounts.mockRejectedValue(new Error('graph boom'));

    controller.start();
    await flush();
    expect(oxy.listAccounts).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().error).toBe('graph boom');

    // A subsequent device-state push must NOT re-trigger the graph fetch (auth
    // edge unchanged → reconcileAuth is a no-op → no storm).
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1', 2));
    await flush();
    expect(oxy.listAccounts).toHaveBeenCalledTimes(1);
    // Device row still rendered despite the graph failure.
    expect(controller.getSnapshot().accounts.map((r) => r.accountId)).toEqual(['a1']);
    controller.destroy();
  });
});

describe('AccountDialogController — switchTo (uniform switch)', () => {
  it('uses SessionClient.switchAccount for an account already on the device', async () => {
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }, { accountId: 'a2', sessionId: 's2' }], 'a1'));
    const switchSpy = jest.spyOn(sc, 'switchAccount').mockResolvedValue(undefined);
    oxy.getUsersByIds.mockResolvedValue([user('a1'), user('a2')]);

    await controller.switchTo('a2');

    expect(switchSpy).toHaveBeenCalledWith('a2');
    expect(oxy.switchToAccount).not.toHaveBeenCalled();
    expect(controller.getSnapshot().switchingAccountId).toBeNull();
  });

  it('mints via oxyServices.switchToAccount + commitSession on first entry into a graph account', async () => {
    const { controller, oxy, sc, commitSession } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    const switchSpy = jest.spyOn(sc, 'switchAccount').mockResolvedValue(undefined);
    oxy.switchToAccount.mockResolvedValue({
      sessionId: 'sess-org',
      deviceId: 'device-1',
      expiresAt: '2030-01-01T00:00:00Z',
      accessToken: 'access-org',
      user: user('org1'),
    });
    oxy.getUsersByIds.mockResolvedValue([user('a1'), user('org1')]);

    await controller.switchTo('org1');

    expect(oxy.switchToAccount).toHaveBeenCalledWith('org1');
    expect(switchSpy).not.toHaveBeenCalled();
    expect(commitSession).toHaveBeenCalledTimes(1);
    expect(commitSession.mock.calls[0][0]).toMatchObject({ sessionId: 'sess-org', accessToken: 'access-org' });
  });

  it('commits a graph switch via the IN-PLACE commitSwitchedSession — never the hub-syncing commitSession', async () => {
    // PROBLEM 2: an account switch must not run the cross-origin hub-sync
    // full-page redirect. When both funnels are wired, the mint-switch must use
    // commitSwitchedSession (in-place) and NEVER commitSession (which may
    // redirect on an official web origin).
    const oxy = makeOxy();
    const sc = new TestSessionClient(host());
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    jest.spyOn(sc, 'switchAccount').mockResolvedValue(undefined);
    oxy.switchToAccount.mockResolvedValue({
      sessionId: 'sess-org',
      deviceId: 'device-1',
      expiresAt: '2030-01-01T00:00:00Z',
      accessToken: 'access-org',
      user: user('org1'),
    });
    const commitSession = jest.fn().mockResolvedValue(undefined);
    const commitSwitchedSession = jest.fn().mockResolvedValue(undefined);
    const controller = new AccountDialogController({
      oxyServices: oxy as unknown as OxyServices,
      sessionClient: sc,
      clientId: 'oxy_dk_test',
      commitSession,
      commitSwitchedSession,
    });

    await controller.switchTo('org1');

    expect(commitSwitchedSession).toHaveBeenCalledTimes(1);
    expect(commitSwitchedSession.mock.calls[0][0]).toMatchObject({ sessionId: 'sess-org', accessToken: 'access-org' });
    expect(commitSession).not.toHaveBeenCalled();
  });

  it('surfaces a failed switch as snapshot.error instead of silently no-op\'ing', async () => {
    // PROBLEM 1: switching into an account the server refuses (e.g. a 403 for a
    // personal-kind target) must tell the user why — the error is recorded on
    // the snapshot, the switch does not throw, and switchingAccountId resets.
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    oxy.switchToAccount.mockRejectedValue(new Error('Cannot switch into a personal account'));

    await expect(controller.switchTo('org1')).resolves.toBeUndefined();

    const snap = controller.getSnapshot();
    expect(snap.error).toBe('Cannot switch into a personal account');
    expect(snap.switchingAccountId).toBeNull();
  });

  it('falls back to SessionClient.registerAndActivate when no commitSession is supplied', async () => {
    const oxy = makeOxy();
    const sc = new TestSessionClient(host());
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    const registerSpy = jest.spyOn(sc, 'registerAndActivate').mockResolvedValue(undefined);
    oxy.switchToAccount.mockResolvedValue({
      sessionId: 'sess-org',
      deviceId: 'device-1',
      expiresAt: '2030-01-01T00:00:00Z',
      accessToken: 'access-org',
      user: user('org1'),
    });
    const controller = new AccountDialogController({
      oxyServices: oxy as unknown as OxyServices,
      sessionClient: sc,
      clientId: 'oxy_dk_test',
    });

    await controller.switchTo('org1');
    expect(registerSpy).toHaveBeenCalledWith('org1');
  });

  it('ignores a concurrent switch while one is in flight', async () => {
    const { controller, oxy, sc } = makeHarness();
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }, { accountId: 'a2', sessionId: 's2' }], 'a1'));
    let release: () => void = () => undefined;
    jest.spyOn(sc, 'switchAccount').mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    const first = controller.switchTo('a2');
    expect(controller.getSnapshot().switchingAccountId).toBe('a2');
    await controller.switchTo('a1'); // ignored — a switch is in flight
    expect(sc.switchAccount).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});

describe('AccountDialogController — sign in with Oxy', () => {
  it('completes silently when a shared identity mints a session', async () => {
    const { controller, oxy, commitSession, onSignedIn } = makeHarness();
    const session: SessionLoginResponse = {
      sessionId: 'sess-shared',
      deviceId: 'device-1',
      expiresAt: '2030-01-01T00:00:00Z',
      accessToken: 'access-shared',
      user: { id: 'a1', username: 'user_a1', name: { displayName: 'User a1' } },
    };
    oxy.signInWithSharedIdentity.mockResolvedValue(session);

    await controller.signInWithOxy();

    expect(commitSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-shared' }));
    expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(controller.getSnapshot().view).toBe('accounts');
    expect(controller.getSnapshot().signIn.phase).toBe('idle');
    expect(oxy.startCommonsSignIn).not.toHaveBeenCalled();
  });

  it('falls through to the QR handoff when no shared identity is present', async () => {
    const { controller, oxy } = makeHarness();
    oxy.signInWithSharedIdentity.mockResolvedValue(null);
    oxy.startCommonsSignIn.mockResolvedValue({
      sessionToken: 'secret-tok',
      authorizeCode: 'AUTH-CODE',
      qrPayload: 'oxycommons://approve?v=1&code=AUTH-CODE',
      expiresAt: Date.now() + 300_000,
      status: 'pending',
    });

    await controller.signInWithOxy();

    expect(oxy.startCommonsSignIn).toHaveBeenCalledWith({ clientId: 'oxy_dk_test' });
    const snap = controller.getSnapshot();
    expect(snap.view).toBe('qr');
    expect(snap.signIn.phase).toBe('waiting');
    expect(snap.signIn.authorizeCode).toBe('AUTH-CODE');
    expect(snap.signIn.qrPayload).toBe('oxycommons://approve?v=1&code=AUTH-CODE');
    controller.cancelSignIn();
  });

  it('errors when showQr is called without a clientId', async () => {
    const { controller } = makeHarness({ clientId: null });
    await controller.showQr();
    const snap = controller.getSnapshot();
    expect(snap.signIn.phase).toBe('error');
    expect(snap.signIn.error).toMatch(/clientId/);
  });

  it('polls, claims, and commits when the QR flow is authorized', async () => {
    jest.useFakeTimers();
    try {
      const { controller, oxy, commitSession, onSignedIn } = makeHarness();
      oxy.startCommonsSignIn.mockResolvedValue({
        sessionToken: 'secret-tok',
        authorizeCode: 'AUTH-CODE',
        qrPayload: 'oxycommons://approve?v=1&code=AUTH-CODE',
        expiresAt: Date.now() + 600_000,
        status: 'pending',
      });
      oxy.pollCommonsSignIn
        .mockResolvedValueOnce({ authorized: false, status: 'pending' })
        .mockResolvedValueOnce({ authorized: true, sessionId: 'sess-1', status: 'authorized' });
      oxy.claimSessionByToken.mockResolvedValue({
        accessToken: 'access-1',
        sessionId: 'sess-1',
        deviceId: 'device-1',
        deviceSecret: 'claimed-secret',
        expiresAt: '2030-01-01T00:00:00Z',
        user: user('a1'),
      });

      await controller.showQr();
      expect(controller.getSnapshot().signIn.phase).toBe('waiting');

      await jest.advanceTimersByTimeAsync(1000); // first poll → pending
      expect(oxy.pollCommonsSignIn).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000); // second poll → authorized → claim
      expect(oxy.claimSessionByToken).toHaveBeenCalledWith('secret-tok');
      expect(commitSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          accessToken: 'access-1',
          deviceSecret: 'claimed-secret',
        }),
      );
      expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
      expect(controller.getSnapshot().view).toBe('accounts');
    } finally {
      jest.useRealTimers();
    }
  });

  it('surfaces a denied QR authorization as an error and stops polling', async () => {
    jest.useFakeTimers();
    try {
      const { controller, oxy } = makeHarness();
      oxy.startCommonsSignIn.mockResolvedValue({
        sessionToken: 'secret-tok',
        authorizeCode: 'AUTH-CODE',
        qrPayload: 'oxycommons://approve',
        expiresAt: Date.now() + 600_000,
        status: 'pending',
      });
      oxy.pollCommonsSignIn.mockResolvedValue({ authorized: false, status: 'cancelled' });

      await controller.showQr();
      await jest.advanceTimersByTimeAsync(1000);

      expect(controller.getSnapshot().signIn.phase).toBe('error');
      expect(controller.getSnapshot().signIn.error).toMatch(/denied/i);

      // No further polls after the terminal error.
      await jest.advanceTimersByTimeAsync(5000);
      expect(oxy.pollCommonsSignIn).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancelSignIn stops the poll and resets to idle', async () => {
    jest.useFakeTimers();
    try {
      const { controller, oxy } = makeHarness();
      oxy.startCommonsSignIn.mockResolvedValue({
        sessionToken: 'secret-tok',
        authorizeCode: 'AUTH-CODE',
        qrPayload: 'oxycommons://approve',
        expiresAt: Date.now() + 600_000,
        status: 'pending',
      });
      oxy.pollCommonsSignIn.mockResolvedValue({ authorized: false, status: 'pending' });

      await controller.showQr();
      controller.cancelSignIn();
      expect(controller.getSnapshot().signIn.phase).toBe('idle');

      await jest.advanceTimersByTimeAsync(5000);
      expect(oxy.pollCommonsSignIn).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AccountDialogController — Commons availability (canOpenApp)', () => {
  const START_HANDLE = {
    sessionToken: 'secret-tok',
    authorizeCode: 'AUTH-CODE',
    qrPayload: 'oxycommons://approve?v=1&code=AUTH-CODE',
    expiresAt: Date.now() + 600_000,
    status: 'pending' as const,
  };

  function makeController(opts: {
    openUrl?: jest.Mock;
    canOpenApp?: jest.Mock;
  }): { controller: AccountDialogController; oxy: OxyMock } {
    const oxy = makeOxy();
    oxy.startCommonsSignIn.mockResolvedValue(START_HANDLE);
    oxy.pollCommonsSignIn.mockResolvedValue({ authorized: false, status: 'pending' });
    const controller = new AccountDialogController({
      oxyServices: oxy as unknown as OxyServices,
      sessionClient: new TestSessionClient(host()),
      clientId: 'oxy_dk_test',
      pollIntervalMs: 1000,
      openUrl: opts.openUrl,
      canOpenApp: opts.canOpenApp,
    });
    return { controller, oxy };
  }

  it('deep-links into Commons via openUrl when canOpenApp reports it installed, keeping the QR/polling fallback', async () => {
    const openUrl = jest.fn();
    const canOpenApp = jest.fn().mockResolvedValue(true);
    const { controller } = makeController({ openUrl, canOpenApp });

    await controller.showQr();
    await flush(); // let the (non-awaited) canOpenApp probe resolve

    expect(canOpenApp).toHaveBeenCalledWith('oxycommons://');
    expect(openUrl).toHaveBeenCalledWith('oxycommons://approve?v=1&code=AUTH-CODE');
    // The QR + polling remain the fallback path — the flow is still waiting.
    const snap = controller.getSnapshot();
    expect(snap.view).toBe('qr');
    expect(snap.signIn.phase).toBe('waiting');
    expect(snap.signIn.qrPayload).toBe('oxycommons://approve?v=1&code=AUTH-CODE');
    expect(snap.commonsAvailability).toBe('available');
    controller.cancelSignIn();
  });

  it('does NOT open Commons when canOpenApp reports it absent (renders QR only)', async () => {
    const openUrl = jest.fn();
    const canOpenApp = jest.fn().mockResolvedValue(false);
    const { controller } = makeController({ openUrl, canOpenApp });

    await controller.showQr();
    await flush();

    expect(canOpenApp).toHaveBeenCalledWith('oxycommons://');
    expect(openUrl).not.toHaveBeenCalled();
    expect(controller.getSnapshot().signIn.phase).toBe('waiting');
    expect(controller.getSnapshot().commonsAvailability).toBe('unavailable');
    controller.cancelSignIn();
  });

  it('never probes or opens when canOpenApp is absent (web — unchanged behavior)', async () => {
    const openUrl = jest.fn();
    const { controller } = makeController({ openUrl });

    await controller.showQr();
    await flush();

    expect(openUrl).not.toHaveBeenCalled();
    expect(controller.getSnapshot().signIn.qrPayload).toBe('oxycommons://approve?v=1&code=AUTH-CODE');
    expect(controller.getSnapshot().commonsAvailability).toBe('unknown');
    controller.cancelSignIn();
  });

  it('swallows a canOpenApp probe rejection, keeps the QR fallback, and records unavailable', async () => {
    const openUrl = jest.fn();
    const canOpenApp = jest.fn().mockRejectedValue(new Error('probe boom'));
    const { controller } = makeController({ openUrl, canOpenApp });

    await controller.showQr();
    await flush();

    expect(openUrl).not.toHaveBeenCalled();
    expect(controller.getSnapshot().signIn.phase).toBe('waiting');
    expect(controller.getSnapshot().commonsAvailability).toBe('unavailable');
    controller.cancelSignIn();
  });

  it('start() eagerly resolves commonsAvailability without requiring a QR flow', async () => {
    const canOpenApp = jest.fn().mockResolvedValue(true);
    const { controller } = makeController({ canOpenApp });

    controller.start();
    await flush();

    expect(canOpenApp).toHaveBeenCalledWith('oxycommons://');
    expect(controller.getSnapshot().commonsAvailability).toBe('available');
  });
});

describe('AccountDialogController — /auth-session socket (instant QR wake)', () => {
  type Handler = (...args: unknown[]) => void;
  class FakeAuthSocket implements MinimalSocket {
    connected = false;
    disconnected = false;
    handlers = new Map<string, Handler[]>();
    emitted: Array<{ event: string; args: unknown[] }> = [];
    on(event: string, cb: Handler) { const l = this.handlers.get(event) ?? []; l.push(cb); this.handlers.set(event, l); }
    off(event: string, cb?: Handler) { if (!cb) { this.handlers.delete(event); return; } this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb)); }
    emit(event: string, ...args: unknown[]) { this.emitted.push({ event, args }); }
    connect() { this.connected = true; }
    disconnect() { this.connected = false; this.disconnected = true; }
    /** Simulate a server→client push on this socket. */
    server(event: string, payload?: unknown) { for (const h of this.handlers.get(event) ?? []) h(payload); }
  }

  const START_HANDLE = {
    sessionToken: 'secret-tok',
    authorizeCode: 'AUTH-CODE',
    qrPayload: 'oxycommons://approve?v=1&code=AUTH-CODE',
    expiresAt: Date.now() + 600_000,
    status: 'pending' as const,
  };

  function makeSocketHarness(): { controller: AccountDialogController; oxy: OxyMock; created: () => FakeAuthSocket | null; factory: jest.Mock; commitSession: jest.Mock } {
    const oxy = makeOxy();
    oxy.startCommonsSignIn.mockResolvedValue(START_HANDLE);
    let socket: FakeAuthSocket | null = null;
    const factory = jest.fn((_uri: string, _opts?: Record<string, unknown>): MinimalSocket => {
      socket = new FakeAuthSocket();
      socket.connected = true; // real io autoConnect resolves before we inspect
      return socket;
    });
    const commitSession = jest.fn().mockResolvedValue(undefined);
    const controller = new AccountDialogController({
      oxyServices: oxy as unknown as OxyServices,
      sessionClient: new TestSessionClient(host()),
      clientId: 'oxy_dk_test',
      commitSession,
      socketFactory: factory as unknown as SocketIOFactory,
    });
    return { controller, oxy, created: () => socket, factory, commitSession };
  }

  it('connects to /auth-session, joins the flow room, and wakes the claim on auth_update — no timer advance', async () => {
    const { controller, oxy, created, factory, commitSession } = makeSocketHarness();
    oxy.pollCommonsSignIn.mockResolvedValue({ authorized: true, sessionId: 'sess-1', status: 'authorized' });
    oxy.claimSessionByToken.mockResolvedValue({
      accessToken: 'access-1', sessionId: 'sess-1', deviceId: 'device-1', expiresAt: '2030-01-01T00:00:00Z', user: user('a1'),
    });

    await controller.showQr();

    expect(factory).toHaveBeenCalledWith('http://test.invalid/auth-session', expect.any(Object));
    const sock = created();
    if (!sock) throw new Error('socket not created');
    expect(sock.emitted).toContainEqual({ event: 'join', args: ['secret-tok'] });

    // The server pushes auth_update → immediate status check + claim, without any poll timer firing.
    sock.server('auth_update', { status: 'authorized', sessionId: 'sess-1' });
    await flush();

    expect(oxy.pollCommonsSignIn).toHaveBeenCalledWith('secret-tok');
    expect(oxy.claimSessionByToken).toHaveBeenCalledWith('secret-tok');
    expect(commitSession).toHaveBeenCalled();
    expect(controller.getSnapshot().view).toBe('accounts');
    expect(sock.disconnected).toBe(true); // torn down on completion
  });

  it('re-joins the room on reconnect (connect event) and tears the socket down on cancelSignIn', async () => {
    const { controller, oxy, created } = makeSocketHarness();
    oxy.pollCommonsSignIn.mockResolvedValue({ authorized: false, status: 'pending' });

    await controller.showQr();
    const sock = created();
    if (!sock) throw new Error('socket not created');
    expect(sock.emitted.filter((e) => e.event === 'join')).toHaveLength(1);

    // A reconnect fires `connect` again → the join is re-issued so it survives drops.
    sock.server('connect');
    expect(sock.emitted.filter((e) => e.event === 'join')).toHaveLength(2);

    controller.cancelSignIn();
    expect(sock.disconnected).toBe(true);
  });

  it('a stale auth_update after the flow was cancelled does not re-poll', async () => {
    const { controller, oxy, created } = makeSocketHarness();
    oxy.pollCommonsSignIn.mockResolvedValue({ authorized: false, status: 'pending' });

    await controller.showQr();
    const sock = created();
    if (!sock) throw new Error('socket not created');
    oxy.pollCommonsSignIn.mockClear();

    controller.cancelSignIn();
    // Even if a late auth_update slips through on the (now-detached) socket, the
    // superseded-token guard drops it.
    sock.server('auth_update', { status: 'authorized' });
    await flush();
    expect(oxy.pollCommonsSignIn).not.toHaveBeenCalled();
  });
});

describe('AccountDialogController — lifecycle', () => {
  it('destroy unsubscribes so later device-state changes do not notify', async () => {
    const { controller, oxy, sc } = makeHarness();
    oxy.getUsersByIds.mockResolvedValue([user('a1')]);
    controller.start();
    await Promise.resolve();
    const seen: string[] = [];
    controller.subscribe((s) => seen.push(s.view));
    controller.destroy();
    // destroy clears all listeners; a subsequent state push notifies nobody.
    sc.set(state([{ accountId: 'a1', sessionId: 's1' }], 'a1'));
    expect(seen).toEqual([]);
  });
});

it('createAccountDialogController returns an AccountDialogController instance', () => {
  const { controller } = makeHarness();
  expect(controller).toBeInstanceOf(AccountDialogController);
});

// Ensure the exported type surface is reachable at compile time for binders.
const _typecheck: MinimalUserData | null = null;
void _typecheck;
