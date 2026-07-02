const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockDeactivate = jest.fn();
const mockGetAccessToken = jest.fn();
const mockValidateSessionById = jest.fn();

jest.mock('../../models/DeviceSession', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
    updateOne: (...a: unknown[]) => mockUpdateOne(...a),
  },
}));
jest.mock('../session.service', () => ({
  __esModule: true,
  default: {
    deactivateSession: (...a: unknown[]) => mockDeactivate(...a),
    getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a),
    validateSessionById: (...a: unknown[]) => mockValidateSessionById(...a),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import deviceSessionService, { projectState } from '../deviceSession.service';

const lean = (v: unknown) => ({ lean: () => Promise.resolve(v) });

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateSessionById.mockResolvedValue({ session: {} });
});

describe('projectState', () => {
  it('maps a doc to DeviceSessionState with string ids', () => {
    const doc = {
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
      updatedAt: new Date(1720000000000),
    };
    expect(projectState(doc as never)).toEqual({
      deviceId: 'd1',
      accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }],
      activeAccountId: 'a1',
      revision: 2,
      updatedAt: 1720000000000,
    });
  });
});

describe('addAccount', () => {
  it('adds a new account at authuser 0, sets it active, bumps revision (changed)', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const { state, changed } = await deviceSessionService.addAccount('d1', { accountId: 'a1', sessionId: 's1' });
    expect(changed).toBe(true);
    expect(state.activeAccountId).toBe('a1');
    expect(state.accounts[0].authuser).toBe(0);
    expect(state.revision).toBe(1);
  });

  it('persists operatedByUserId onto the stored account and projected state', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'org1' }, sessionId: 's-org', authuser: 0, operatedByUserId: { toString: () => 'op1' } }],
      activeAccountId: { toString: () => 'org1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const { state, changed } = await deviceSessionService.addAccount('d1', { accountId: 'org1', sessionId: 's-org', operatedByUserId: 'op1' });
    expect(changed).toBe(true);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { deviceId: 'd1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          accounts: expect.arrayContaining([expect.objectContaining({ accountId: 'org1', sessionId: 's-org', operatedByUserId: 'op1' })]),
        }),
      }),
      expect.anything(),
    );
    expect(state.accounts[0].operatedByUserId).toBe('op1');
  });

  it('re-adding the same account with a DIFFERENT sessionId replaces the session, sets active, bumps revision, deactivates the displaced session (changed)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'a1' }, sessionId: 's-old', authuser: 0, operatedByUserId: null },
        { accountId: { toString: () => 'b1' }, sessionId: 's-b', authuser: 1, operatedByUserId: null },
      ],
      activeAccountId: { toString: () => 'b1' },
      revision: 5,
    }));
    mockDeactivate.mockResolvedValueOnce(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'b1' }, sessionId: 's-b', authuser: 1, operatedByUserId: null },
        { accountId: { toString: () => 'a1' }, sessionId: 's-new', authuser: 0, operatedByUserId: null },
      ],
      activeAccountId: { toString: () => 'a1' },
      revision: 6,
      updatedAt: new Date(1720000000000),
    }));
    const { state, changed } = await deviceSessionService.addAccount('d1', { accountId: 'a1', sessionId: 's-new' });
    expect(mockDeactivate).toHaveBeenCalledWith('s-old');
    expect(changed).toBe(true);
    expect(state.activeAccountId).toBe('a1');
    expect(state.revision).toBe(6);
  });

  it('idempotent re-register: re-adding the same account with the SAME sessionId is a pure no-op (no deactivate, no write, no revision bump, changed=false)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const { state, changed } = await deviceSessionService.addAccount('d1', { accountId: 'a1', sessionId: 's1' });
    expect(changed).toBe(false);
    expect(mockDeactivate).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(state.activeAccountId).toBe('a1');
    expect(state.revision).toBe(1);
  });

  it('REGRESSION: an idempotent re-register of a NON-active account never steals active from the current active account (the reload-handoff bug)', async () => {
    // Device: A (active session s-A) was switched away from — B is now active.
    // The cold-boot handoff re-registers the still-restored A session on reload.
    // A must NOT become active again; the switch to B must survive.
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'A' }, sessionId: 's-A', authuser: 0, operatedByUserId: null },
        { accountId: { toString: () => 'B' }, sessionId: 's-B', authuser: 1, operatedByUserId: null },
      ],
      activeAccountId: { toString: () => 'B' },
      revision: 77,
      updatedAt: new Date(1720000000000),
    }));
    const { state, changed } = await deviceSessionService.addAccount('d1', { accountId: 'A', sessionId: 's-A' });
    expect(changed).toBe(false);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(state.activeAccountId).toBe('B');
    expect(state.revision).toBe(77);
  });
});

