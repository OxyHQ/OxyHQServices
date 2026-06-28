/**
 * Personhood service tests (civic / Fase 3 web-of-trust).
 *
 * Drives `vouchForPerson` + `recomputePersonhood` with everything around them
 * mocked (signature verify + chain store, graph exclusion, sybil, reputation
 * award/recalc, models, userCache) so the eligibility gates and the recompute
 * pipeline are exercised in isolation. `did.service` (buildUserDid/parseUserDid)
 * runs for real.
 */

import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockVerifySig = jest.fn();
const mockVerifyAndStore = jest.fn();
const mockIsSockPuppet = jest.fn();
const mockComputeSybil = jest.fn();
const mockAward = jest.fn();
const mockRecalc = jest.fn();
const mockInvalidate = jest.fn();

const mockUserExists = jest.fn();
const mockUserFindById = jest.fn();
const mockUserUpdateOne = jest.fn();
const mockVouchFind = jest.fn();
const mockVouchFindOne = jest.fn();
const mockVouchCreate = jest.fn();
const mockVouchFindOneAndUpdate = jest.fn();
const mockStatusFindOne = jest.fn();
const mockStatusUpsert = jest.fn();
const mockBalanceFind = jest.fn();
const mockTxnFindOne = jest.fn();
const mockTxnCount = jest.fn();

jest.mock('../signedRecord.service', () => ({
  verifyEnvelopeSignature: (...a: unknown[]) => mockVerifySig(...a),
  verifyAndStoreRecord: (...a: unknown[]) => mockVerifyAndStore(...a),
}));
jest.mock('../civic/graphExclusion', () => ({
  isSockPuppetRelation: (...a: unknown[]) => mockIsSockPuppet(...a),
}));
jest.mock('../civic/sybil.service', () => ({
  computeSybilPenalty: (...a: unknown[]) => mockComputeSybil(...a),
}));
jest.mock('../reputation.service', () => ({
  reputationService: {
    award: (...a: unknown[]) => mockAward(...a),
    recalculateBalance: (...a: unknown[]) => mockRecalc(...a),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    exists: (...a: unknown[]) => mockUserExists(...a),
    findById: (...a: unknown[]) => mockUserFindById(...a),
    updateOne: (...a: unknown[]) => mockUserUpdateOne(...a),
  },
}));
jest.mock('../../models/PersonhoodVouch', () => ({
  __esModule: true,
  default: {
    find: (...a: unknown[]) => mockVouchFind(...a),
    findOne: (...a: unknown[]) => mockVouchFindOne(...a),
    create: (...a: unknown[]) => mockVouchCreate(...a),
    findOneAndUpdate: (...a: unknown[]) => mockVouchFindOneAndUpdate(...a),
    updateOne: jest.fn(),
  },
}));
jest.mock('../../models/PersonhoodStatus', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockStatusFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockStatusUpsert(...a),
  },
}));
jest.mock('../../models/ReputationBalance', () => ({
  __esModule: true,
  ReputationBalance: { find: (...a: unknown[]) => mockBalanceFind(...a) },
}));
jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: {
    findOne: (...a: unknown[]) => mockTxnFindOne(...a),
    countDocuments: (...a: unknown[]) => mockTxnCount(...a),
  },
}));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: (...a: unknown[]) => mockInvalidate(...a) } }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { vouchForPerson, recomputePersonhood } from '../civic/personhood.service';
import { buildUserDid } from '../did.service';

const SUBJECT = 'a'.repeat(24);
const VOUCHER = 'b'.repeat(24);

function selectLean(data: unknown) {
  return { select: () => ({ lean: async () => data }) };
}

