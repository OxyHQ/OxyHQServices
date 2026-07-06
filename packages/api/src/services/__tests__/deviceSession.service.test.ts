import * as nodeCrypto from 'crypto';

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockCreate = jest.fn();
const mockDeactivate = jest.fn();
const mockGetAccessToken = jest.fn();
const mockValidateSessionById = jest.fn();

jest.mock('../../models/DeviceSession', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
    updateOne: (...a: unknown[]) => mockUpdateOne(...a),
    create: (...a: unknown[]) => mockCreate(...a),
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
// deviceSession.service now additively imports these; mock them so the module
// graph loads under the global mongoose mock (no real RefreshToken/AuthCode).
const mockRevokeAllFamiliesBySession = jest.fn();
jest.mock('../refreshToken.service', () => ({
  revokeAllFamiliesBySession: (...a: unknown[]) => mockRevokeAllFamiliesBySession(...a),
}));
const mockRevokeDeviceTokens = jest.fn();
jest.mock('../deviceToken.service', () => ({
  revokeDeviceTokens: (...a: unknown[]) => mockRevokeDeviceTokens(...a),
}));
jest.mock('../oauthCode.service', () => {
  const nodeCrypto = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    sha256Hex: (value: string) => nodeCrypto.createHash('sha256').update(value).digest('hex'),
    base64UrlEncode: (buf: Buffer) => buf.toString('base64url'),
    timingSafeStringEqual: (a: string, b: string) => {
      const ab = Buffer.from(a);
      const bb = Buffer.from(b);
      if (ab.length !== bb.length) return false;
      return nodeCrypto.timingSafeEqual(ab, bb);
    },
  };
});

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

describe('resolveRegisteredSession', () => {
  it('reuses the session REGISTERED for the account on the device — validated + freshly-minted token', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'central-device',
      accounts: [
        { accountId: { toString: () => 'other' }, sessionId: 's-other', authuser: 0 },
        { accountId: { toString: () => 'acct-1' }, sessionId: 'registered-sess', authuser: 1 },
      ],
      activeAccountId: { toString: () => 'other' },
      revision: 4,
    }));
    // The registered session validates (managed act_as re-check passes) and
    // reports its own stored deviceId — the central device it was minted on.
    mockValidateSessionById.mockResolvedValueOnce({ session: { deviceId: 'central-device' } });
    const expiresAt = new Date(Date.now() + 60_000);
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'fresh-token', expiresAt });

    const result = await deviceSessionService.resolveRegisteredSession('central-device', 'acct-1');

    expect(result).toEqual({
      sessionId: 'registered-sess',
      deviceId: 'central-device',
      accessToken: 'fresh-token',
      expiresAt,
    });
    // Validated + minted against the REGISTERED session id, not the active one.
    expect(mockValidateSessionById).toHaveBeenCalledWith('registered-sess', false);
    expect(mockGetAccessToken).toHaveBeenCalledWith('registered-sess');
  });

  it('returns null when the device doc is absent (first sign-in on the device)', async () => {
    mockFindOne.mockReturnValueOnce(lean(null));
    const result = await deviceSessionService.resolveRegisteredSession('unknown-device', 'acct-1');
    expect(result).toBeNull();
    expect(mockValidateSessionById).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns null when the account is not registered on the device', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'central-device',
      accounts: [{ accountId: { toString: () => 'other' }, sessionId: 's-other', authuser: 0 }],
      activeAccountId: { toString: () => 'other' },
      revision: 1,
    }));
    const result = await deviceSessionService.resolveRegisteredSession('central-device', 'acct-1');
    expect(result).toBeNull();
    expect(mockValidateSessionById).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns null WITHOUT minting a token when the registered session is no longer valid (never resurrect a dead session)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'central-device',
      accounts: [{ accountId: { toString: () => 'acct-1' }, sessionId: 'dead-sess', authuser: 0 }],
      activeAccountId: { toString: () => 'acct-1' },
      revision: 1,
    }));
    mockValidateSessionById.mockResolvedValueOnce(null);

    const result = await deviceSessionService.resolveRegisteredSession('central-device', 'acct-1');

    expect(result).toBeNull();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it('returns null when the token machinery cannot mint an access token', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'central-device',
      accounts: [{ accountId: { toString: () => 'acct-1' }, sessionId: 'registered-sess', authuser: 0 }],
      activeAccountId: { toString: () => 'acct-1' },
      revision: 1,
    }));
    mockValidateSessionById.mockResolvedValueOnce({ session: { deviceId: 'central-device' } });
    mockGetAccessToken.mockResolvedValueOnce(null);

    const result = await deviceSessionService.resolveRegisteredSession('central-device', 'acct-1');
    expect(result).toBeNull();
  });
});

