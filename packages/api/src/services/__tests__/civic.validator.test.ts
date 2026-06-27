/**
 * Validator jury tests (civic / Fase 2 Part B).
 *
 * Two cores:
 *  - `selectValidators` — graph-excluded / sock-puppet candidates are NOT
 *    selected, the subject is never on their own jury, and the draw is
 *    DETERMINISTIC given the rng seed (the audit guarantee).
 *  - `tallyAndResolve` — a valid-majority at quorum awards the subject
 *    `peer_validated` (with the Oxy provenance attestation) and rewards each
 *    majority juror `validation_correct`, resolving the request to `validated`.
 *
 * Models + the reputation award + signature verify are mocked; the seeded
 * weighted-reservoir draw + the tally logic run for real.
 */

const mockBalanceFind = jest.fn();
const mockIsSockPuppet = jest.fn();
const mockAffinityFindOne = jest.fn();
const mockAffinityUpdate = jest.fn();
const mockReqFindById = jest.fn();
const mockReqFindOneAndUpdate = jest.fn();
const mockVoteFind = jest.fn();
const mockAward = jest.fn();

jest.mock('../../models/ReputationBalance', () => ({
  __esModule: true,
  ReputationBalance: {
    find: (...a: unknown[]) => mockBalanceFind(...a),
    findOne: () => ({ select: () => ({ lean: async () => ({ trustTier: 'verified' }) }) }),
  },
}));
jest.mock('../civic/graphExclusion', () => ({ isSockPuppetRelation: (...a: unknown[]) => mockIsSockPuppet(...a) }));
jest.mock('../../models/ValidatorAffinity', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockAffinityFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockAffinityUpdate(...a),
  },
}));
jest.mock('../../models/ValidationRequest', () => ({
  __esModule: true,
  default: {
    findById: (...a: unknown[]) => mockReqFindById(...a),
    findOne: jest.fn(),
    findOneAndUpdate: (...a: unknown[]) => mockReqFindOneAndUpdate(...a),
    create: jest.fn(),
    find: jest.fn(),
  },
}));
jest.mock('../../models/ValidationVote', () => ({
  __esModule: true,
  default: { find: (...a: unknown[]) => mockVoteFind(...a), create: jest.fn() },
}));
jest.mock('../../models/User', () => ({ __esModule: true, User: { findById: jest.fn() } }));
jest.mock('../signedRecord.service', () => ({ verifyEnvelopeSignature: jest.fn(), verifyAndStoreRecord: jest.fn() }));
jest.mock('../reputation.service', () => ({ reputationService: { award: (...a: unknown[]) => mockAward(...a) } }));
const mockResolveAudit = jest.fn();
jest.mock('../civic/personhoodAudit.service', () => ({
  resolvePersonhoodAuditOutcome: (...a: unknown[]) => mockResolveAudit(...a),
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { selectValidators, tallyAndResolve } from '../civic/validator.service';

const SUBJECT = 's'.repeat(24);
const POOL = Array.from({ length: 8 }, (_, i) => `${i}`.repeat(24));

function balancePool(ids: string[]) {
  const rows = ids.map((id) => ({ userId: id, trustTier: 'verified' }));
  return { select: () => ({ limit: () => ({ lean: async () => rows }) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsSockPuppet.mockResolvedValue({ excluded: false });
  mockAffinityFindOne.mockReturnValue({ lean: async () => null });
  mockAffinityUpdate.mockResolvedValue({});
  mockAward.mockResolvedValue({ _id: { toString: () => 'txn1' }, points: 8 });
});

describe('selectValidators', () => {
  it('selects VALIDATOR_COUNT jurors, excluding the subject', async () => {
    mockBalanceFind.mockReturnValue(balancePool([SUBJECT, ...POOL]));
    const { validatorIds } = await selectValidators(SUBJECT, { rngSeed: 'seed-1' });
    expect(validatorIds).toHaveLength(5);
    expect(validatorIds).not.toContain(SUBJECT);
  });

  it('does NOT select a graph-excluded / sock-puppet candidate', async () => {
    mockBalanceFind.mockReturnValue(balancePool(POOL));
    const excluded = POOL[3];
    mockIsSockPuppet.mockImplementation(async (_subject: string, candidate: string) =>
      candidate === excluded ? { excluded: true, reason: 'graph_neighbor' } : { excluded: false },
    );
    const { validatorIds, candidateSnapshot } = await selectValidators(SUBJECT, { rngSeed: 'seed-1' });
    expect(validatorIds).not.toContain(excluded);
    expect(candidateSnapshot.map((c) => c.userId)).not.toContain(excluded);
  });

  it('is deterministic given the same rng seed', async () => {
    mockBalanceFind.mockReturnValue(balancePool(POOL));
    const a = await selectValidators(SUBJECT, { rngSeed: 'fixed' });
    mockBalanceFind.mockReturnValue(balancePool(POOL));
    const b = await selectValidators(SUBJECT, { rngSeed: 'fixed' });
    expect(a.validatorIds).toEqual(b.validatorIds);
    expect(a.rngSeed).toBe('fixed');
  });

  it('skips a candidate with high co-vote affinity to an already-selected juror', async () => {
    mockBalanceFind.mockReturnValue(balancePool(POOL));
    // Pre-compute the seeded order to know who is picked first, then make the
    // SECOND-ranked candidate share high affinity with the first → it is skipped.
    const baseline = await selectValidators(SUBJECT, { rngSeed: 'aff' });
    const [first, second] = baseline.validatorIds;
    mockBalanceFind.mockReturnValue(balancePool(POOL));
    mockAffinityFindOne.mockImplementation((pair: { validatorA: string; validatorB: string }) => {
      const isFirstSecond =
        (pair.validatorA === first && pair.validatorB === second) ||
        (pair.validatorA === second && pair.validatorB === first);
      return { lean: async () => (isFirstSecond ? { coVoteCount: 5 } : null) };
    });
    const { validatorIds } = await selectValidators(SUBJECT, { rngSeed: 'aff' });
    expect(validatorIds).toContain(first);
    expect(validatorIds).not.toContain(second);
  });
});

describe('tallyAndResolve', () => {
  function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
      _id: { toString: () => 'req1' },
      subjectUserId: { toString: () => SUBJECT },
      selectedValidatorIds: ['v1', 'v2', 'v3', 'v4', 'v5'].map((id) => ({ toString: () => id })),
      quorum: 3,
      threshold: 3,
      highValue: false,
      status: 'pending',
      expiresAt: new Date(Date.now() + 1_000_000),
      save: jest.fn(async function (this: unknown) { return this; }),
      ...overrides,
    };
  }

  function votes(verdicts: Array<'valid' | 'invalid'>) {
    return verdicts.map((verdict, i) => ({
      verdict,
      validatorUserId: { toString: () => `v${i + 1}` },
      recordId: `rec-${i + 1}`,
    }));
  }

  it('awards peer_validated + validation_correct on a valid majority at quorum', async () => {
    mockReqFindById.mockResolvedValue(makeRequest());
    mockVoteFind.mockReturnValue({ lean: async () => votes(['valid', 'valid', 'valid']) });
    mockReqFindOneAndUpdate.mockResolvedValue(makeRequest({ status: 'validated', outcome: 'validated' }));

    const status = await tallyAndResolve('req1');

    expect(status).toBe('validated');
    const peer = mockAward.mock.calls.find((c) => c[0].actionType === 'peer_validated');
    expect(peer?.[0]).toMatchObject({ userId: SUBJECT, emitAttestation: true });
    expect(peer?.[0].sourceEnvelopeIds).toEqual(['rec-1', 'rec-2', 'rec-3']);
    const correct = mockAward.mock.calls.filter((c) => c[0].actionType === 'validation_correct');
    expect(correct).toHaveLength(3);
    // Affinity bumped for the 3 winning-side pairs.
    expect(mockAffinityUpdate).toHaveBeenCalledTimes(3);
  });

  it('stays pending below quorum (no award)', async () => {
    mockReqFindById.mockResolvedValue(makeRequest());
    mockVoteFind.mockReturnValue({ lean: async () => votes(['valid', 'valid']) }); // 2 < quorum 3

    const status = await tallyAndResolve('req1');

    expect(status).toBe('pending');
    expect(mockAward).not.toHaveBeenCalled();
    expect(mockReqFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects on an invalid majority (no peer_validated award)', async () => {
    mockReqFindById.mockResolvedValue(makeRequest());
    mockVoteFind.mockReturnValue({ lean: async () => votes(['invalid', 'invalid', 'invalid']) });
    mockReqFindOneAndUpdate.mockResolvedValue(makeRequest({ status: 'rejected', outcome: 'rejected' }));

    const status = await tallyAndResolve('req1');

    expect(status).toBe('rejected');
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('dispatches a personhood_audit resolution to the audit resolver (not peer_validated)', async () => {
    mockResolveAudit.mockResolvedValue(undefined);
    mockReqFindById.mockResolvedValue(makeRequest({ actionType: 'personhood_audit' }));
    mockVoteFind.mockReturnValue({ lean: async () => votes(['invalid', 'invalid', 'invalid']) });
    mockReqFindOneAndUpdate.mockResolvedValue(
      makeRequest({ status: 'rejected', outcome: 'rejected', actionType: 'personhood_audit' }),
    );

    const status = await tallyAndResolve('req1');

    expect(status).toBe('rejected');
    expect(mockResolveAudit).toHaveBeenCalledTimes(1);
    expect(mockResolveAudit.mock.calls[0][1]).toBe('rejected');
    // The audit path does NOT award peer_validated.
    expect(mockAward.mock.calls.find((c) => c[0].actionType === 'peer_validated')).toBeUndefined();
  });
});