describe('signout', () => {
  it('revokes the account session and drops it from the set', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
    }));
    mockDeactivate.mockResolvedValueOnce(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 2, updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.signout('d1', { accountId: 'a1' });
    expect(mockDeactivate).toHaveBeenCalledWith('s1');
    expect(state.accounts).toHaveLength(0);
    expect(state.activeAccountId).toBeNull();
    expect(state.revision).toBe(2);
  });

  it('cascades: signing out the operator also removes accounts it operates, deactivating both sessions, and never elects the operated account as next-active', async () => {
    // Device has the operator's personal account (op1, active) and an org
    // account (org1) the operator switched into (operatedByUserId: op1).
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null },
        { accountId: { toString: () => 'org1' }, sessionId: 's-org', authuser: 1, operatedByUserId: { toString: () => 'op1' } },
      ],
      activeAccountId: { toString: () => 'org1' },
      revision: 3,
    }));
    mockDeactivate.mockResolvedValue(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 4, updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.signout('d1', { accountId: 'op1' });
    expect(mockDeactivate).toHaveBeenCalledWith('s-op');
    expect(mockDeactivate).toHaveBeenCalledWith('s-org');
    expect(mockDeactivate).toHaveBeenCalledTimes(2);
    const [, updatePayload] = mockFindOneAndUpdate.mock.calls[0];
    expect(updatePayload.$set.accounts).toEqual([]);
    // Neither removed account (the just-signed-out operator nor the cascaded
    // org account, which was also the previously-active account) may be
    // elected as the next active account.
    expect(updatePayload.$set.activeAccountId).toBeNull();
    expect(state.accounts).toHaveLength(0);
    expect(state.activeAccountId).toBeNull();
  });

  it('does not cascade beyond one level and leaves unrelated accounts untouched', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null },
        { accountId: { toString: () => 'org1' }, sessionId: 's-org', authuser: 1, operatedByUserId: { toString: () => 'op1' } },
        { accountId: { toString: () => 'other' }, sessionId: 's-other', authuser: 2, operatedByUserId: null },
      ],
      activeAccountId: { toString: () => 'other' },
      revision: 3,
    }));
    mockDeactivate.mockResolvedValue(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'other' }, sessionId: 's-other', authuser: 2, operatedByUserId: null }],
      activeAccountId: { toString: () => 'other' },
      revision: 4,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.signout('d1', { accountId: 'op1' });
    expect(mockDeactivate).toHaveBeenCalledWith('s-op');
    expect(mockDeactivate).toHaveBeenCalledWith('s-org');
    expect(mockDeactivate).not.toHaveBeenCalledWith('s-other');
    expect(state.accounts).toHaveLength(1);
    expect(state.activeAccountId).toBe('other');
  });
});

describe('switchActive', () => {
  it('returns not_found when the account is not on the device', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    expect(await deviceSessionService.switchActive('d1', 'ghost')).toEqual({ ok: false, reason: 'not_found' });
    expect(mockValidateSessionById).not.toHaveBeenCalled();
  });

  it('switches active account and bumps revision when the target session validates', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'other' },
      revision: 1,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
      updatedAt: new Date(1720000000000),
    }));
    const result = await deviceSessionService.switchActive('d1', 'a1');
    expect(mockValidateSessionById).toHaveBeenCalledWith('s1', false);
    expect(result).toEqual({ ok: true, state: expect.objectContaining({ activeAccountId: 'a1', revision: 2 }) });
  });

  it('heals a revoked target: removes the account from the device set and returns the healed state (does NOT commit the switch)', async () => {
    const doc = {
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null },
        { accountId: { toString: () => 'org1' }, sessionId: 's-org', authuser: 1, operatedByUserId: { toString: () => 'op1' } },
      ],
      activeAccountId: { toString: () => 'op1' },
      revision: 1,
    };
    mockFindOne.mockReturnValueOnce(lean(doc)); // switchActive's initial load
    mockValidateSessionById.mockResolvedValueOnce(null); // target session revoked
    mockFindOne.mockReturnValueOnce(lean(doc)); // signout()'s own reload
    mockDeactivate.mockResolvedValueOnce(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'op1' },
      revision: 2,
      updatedAt: new Date(1720000000000),
    }));
    const result = await deviceSessionService.switchActive('d1', 'org1');
    expect(mockValidateSessionById).toHaveBeenCalledWith('s-org', false);
    // The revoked account's session is deactivated and the account dropped from
    // the set; the healed state is returned so the route can broadcast it. The
    // switch itself is NOT committed (activeAccountId stays on op1).
    expect(mockDeactivate).toHaveBeenCalledWith('s-org');
    expect(result).toEqual({
      ok: false,
      reason: 'unauthorized',
      state: expect.objectContaining({
        accounts: [expect.objectContaining({ accountId: 'op1' })],
        activeAccountId: 'op1',
      }),
    });
  });
});