describe('addAccount — activate option', () => {
  it("'if-empty' does NOT flip the active account when one already exists", async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 3,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: { toString: () => 'a1' }, revision: 4,
    }));

    await deviceSessionService.addAccount('d1', { accountId: 'a2', sessionId: 's2' }, { activate: 'if-empty' });

    const update = mockFindOneAndUpdate.mock.calls[0][1];
    // Active stays a1 — the add-only lane never steals the active selection.
    expect(update.$set.activeAccountId).toBe('a1');
  });

  it("'if-empty' DOES set active when the device has no active account", async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: { toString: () => 'a2' }, revision: 1,
    }));

    await deviceSessionService.addAccount('d1', { accountId: 'a2', sessionId: 's2' }, { activate: 'if-empty' });

    const update = mockFindOneAndUpdate.mock.calls[0][1];
    expect(update.$set.activeAccountId).toBe('a2');
  });

  it("default 'always' sets the new account active (existing callers unchanged)", async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 3,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: { toString: () => 'a2' }, revision: 4,
    }));

    await deviceSessionService.addAccount('d1', { accountId: 'a2', sessionId: 's2' });

    const update = mockFindOneAndUpdate.mock.calls[0][1];
    expect(update.$set.activeAccountId).toBe('a2');
  });
});

describe('signout — refresh family cascade', () => {
  it('revokes ALL refresh families for each signed-out session (single-account: deviceTokens untouched)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 3,
    }));

    await deviceSessionService.signout('d1', { accountId: 'a1' });

    expect(mockDeactivate).toHaveBeenCalledWith('s1');
    expect(mockRevokeAllFamiliesBySession).toHaveBeenCalledWith('s1');
    // Single-account signout must NOT revoke device tokens — other apps/accounts
    // on the same device still legitimately use theirs.
    expect(mockRevokeDeviceTokens).not.toHaveBeenCalled();
  });

  it('signout-ALL revokes device tokens for the device (after the refresh-family revocation)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 },
        { accountId: { toString: () => 'a2' }, sessionId: 's2', authuser: 1 },
      ],
      activeAccountId: { toString: () => 'a1' },
      revision: 4,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 5,
    }));

    await deviceSessionService.signout('d1', { all: true });

    expect(mockRevokeAllFamiliesBySession).toHaveBeenCalledWith('s1');
    expect(mockRevokeAllFamiliesBySession).toHaveBeenCalledWith('s2');
    expect(mockRevokeDeviceTokens).toHaveBeenCalledWith('d1');
  });
});

describe('getStateByCookieKey', () => {
  it('returns the projected state for a known cookie secret', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'dev-cookie',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 5,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.getStateByCookieKey('raw-secret');
    expect(state?.deviceId).toBe('dev-cookie');
    // Looked up by the HASH of the secret, never the raw value.
    const query = mockFindOne.mock.calls[0][0];
    expect(query.cookieKeyHash).toBeDefined();
    expect(query.cookieKeyHash).not.toBe('raw-secret');
  });

  it('returns null for an unknown cookie / empty key', async () => {
    mockFindOne.mockReturnValueOnce(lean(null));
    expect(await deviceSessionService.getStateByCookieKey('unknown')).toBeNull();
    expect(await deviceSessionService.getStateByCookieKey('')).toBeNull();
  });
});

