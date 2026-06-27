/**
 * Slash service tests (civic / Fase 2 Part B staking).
 *
 * A reversed civic award slashes whoever vouched for it: a reversed
 * `peer_validated` slashes every juror who voted `valid`; a reversed
 * `real_life_attested` slashes the counterparty (`createdByUserId`). Both apply
 * `validation_incorrect` (-10). Non-civic reversals slash no one.
 */

const mockReqFindOne = jest.fn();
const mockVoteFind = jest.fn();
const mockAward = jest.fn();
const mockSlashVouchers = jest.fn();

jest.mock('../../models/ValidationRequest', () => ({
  __esModule: true,
  default: { findOne: (...a: unknown[]) => mockReqFindOne(...a) },
}));
jest.mock('../../models/ValidationVote', () => ({
  __esModule: true,
  default: { find: (...a: unknown[]) => mockVoteFind(...a) },
}));
jest.mock('../reputation.service', () => ({ reputationService: { award: (...a: unknown[]) => mockAward(...a) } }));
jest.mock('../civic/personhood.service', () => ({
  slashVouchersForFakeSubject: (...a: unknown[]) => mockSlashVouchers(...a),
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { slashForReversedTransaction } from '../civic/slash.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockAward.mockResolvedValue({});
  mockSlashVouchers.mockResolvedValue(3);
});

describe('slashForReversedTransaction', () => {
  it('slashes the valid-voting jurors of a reversed peer_validated', async () => {
    mockReqFindOne.mockReturnValue({ select: () => ({ lean: async () => ({ _id: 'req1' }) }) });
    mockVoteFind.mockReturnValue({
      select: () => ({
        lean: async () => [
          { validatorUserId: { toString: () => 'v1' } },
          { validatorUserId: { toString: () => 'v2' } },
        ],
      }),
    });

    const slashed = await slashForReversedTransaction({
      _id: { toString: () => 'txn1' },
      actionType: 'peer_validated',
    });

    expect(slashed).toBe(2);
    expect(mockAward).toHaveBeenCalledTimes(2);
    expect(mockAward.mock.calls.every((c) => c[0].actionType === 'validation_incorrect')).toBe(true);
    expect(mockAward.mock.calls.map((c) => c[0].userId).sort()).toEqual(['v1', 'v2']);
  });

  it('slashes the attestor of a reversed real_life_attested', async () => {
    const slashed = await slashForReversedTransaction({
      _id: { toString: () => 'txn2' },
      actionType: 'real_life_attested',
      createdByUserId: { toString: () => 'attestorB' },
    });

    expect(slashed).toBe(1);
    expect(mockAward).toHaveBeenCalledTimes(1);
    expect(mockAward.mock.calls[0][0]).toMatchObject({ userId: 'attestorB', actionType: 'validation_incorrect' });
  });

  it('slashes every active voucher of a reversed personhood_vouched (proven-fake subject)', async () => {
    const slashed = await slashForReversedTransaction({
      _id: { toString: () => 'txn5' },
      actionType: 'personhood_vouched',
      userId: { toString: () => 'subjectFake' },
    });

    expect(slashed).toBe(3);
    expect(mockSlashVouchers).toHaveBeenCalledWith('subjectFake', expect.any(String));
    // The cascade owns the vouch_slashed awards — slash.service does not award directly here.
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('slashes no one for a non-civic reversal', async () => {
    const slashed = await slashForReversedTransaction({ _id: { toString: () => 'txn3' }, actionType: 'endorsement_received' });
    expect(slashed).toBe(0);
    expect(mockAward).not.toHaveBeenCalled();
    expect(mockSlashVouchers).not.toHaveBeenCalled();
  });

  it('slashes no one when the originating request is gone', async () => {
    mockReqFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    const slashed = await slashForReversedTransaction({ _id: { toString: () => 'txn4' }, actionType: 'peer_validated' });
    expect(slashed).toBe(0);
    expect(mockAward).not.toHaveBeenCalled();
  });
});