function envelope(overrides: { about?: string; subject?: string; issuer?: string; stake?: number } = {}): SignedRecordEnvelope {
  return {
    version: 2,
    type: 'personhood_vouch',
    subject: overrides.subject ?? buildUserDid(VOUCHER),
    issuer: overrides.issuer ?? buildUserDid(VOUCHER),
    record: { about: overrides.about ?? buildUserDid(SUBJECT), context: 'met-in-person', stake: overrides.stake },
    issuedAt: Date.now(),
    seq: 0,
    prev: null,
    collection: 'app.oxy.personhood',
    rkey: 'vouch-1',
    publicKey: 'pk-voucher',
    alg: 'ES256K-DER-SHA256',
    signature: 'sig',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifySig.mockReturnValue(true);
  mockIsSockPuppet.mockResolvedValue({ excluded: false });
  mockComputeSybil.mockResolvedValue({ penalty: 0, sharedFingerprintFraction: 0, ringDensity: 0 });
  mockVerifyAndStore.mockResolvedValue({ ok: true, record: { recordId: 'rec-1' } });
  mockAward.mockResolvedValue({ points: 5 });
  mockRecalc.mockResolvedValue({});
  mockUserExists.mockResolvedValue({ _id: SUBJECT });

  // Default User.findById: publicKey lookup + non-seed / unverified.
  mockUserFindById.mockImplementation(() => ({
    select: (fields: string) => ({
      lean: async () => {
        if (fields.includes('verified')) return { isSeedVerifier: false, verified: false };
        if (fields.includes('isSeedVerifier')) return { isSeedVerifier: false };
        return { publicKey: 'pk-voucher', authMethods: [] };
      },
    }),
  }));

  mockUserUpdateOne.mockResolvedValue({});
  // Voucher is an eligible real person by default (score 1 ≥ τ).
  mockStatusFindOne.mockReturnValue(selectLean({ score: 1 }));
  mockStatusUpsert.mockImplementation((q: { userId: string }, update: { $set: Record<string, unknown> }) =>
    Promise.resolve({ userId: q.userId, ...update.$set }),
  );
  mockVouchFind.mockReturnValue(selectLean([])); // recompute: no vouchers by default
  mockVouchFindOne.mockReturnValue(selectLean(null)); // no existing vouch
  mockVouchCreate.mockResolvedValue({});
  mockBalanceFind.mockReturnValue(selectLean([]));
  mockTxnFindOne.mockReturnValue(selectLean(null)); // not biometric-bound
  mockTxnCount.mockResolvedValue(0);
});

describe('vouchForPerson', () => {
  it('verifies, stakes, awards the subject, and creates an active vouch', async () => {
    const result = await vouchForPerson(envelope(), VOUCHER);

    expect(result).toMatchObject({ ok: true, recordId: 'rec-1', subjectUserId: SUBJECT, voucherUserId: VOUCHER, points: 5 });
    expect(mockVouchCreate).toHaveBeenCalledTimes(1);
    expect(mockVouchCreate.mock.calls[0][0]).toMatchObject({ voucherUserId: VOUCHER, subjectUserId: SUBJECT, status: 'active' });
    expect(mockAward).toHaveBeenCalledTimes(1);
    expect(mockAward.mock.calls[0][0]).toMatchObject({
      userId: SUBJECT,
      actionType: 'personhood_vouched',
      createdByUserId: VOUCHER,
      emitAttestation: true,
      sourceEnvelopeIds: ['rec-1'],
    });
    // Recompute ran for the subject (status upserted).
    expect(mockStatusUpsert).toHaveBeenCalled();
  });

  it('clamps the staked amount into the configured bounds', async () => {
    await vouchForPerson(envelope({ stake: 10_000 }), VOUCHER);
    expect(mockVouchCreate.mock.calls[0][0].stakeAmount).toBeLessThanOrEqual(100);
  });

  it('rejects a wrong envelope type', async () => {
    const env = { ...envelope(), type: 'identity' as SignedRecordEnvelope['type'] };
    expect(await vouchForPerson(env, VOUCHER)).toEqual({ ok: false, reason: 'invalid_type' });
  });

  it('rejects an envelope not self-issued by the voucher', async () => {
    expect(await vouchForPerson(envelope({ subject: buildUserDid(SUBJECT) }), VOUCHER)).toEqual({
      ok: false,
      reason: 'not_self_issued',
    });
  });

  it('rejects a self-vouch (about === voucher)', async () => {
    expect(await vouchForPerson(envelope({ about: buildUserDid(VOUCHER) }), VOUCHER)).toEqual({
      ok: false,
      reason: 'self_vouch',
    });
  });

  it('rejects a bad signature before any graph / DB work', async () => {
    mockVerifySig.mockReturnValue(false);
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(mockIsSockPuppet).not.toHaveBeenCalled();
    expect(mockVouchCreate).not.toHaveBeenCalled();
  });

  it('rejects a voucher who is not themselves a real person (below τ)', async () => {
    mockStatusFindOne.mockReturnValue(selectLean({ score: 0.2 }));
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'voucher_below_threshold' });
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('rejects a graph-related / sock-puppet voucher (no store, no award)', async () => {
    mockIsSockPuppet.mockResolvedValue({ excluded: true, reason: 'graph_neighbor' });
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'excluded_graph_neighbor' });
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('rejects a shared-device voucher', async () => {
    mockIsSockPuppet.mockResolvedValue({ excluded: true, reason: 'shared_device' });
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'excluded_shared_device' });
  });

  it('rejects a duplicate historical vouch before appending a record', async () => {
    mockVouchFindOne.mockReturnValue(selectLean({ _id: 'existing', status: 'withdrawn' }));
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'already_vouched' });
    expect(mockVouchFindOne).toHaveBeenCalledWith({ voucherUserId: VOUCHER, subjectUserId: SUBJECT });
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate-key race on create as already_vouched', async () => {
    mockVouchCreate.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'already_vouched' });
  });

  it('rejects an unverifiable / un-storable record', async () => {
    mockVerifyAndStore.mockResolvedValue({ ok: false, reason: 'chain_conflict' });
    expect(await vouchForPerson(envelope(), VOUCHER)).toEqual({ ok: false, reason: 'chain_conflict' });
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('allows a seed-verifier voucher with no personhood status row', async () => {
    mockStatusFindOne.mockReturnValue(selectLean(null));
    mockUserFindById.mockImplementation(() => ({
      select: (fields: string) => ({
        lean: async () => {
          if (fields.includes('verified')) return { isSeedVerifier: true, verified: true };
          if (fields.includes('isSeedVerifier')) return { isSeedVerifier: true };
          return { publicKey: 'pk-voucher', authMethods: [] };
        },
      }),
    }));
    const result = await vouchForPerson(envelope(), VOUCHER);
    expect(result.ok).toBe(true);
  });
});