describe('issueDeviceSecret', () => {
  it('mints a fresh secret and stores only its hash — no prior secret means no prev fields', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({ deviceId: 'd1' }));

    const secret = await deviceSessionService.issueDeviceSecret('d1');

    expect(typeof secret).toBe('string');
    expect((secret as string).length).toBeGreaterThan(20);
    const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
    // CAS filter: first issuance requires no secret to exist yet.
    expect(filter).toEqual({ deviceId: 'd1', secretHash: { $exists: false } });
    // Only the HASH of the returned secret is stored, never the raw value.
    expect(update.$set.secretHash).toBe(nodeCrypto.createHash('sha256').update(secret as string).digest('hex'));
    expect(update.$set.secretHash).not.toBe(secret);
    // First issuance → no previous secret to grace.
    expect(update.$set.prevSecretHash).toBeUndefined();
    expect(update.$set.prevSecretExpiresAt).toBeUndefined();
  });

  it('rotates: moves the existing secret to prev with a ~60s grace expiry and sets the new secret', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0, secretHash: 'OLDHASH' }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({ deviceId: 'd1' }));

    const before = Date.now();
    const secret = await deviceSessionService.issueDeviceSecret('d1');
    const after = Date.now();

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    // The just-superseded secret stays valid for a short grace (rotation-in-use).
    expect(update.$set.prevSecretHash).toBe('OLDHASH');
    expect(update.$set.prevSecretExpiresAt).toBeInstanceOf(Date);
    const graceExpiry = (update.$set.prevSecretExpiresAt as Date).getTime();
    expect(graceExpiry).toBeGreaterThanOrEqual(before + 60_000);
    expect(graceExpiry).toBeLessThanOrEqual(after + 60_000);
    expect(update.$set.secretHash).toBe(nodeCrypto.createHash('sha256').update(secret as string).digest('hex'));
    // The new secret differs from the old hash it replaced.
    expect(update.$set.secretHash).not.toBe('OLDHASH');
  });

  it('two successive mints return DIFFERENT secrets (each mint rotates)', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({ deviceId: 'd1' }));
    const first = await deviceSessionService.issueDeviceSecret('d1');

    // Second mint sees the (now-stored) first secret as current.
    const firstHash = nodeCrypto.createHash('sha256').update(first as string).digest('hex');
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], revision: 0, secretHash: firstHash }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({ deviceId: 'd1' }));
    const second = await deviceSessionService.issueDeviceSecret('d1');

    expect(second).not.toBe(first);
    // The first secret is preserved as prev (grace) so a lagging tab still mints.
    const [, secondUpdate] = mockFindOneAndUpdate.mock.calls[1];
    expect(secondUpdate.$set.prevSecretHash).toBe(firstHash);
  });

  it('returns null when the device doc does not exist (never mints a secret bound to a phantom device)', async () => {
    mockFindOne.mockReturnValueOnce(lean(null));
    expect(await deviceSessionService.issueDeviceSecret('ghost')).toBeNull();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns null when the doc vanished between read and write (CAS retry re-reads, doc gone)', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean(null));
    // Retry re-reads; doc is gone → give up.
    mockFindOne.mockReturnValueOnce(lean(null));
    expect(await deviceSessionService.issueDeviceSecret('d1')).toBeNull();
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('lost CAS race retries once against the concurrent winner hash and succeeds', async () => {
    // Attempt 1 reads OLDHASH but a concurrent mint wins the CAS → write matches nothing.
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], revision: 0, secretHash: 'OLDHASH' }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean(null));
    // Attempt 2 re-reads the winner's hash and rotates on top of it.
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], revision: 0, secretHash: 'WINNERHASH' }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({ deviceId: 'd1' }));

    const secret = await deviceSessionService.issueDeviceSecret('d1');

    expect(typeof secret).toBe('string');
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
    const [retryFilter, retryUpdate] = mockFindOneAndUpdate.mock.calls[1];
    // The retry's CAS guard targets the hash it re-read, not the stale one.
    expect(retryFilter).toEqual({ deviceId: 'd1', secretHash: 'WINNERHASH' });
    expect(retryUpdate.$set.prevSecretHash).toBe('WINNERHASH');
    expect(retryUpdate.$set.secretHash).toBe(nodeCrypto.createHash('sha256').update(secret as string).digest('hex'));
  });

  it('gives up after two lost CAS races (no unbounded retry loop)', async () => {
    mockFindOne.mockReturnValue(lean({ deviceId: 'd1', accounts: [], revision: 0, secretHash: 'H' }));
    mockFindOneAndUpdate.mockReturnValue(lean(null));
    expect(await deviceSessionService.issueDeviceSecret('d1')).toBeNull();
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('getStateBySecret', () => {
  const rawSecret = 'raw-device-secret-value';
  const secretHash = nodeCrypto.createHash('sha256').update(rawSecret).digest('hex');

  it('returns the projected state when the secret matches the current secretHash (constant-time)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
      updatedAt: new Date(1720000000000),
      secretHash,
    }));
    const state = await deviceSessionService.getStateBySecret('d1', rawSecret);
    expect(state?.deviceId).toBe('d1');
    expect(state?.activeAccountId).toBe('a1');
    // Looked up by deviceId; the raw secret is never part of the query.
    expect(mockFindOne).toHaveBeenCalledWith({ deviceId: 'd1' });
  });

  it('accepts the PREVIOUS secret within the grace window', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 1, updatedAt: new Date(1720000000000),
      secretHash: 'CURRENTHASH', prevSecretHash: secretHash, prevSecretExpiresAt: new Date(Date.now() + 30_000),
    }));
    const state = await deviceSessionService.getStateBySecret('d1', rawSecret);
    expect(state?.deviceId).toBe('d1');
  });

  it('rejects the previous secret once the grace window has expired', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 1, updatedAt: new Date(),
      secretHash: 'CURRENTHASH', prevSecretHash: secretHash, prevSecretExpiresAt: new Date(Date.now() - 1_000),
    }));
    expect(await deviceSessionService.getStateBySecret('d1', rawSecret)).toBeNull();
  });

  it('returns null on a secret mismatch', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 1, updatedAt: new Date(),
      secretHash: 'A-DIFFERENT-HASH',
    }));
    expect(await deviceSessionService.getStateBySecret('d1', rawSecret)).toBeNull();
  });

  it('returns null when the doc carries no secretHash at all', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 1, updatedAt: new Date() }));
    expect(await deviceSessionService.getStateBySecret('d1', rawSecret)).toBeNull();
  });

  it('returns null for an unknown device, and short-circuits (no query) for empty inputs', async () => {
    mockFindOne.mockReturnValueOnce(lean(null));
    expect(await deviceSessionService.getStateBySecret('d1', rawSecret)).toBeNull();
    // Empty deviceId / empty secret never touch the DB.
    expect(await deviceSessionService.getStateBySecret('d1', '')).toBeNull();
    expect(await deviceSessionService.getStateBySecret('', rawSecret)).toBeNull();
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });
});

