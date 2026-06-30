/**
 * Civic reputation-attestation tests (Fase 1).
 *
 * Two layers, both against the REAL `attestAward` (only the chain storage + the
 * reputation models are mocked):
 *  1. `attestAward` directly — builds a verifiable, Oxy-signed v2
 *     `reputation_attestation` (genesis + chain extension), records the right
 *     fields + weight class, is idempotent per txn, non-fatal on a missing Oxy
 *     key, and retries the chain-head race.
 *  2. `reputationService.award` wiring — emits the attestation when
 *     `emitAttestation: true` and NOT otherwise (the 14 existing call sites,
 *     which omit it, are unaffected).
 *
 * The Oxy custodial keypair is generated here and injected via env, so the
 * signature assertions are real (the same `ES256K-DER-SHA256` scheme).
 */

import { ec as EC } from 'elliptic';
import { Types } from 'mongoose';
import { signedRecordSigningInput } from '@oxyhq/protocol';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const ec = new EC('secp256k1');
const oxyKey = ec.genKeyPair();
const OXY_PUBLIC = oxyKey.getPublic('hex');
const OXY_PRIVATE = oxyKey.getPrivate('hex');

const mockVerifyAndStore = jest.fn();
const mockGetHead = jest.fn();
const mockMaterialize = jest.fn();

// Chain storage + read layer (used by attestAward).
jest.mock('../signedRecord.service', () => ({
  verifyAndStoreRecord: (...args: unknown[]) => mockVerifyAndStore(...args),
}));
jest.mock('../repoLog.service', () => ({
  getHead: (...args: unknown[]) => mockGetHead(...args),
  materializeCurrent: (...args: unknown[]) => mockMaterialize(...args),
}));

// Reputation models (used by reputationService.award + recalculateBalance).
const mockRuleFindOne = jest.fn();
const mockTxnCreate = jest.fn();
const mockTxnFindOne = jest.fn();
const mockUserFindById = jest.fn();
jest.mock('../../models/ReputationRule', () => ({
  __esModule: true,
  ReputationRule: { findOne: (...a: unknown[]) => mockRuleFindOne(...a) },
}));
jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: {
    create: (...a: unknown[]) => mockTxnCreate(...a),
    find: () => ({ session: async () => [] }),
    findOne: (...a: unknown[]) => mockTxnFindOne(...a),
  },
}));
jest.mock('../../models/ReputationBalance', () => ({
  __esModule: true,
  ReputationBalance: { findOneAndUpdate: async () => ({}) },
}));
jest.mock('../../models/ReputationDispute', () => ({ __esModule: true, ReputationDispute: {} }));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    findById: (...a: unknown[]) => mockUserFindById(...a),
    updateOne: async () => ({}),
  },
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  const startSession = jest.fn(async () => ({
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    endSession: async () => undefined,
  }));
  const patched = { ...actual, startSession };
  return { __esModule: true, ...patched, default: patched };
});

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { attestAward, REPUTATION_ATTESTATION_COLLECTION } from '../civic/attestation.service';
import { reputationService } from '../reputation.service';
import SignatureService from '../signature.service';
import { buildUserDid, OXY_DID } from '../did.service';

const SUBJECT_USER_ID = '507f1f77bcf86cd799439011';

function makeTxn(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId('507f191e810c19729de860ea'),
    userId: new Types.ObjectId(SUBJECT_USER_ID),
    actionType: 'real_life_attested',
    points: 25,
    category: 'physical',
    sourceActionId: 'src-1',
    ...overrides,
  };
}

beforeAll(() => {
  process.env.OXY_PRIVATE_KEY = OXY_PRIVATE;
  process.env.OXY_PUBLIC_KEY = OXY_PUBLIC;
});
afterAll(() => {
  delete process.env.OXY_PRIVATE_KEY;
  delete process.env.OXY_PUBLIC_KEY;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMaterialize.mockResolvedValue(null);
  mockGetHead.mockResolvedValue(null);
  mockVerifyAndStore.mockResolvedValue({ ok: true, record: {} });
});