describe('recomputePersonhood — verified mirror + tier promotion', () => {
  it('promotes a well-vouched + biometric user: verified=true, balance recalc, cache invalidated', async () => {
    // Three verified vouchers → weightedVouchScore = 3 → vouchSignal = 1.
    mockVouchFind.mockReturnValue(selectLean([{ voucherUserId: 'v1' }, { voucherUserId: 'v2' }, { voucherUserId: 'v3' }]));
    mockBalanceFind.mockReturnValue(
      selectLean([
        { userId: 'v1', trustTier: 'verified' },
        { userId: 'v2', trustTier: 'verified' },
        { userId: 'v3', trustTier: 'verified' },
      ]),
    );
    mockTxnFindOne.mockReturnValue(selectLean({ _id: 'rl-1' })); // biometric-bound

    const status = await recomputePersonhood(SUBJECT);

    expect(status.isRealPerson).toBe(true);
    expect(mockUserUpdateOne).toHaveBeenCalledWith({ _id: SUBJECT }, { $set: { verified: true } });
    expect(mockRecalc).toHaveBeenCalledWith(SUBJECT);
    expect(mockInvalidate).toHaveBeenCalledWith(SUBJECT);
  });

  it('does NOT touch verified / recalc when the verdict is unchanged', async () => {
    // No vouches, no real-life → score 0, not real; user already unverified.
    const status = await recomputePersonhood(SUBJECT);
    expect(status.isRealPerson).toBe(false);
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
    expect(mockRecalc).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('treats a seed verifier as score 1 without aggregating vouches/sybil', async () => {
    mockUserFindById.mockImplementation(() => ({
      select: (fields: string) => ({
        lean: async () => {
          if (fields.includes('verified')) return { isSeedVerifier: true, verified: false };
          return { isSeedVerifier: true };
        },
      }),
    }));

    const status = await recomputePersonhood(SUBJECT);

    expect(status.score).toBe(1);
    expect(status.isRealPerson).toBe(true);
    expect(mockComputeSybil).not.toHaveBeenCalled();
    expect(mockVouchFind).not.toHaveBeenCalled();
    // verified flips false → true.
    expect(mockUserUpdateOne).toHaveBeenCalledWith({ _id: SUBJECT }, { $set: { verified: true } });
  });
});