describe('signout — device-secret cleanup (2c)', () => {
  it('signout-ALL unsets secretHash/prevSecretHash/prevSecretExpiresAt (cookieKeyHash left untouched)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 3 }));

    await deviceSessionService.signout('d1', { all: true });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$unset).toEqual({ secretHash: '', prevSecretHash: '', prevSecretExpiresAt: '' });
    // The device cookie hash is NEVER cleared here — it lives until the cutover.
    expect(update.$unset).not.toHaveProperty('cookieKeyHash');
  });

  it('single-account signout does NOT unset the device secret (other accounts on the device still use it)', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [
        { accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 },
        { accountId: { toString: () => 'a2' }, sessionId: 's2', authuser: 1 },
      ],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
    }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a2' }, sessionId: 's2', authuser: 1 }],
      activeAccountId: { toString: () => 'a2' },
      revision: 3,
    }));

    await deviceSessionService.signout('d1', { accountId: 'a1' });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$unset).toBeUndefined();
  });
});

describe('ensureDeviceForCookie', () => {
  it('mints a new device + cookie secret and stores only the hash', async () => {
    mockCreate.mockResolvedValueOnce({});
    const { deviceId, rawCookieKey } = await deviceSessionService.ensureDeviceForCookie();

    expect(typeof deviceId).toBe('string');
    expect(deviceId.length).toBeGreaterThan(0);
    expect(typeof rawCookieKey).toBe('string');
    expect(rawCookieKey.length).toBeGreaterThan(20);

    const created = mockCreate.mock.calls[0][0];
    expect(created.deviceId).toBe(deviceId);
    // The stored cookieKeyHash is the sha256 of the returned secret — not the secret.
    expect(created.cookieKeyHash).toBe(
      nodeCrypto.createHash('sha256').update(rawCookieKey).digest('hex'),
    );
    expect(created.cookieKeyHash).not.toBe(rawCookieKey);
  });
});

