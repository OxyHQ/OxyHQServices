import { deviceSessionStateSchema, sessionAccountSchema, safeParseContract } from '../index';

describe('deviceSessionStateSchema', () => {
  const account = { accountId: 'a1', sessionId: 's1', authuser: 0 };
  const state = { deviceId: 'd1', accounts: [account], activeAccountId: 'a1', revision: 3, updatedAt: 1720000000000 };

  it('parses a valid state', () => {
    expect(safeParseContract(deviceSessionStateSchema, state)).toEqual(state);
  });

  it('accepts an optional operatedByUserId on an account', () => {
    const withOp = { ...account, operatedByUserId: 'op1' };
    expect(safeParseContract(sessionAccountSchema, withOp)).toEqual(withOp);
  });

  it('accepts activeAccountId=null (device signed out of all)', () => {
    const parsed = safeParseContract(deviceSessionStateSchema, { ...state, accounts: [], activeAccountId: null });
    expect(parsed?.activeAccountId).toBeNull();
  });

  it('rejects a negative authuser', () => {
    expect(safeParseContract(sessionAccountSchema, { ...account, authuser: -1 })).toBeNull();
  });

  it('rejects a state missing revision', () => {
    const { revision, ...noRev } = state;
    expect(safeParseContract(deviceSessionStateSchema, noRev)).toBeNull();
  });
});