describe('attestAward', () => {
  it('builds a verifiable, Oxy-signed v2 reputation_attestation at genesis', async () => {
    const txn = makeTxn();
    const env = await attestAward(txn, { sourceEnvelopes: ['rec-aaa'] });

    expect(env).not.toBeNull();
    const stored = env as SignedRecordEnvelope;
    expect(stored.version).toBe(2);
    expect(stored.type).toBe('reputation_attestation');
    expect(stored.subject).toBe(buildUserDid(SUBJECT_USER_ID));
    expect(stored.issuer).toBe(OXY_DID);
    expect(stored.publicKey).toBe(OXY_PUBLIC);
    expect(stored.collection).toBe(REPUTATION_ATTESTATION_COLLECTION);
    expect(stored.rkey).toBe(txn._id.toString());
    expect(stored.seq).toBe(0);
    expect(stored.prev).toBeNull();
    // The signature verifies against the Oxy public key over the shared input.
    expect(SignatureService.verifySignature(signedRecordSigningInput(stored), stored.signature, stored.publicKey)).toBe(true);
    // Record payload: proof chain + weight class.
    expect(stored.record).toMatchObject({
      txnId: txn._id.toString(),
      subjectUserId: SUBJECT_USER_ID,
      actionType: 'real_life_attested',
      points: 25,
      weightClass: 'HIGH',
      sourceEnvelopeIds: ['rec-aaa'],
    });
    // It was actually stored against the subject's chain.
    expect(mockVerifyAndStore).toHaveBeenCalledTimes(1);
    expect(mockVerifyAndStore.mock.calls[0][1]).toBe(SUBJECT_USER_ID);
  });

  it('extends the chain when a head already exists', async () => {
    mockGetHead.mockResolvedValue({ seq: 4, headRecordId: 'h'.repeat(64), recordCount: 5 });
    const env = (await attestAward(makeTxn())) as SignedRecordEnvelope;
    expect(env.seq).toBe(5);
    expect(env.prev).toBe('h'.repeat(64));
  });

  it('maps peer_validated to the MEDIUM weight class', async () => {
    const env = (await attestAward(makeTxn({ actionType: 'peer_validated', points: 8 }))) as SignedRecordEnvelope;
    expect((env.record as { weightClass: string }).weightClass).toBe('MEDIUM');
  });

  it('is idempotent per txn — returns the existing attestation without storing', async () => {
    mockMaterialize.mockResolvedValue({ type: 'reputation_attestation' });
    const env = await attestAward(makeTxn());
    expect(env).toEqual({ type: 'reputation_attestation' });
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
  });

  it('is non-fatal when the Oxy key is unconfigured (returns null, no store)', async () => {
    delete process.env.OXY_PRIVATE_KEY;
    delete process.env.OXY_PUBLIC_KEY;
    const env = await attestAward(makeTxn());
    expect(env).toBeNull();
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
    process.env.OXY_PRIVATE_KEY = OXY_PRIVATE;
    process.env.OXY_PUBLIC_KEY = OXY_PUBLIC;
  });

  it('retries the chain-head race then succeeds', async () => {
    mockVerifyAndStore
      .mockResolvedValueOnce({ ok: false, reason: 'chain_conflict' })
      .mockResolvedValueOnce({ ok: true, record: {} });
    const env = await attestAward(makeTxn());
    expect(env).not.toBeNull();
    expect(mockVerifyAndStore).toHaveBeenCalledTimes(2);
  });
});

describe('reputationService.award — attestation wiring', () => {
  beforeEach(() => {
    mockRuleFindOne.mockResolvedValue({
      points: 25,
      category: 'physical',
      cooldownInMinutes: 0,
      description: 'real life',
    });
    mockTxnCreate.mockResolvedValue([makeTxn()]);
    mockTxnFindOne.mockResolvedValue(null);
    mockUserFindById.mockReturnValue({ select: () => ({ lean: async () => null }) });
  });

  it('emits a reputation_attestation when emitAttestation is true', async () => {
    await reputationService.award({
      userId: SUBJECT_USER_ID,
      actionType: 'real_life_attested',
      emitAttestation: true,
      sourceEnvelopeIds: ['rec-bbb'],
    });

    expect(mockVerifyAndStore).toHaveBeenCalledTimes(1);
    const env = mockVerifyAndStore.mock.calls[0][0] as SignedRecordEnvelope;
    expect(env.type).toBe('reputation_attestation');
    expect(env.subject).toBe(buildUserDid(SUBJECT_USER_ID));
    expect(env.issuer).toBe(OXY_DID);
  });

  it('does NOT emit an attestation by default (existing call sites unaffected)', async () => {
    await reputationService.award({
      userId: SUBJECT_USER_ID,
      actionType: 'real_life_attested',
    });

    expect(mockVerifyAndStore).not.toHaveBeenCalled();
    expect(mockGetHead).not.toHaveBeenCalled();
  });
});
