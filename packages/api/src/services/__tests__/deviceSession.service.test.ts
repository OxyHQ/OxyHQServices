const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockDeactivate = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('../../models/DeviceSession', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
  },
}));
jest.mock('../session.service', () => ({
  __esModule: true,
  default: {
    deactivateSession: (...a: unknown[]) => mockDeactivate(...a),
    getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a),
  },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import deviceSessionService, { projectState } from '../deviceSession.service';

const lean = (v: unknown) => ({ lean: () => Promise.resolve(v) });

beforeEach(() => jest.clearAllMocks());

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
  it('adds a new account at authuser 0, sets it active, bumps revision', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.addAccount('d1', { accountId: 'a1', sessionId: 's1' });
    expect(state.activeAccountId).toBe('a1');
    expect(state.accounts[0].authuser).toBe(0);
    expect(state.revision).toBe(1);
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
});

describe('switchActive', () => {
  it('returns null when the account is not on the device', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    expect(await deviceSessionService.switchActive('d1', 'ghost')).toBeNull();
  });
});

describe('resolveActiveToken', () => {
  const STATE = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };
  it('mints the active account token', async () => {
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'jwt', expiresAt: new Date('2026-07-07T00:00:00.000Z') });
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toEqual({ accessToken: 'jwt', expiresAt: '2026-07-07T00:00:00.000Z' });
    expect(mockGetAccessToken).toHaveBeenCalledWith('s1');
  });
  it('returns null when there is no active account', async () => {
    expect(await deviceSessionService.resolveActiveToken({ ...STATE, activeAccountId: null } as never)).toBeNull();
  });
  it('returns null when the session cannot mint a token', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toBeNull();
  });
});