describe('convergeAccountOntoDevice', () => {
  it('adds the account to the cookie doc, advances its revision past the old doc, detaches (preserving the migrated session), and returns both states', async () => {
    mockUpdateOne.mockResolvedValue({});
    // 1) oldBefore load — the retired doc is at revision 5.
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'old-dev',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 5,
    }));
    // 2) addAccount loads the (empty) cookie doc.
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'cookie-dev', accounts: [], activeAccountId: null, revision: 0 }));
    // 3) addAccount writes → cookie doc with the account, active, revision 1.
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'cookie-dev',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    // 4) revision bump (1 <= 5) → cookie doc revision advanced to old+1 = 6.
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'cookie-dev',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 6,
      updatedAt: new Date(1720000000000),
    }));
    // 5) detachMigratedAccount loads the OLD doc (still holds a1 with session s1).
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'old-dev',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 5,
    }));
    // 6) convergeAccountOntoDevice re-loads the OLD doc (now emptied) for oldState.
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'old-dev', accounts: [], activeAccountId: null, revision: 6, updatedAt: new Date(1720000000001),
    }));

    const { cookieState, oldState, changed } = await deviceSessionService.convergeAccountOntoDevice(
      'cookie-dev',
      'old-dev',
      { accountId: 'a1', sessionId: 's1' },
    );

    expect(changed).toBe(true);
    expect(cookieState.deviceId).toBe('cookie-dev');
    expect(cookieState.activeAccountId).toBe('a1');
    expect(cookieState.accounts).toHaveLength(1);
    // The canonical cookie doc out-ranks the retired doc so the client applies it.
    expect(cookieState.revision).toBe(6);
    expect(cookieState.revision).toBeGreaterThan(5);
    // The bump update targeted the cookie device with the advanced revision.
    const bumpCall = mockFindOneAndUpdate.mock.calls[1];
    expect(bumpCall[0]).toEqual({ deviceId: 'cookie-dev' });
    expect(bumpCall[1]).toEqual({ $set: { revision: 6 } });
    expect(oldState.deviceId).toBe('old-dev');
    expect(oldState.accounts).toHaveLength(0);
    // The just-migrated session (s1) is PRESERVED — never deactivated by detach.
    expect(mockDeactivate).not.toHaveBeenCalled();
  });

  it('synthesizes an empty old state WITHOUT upserting when the old doc is absent (no garbage doc)', async () => {
    mockUpdateOne.mockResolvedValue({});
    // 1) oldBefore load — no old doc.
    mockFindOne.mockReturnValueOnce(lean(null));
    // 2) addAccount loads the (empty) cookie doc.
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'cookie-dev', accounts: [], activeAccountId: null, revision: 0 }));
    // 3) addAccount writes → cookie doc revision 1 (bump path: 1 > oldRevisionBefore 0, so NO bump).
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'cookie-dev',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    // 4) detachMigratedAccount load (old doc absent → no-op).
    mockFindOne.mockReturnValueOnce(lean(null));
    // 5) convergeAccountOntoDevice re-load (old doc still absent → synthetic state).
    mockFindOne.mockReturnValueOnce(lean(null));

    const { oldState, cookieState } = await deviceSessionService.convergeAccountOntoDevice(
      'cookie-dev',
      'missing-old-dev',
      { accountId: 'a1', sessionId: 's1' },
    );

    // Synthetic empty old state (deviceId echoed), never persisted.
    expect(oldState).toEqual({ deviceId: 'missing-old-dev', accounts: [], activeAccountId: null, revision: 0, updatedAt: expect.any(Number) });
    expect(cookieState.deviceId).toBe('cookie-dev');
    // Exactly ONE findOneAndUpdate (the addAccount write) — NO getState upsert,
    // NO revision bump (cookie revision 1 already > old 0).
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