describe('getState self-heals a revoked managed active account', () => {
  it('drops the active managed account when its session fails validateSessionById and re-elects the next remaining account', async () => {
    const doc = {
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null },
        { accountId: { toString: () => 'org1' }, sessionId: 's-org', authuser: 1, operatedByUserId: { toString: () => 'op1' } },
      ],
      activeAccountId: { toString: () => 'org1' },
      revision: 3,
    };
    mockFindOne.mockReturnValueOnce(lean(doc)); // getState's initial load
    mockValidateSessionById.mockResolvedValueOnce(null); // heal check on org1's session fails
    mockFindOne.mockReturnValueOnce(lean(doc)); // signout()'s own reload
    mockDeactivate.mockResolvedValueOnce(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'op1' },
      revision: 4,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.getState('d1');
    expect(mockValidateSessionById).toHaveBeenCalledWith('s-org', false);
    expect(mockDeactivate).toHaveBeenCalledWith('s-org');
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].accountId).toBe('op1');
    expect(state.activeAccountId).toBe('op1');
  });

  it('keeps a managed active account whose session still validates', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'org1' }, sessionId: 's-org', authuser: 0, operatedByUserId: { toString: () => 'op1' } }],
      activeAccountId: { toString: () => 'org1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.getState('d1');
    expect(mockValidateSessionById).toHaveBeenCalledWith('s-org', false);
    expect(mockDeactivate).not.toHaveBeenCalled();
    expect(state.activeAccountId).toBe('org1');
  });

  it('does not touch a personal (non-managed) active account, even without a validateSessionById call', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'op1' }, sessionId: 's-op', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'op1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.getState('d1');
    expect(mockValidateSessionById).not.toHaveBeenCalled();
    expect(mockDeactivate).not.toHaveBeenCalled();
    expect(state.activeAccountId).toBe('op1');
  });
});

describe('resolveActiveToken', () => {
  const STATE = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };
  it('mints the active account token after re-validating the session', async () => {
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'jwt', expiresAt: new Date('2026-07-07T00:00:00.000Z') });
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toEqual({ accessToken: 'jwt', expiresAt: '2026-07-07T00:00:00.000Z' });
    expect(mockValidateSessionById).toHaveBeenCalledWith('s1', false);
    expect(mockGetAccessToken).toHaveBeenCalledWith('s1');
  });
  it('returns null when there is no active account', async () => {
    expect(await deviceSessionService.resolveActiveToken({ ...STATE, activeAccountId: null } as never)).toBeNull();
  });
  it('returns null when the session cannot mint a token', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toBeNull();
  });
  it('returns null without minting a token when validateSessionById rejects the session (e.g. revoked act_as membership)', async () => {
    mockValidateSessionById.mockResolvedValueOnce(null);
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toBeNull();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });
});

describe('detachMigratedAccount', () => {
  it('drops the account entry WITHOUT deactivating the migrated (preserved) session', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'oldDevice',
      accounts: [
        { accountId: { toString: () => 'a1' }, sessionId: 'migrated-sess', authuser: 0 },
        { accountId: { toString: () => 'a2' }, sessionId: 's2', authuser: 1 },
      ],
      activeAccountId: { toString: () => 'a1' },
      revision: 3,
    }));

    await deviceSessionService.detachMigratedAccount('oldDevice', 'a1', 'migrated-sess');

    // The migrated session lives on its new device — never deactivated here.
    expect(mockDeactivate).not.toHaveBeenCalled();
    // The account entry is pulled and active reassigned to the remaining one.
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mockUpdateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { accounts: Array<{ sessionId: string }>; activeAccountId: string | null }; $inc: { revision: number } },
    ];
    expect(filter).toEqual({ deviceId: 'oldDevice' });
    expect(update.$set.accounts.map((a) => a.sessionId)).toEqual(['s2']);
    expect(update.$set.activeAccountId).toBe('a2');
    expect(update.$inc).toEqual({ revision: 1 });
  });

  it('deactivates a DIFFERENT stale session the old doc referenced for that account', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'oldDevice',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 'stale-sess', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
    }));

    await deviceSessionService.detachMigratedAccount('oldDevice', 'a1', 'migrated-sess');

    expect(mockDeactivate).toHaveBeenCalledWith('stale-sess');
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { deviceId: 'oldDevice' },
      { $set: { accounts: [], activeAccountId: null }, $inc: { revision: 1 } },
    );
  });

  it('is a no-op when the device doc is absent', async () => {
    mockFindOne.mockReturnValueOnce(lean(null));
    await deviceSessionService.detachMigratedAccount('oldDevice', 'a1', 'migrated-sess');
    expect(mockDeactivate).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it('is a no-op when the account is not listed on the doc', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'oldDevice',
      accounts: [{ accountId: { toString: () => 'other' }, sessionId: 's-other', authuser: 0 }],
      activeAccountId: { toString: () => 'other' },
      revision: 1,
    }));
    await deviceSessionService.detachMigratedAccount('oldDevice', 'a1', 'migrated-sess');
    expect(mockDeactivate).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});
