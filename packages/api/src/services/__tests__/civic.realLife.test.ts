/**
 * Real-life attestation service tests (civic / Fase 2 Part A).
 *
 * Drives `submitRealLifeAttestation` with everything around it mocked (signature
 * verify + chain store, graph exclusion, nonce, reputation award, models) so the
 * eligibility gates are exercised in isolation: a clean attestation awards the
 * subject the HIGH-weight points (recording the attestor + emitting the Oxy
 * provenance attestation), and each gate (self, expired, nonce reuse, graph
 * neighbour, shared device, pair cooldown, bad signature) rejects with its
 * stable reason. `did.service` (buildUserDid/parseUserDid) runs for real.
 */

import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockVerifySig = jest.fn();
const mockVerifyAndStore = jest.fn();
const mockIsSockPuppet = jest.fn();
const mockNonceCreate = jest.fn();
const mockAward = jest.fn();
const mockUserExists = jest.fn();
const mockUserFindById = jest.fn();
const mockTxnFindOne = jest.fn();

jest.mock('../signedRecord.service', () => ({
  verifyAndStoreRecord: (...a: unknown[]) => mockVerifyAndStore(...a),
}));
jest.mock('@oxyhq/protocol', () => ({
  ...jest.requireActual('@oxyhq/protocol'),
  verifyEnvelopeSignature: (...a: unknown[]) => mockVerifySig(...a),
}));
jest.mock('../civic/graphExclusion', () => ({
  isSockPuppetRelation: (...a: unknown[]) => mockIsSockPuppet(...a),
}));
jest.mock('../../models/CivicNonce', () => ({
  __esModule: true,
  default: { create: (...a: unknown[]) => mockNonceCreate(...a) },
}));
jest.mock('../reputation.service', () => ({
  reputationService: { award: (...a: unknown[]) => mockAward(...a) },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    exists: (...a: unknown[]) => mockUserExists(...a),
    findById: (...a: unknown[]) => mockUserFindById(...a),
  },
}));
jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: { findOne: (...a: unknown[]) => mockTxnFindOne(...a) },
}));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { submitRealLifeAttestation } from '../civic/realLife.service';
import { buildUserDid } from '../did.service';

const A = 'a'.repeat(24); // subject
const B = 'b'.repeat(24); // attestor (caller)

function envelope(overrides: { about?: string; exp?: number; subject?: string; issuer?: string } = {}): SignedRecordEnvelope {
  return {
    version: 2,
    type: 'real_life_attestation',
    subject: overrides.subject ?? buildUserDid(B),
    issuer: overrides.issuer ?? buildUserDid(B),
    record: {
      about: overrides.about ?? buildUserDid(A),
      context: 'ctx-1',
      nonce: 'nonce-1',
      exp: overrides.exp ?? Date.now() + 5 * 60 * 1000,
    },
    issuedAt: Date.now(),
    seq: 0,
    prev: null,
    collection: 'app.oxy.attestation',
    rkey: 'nonce-1',
    publicKey: 'pk-b',
    alg: 'ES256K-DER-SHA256',
    signature: 'sig',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifySig.mockReturnValue(true);
  mockIsSockPuppet.mockResolvedValue({ excluded: false });
  mockNonceCreate.mockResolvedValue({});
  mockVerifyAndStore.mockResolvedValue({ ok: true, record: { recordId: 'rec-1' } });
  mockAward.mockResolvedValue({ points: 25 });
  mockUserExists.mockResolvedValue({ _id: A });
  mockUserFindById.mockReturnValue({ select: () => ({ lean: async () => ({ publicKey: 'pk-b', authMethods: [] }) }) });
  mockTxnFindOne.mockReturnValue({ lean: async () => null });
});

describe('submitRealLifeAttestation', () => {
  it('awards the subject the HIGH-weight points and records the attestor', async () => {
    const result = await submitRealLifeAttestation(envelope(), B);

    expect(result).toEqual({ ok: true, recordId: 'rec-1', subjectUserId: A, attestorUserId: B, points: 25 });
    expect(mockAward).toHaveBeenCalledTimes(1);
    expect(mockAward.mock.calls[0][0]).toMatchObject({
      userId: A,
      actionType: 'real_life_attested',
      createdByUserId: B,
      emitAttestation: true,
      sourceEnvelopeIds: ['rec-1'],
    });
  });

  it('rejects a wrong type', async () => {
    const env = { ...envelope(), type: 'identity' as SignedRecordEnvelope['type'] };
    expect(await submitRealLifeAttestation(env, B)).toEqual({ ok: false, reason: 'invalid_type' });
  });

  it('rejects an envelope not self-issued by the attestor', async () => {
    const env = envelope({ subject: buildUserDid(A) });
    expect(await submitRealLifeAttestation(env, B)).toEqual({ ok: false, reason: 'not_self_issued' });
  });

  it('rejects a self-attestation (about === attestor)', async () => {
    expect(await submitRealLifeAttestation(envelope({ about: buildUserDid(B) }), B)).toEqual({
      ok: false,
      reason: 'self_attestation',
    });
  });

  it('rejects an expired QR', async () => {
    expect(await submitRealLifeAttestation(envelope({ exp: Date.now() - 1000 }), B)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a graph-related counterparty (no award)', async () => {
    mockIsSockPuppet.mockResolvedValue({ excluded: true, reason: 'graph_neighbor' });
    expect(await submitRealLifeAttestation(envelope(), B)).toEqual({
      ok: false,
      reason: 'excluded_graph_neighbor',
    });
    expect(mockAward).not.toHaveBeenCalled();
    expect(mockNonceCreate).not.toHaveBeenCalled();
  });

  it('rejects a shared-device counterparty', async () => {
    mockIsSockPuppet.mockResolvedValue({ excluded: true, reason: 'shared_device' });
    expect(await submitRealLifeAttestation(envelope(), B)).toEqual({
      ok: false,
      reason: 'excluded_shared_device',
    });
  });

  it('runs the sock-puppet check with ignoreSharedIp so a shared IP does not hard-block', async () => {
    // A shared IP is a soft signal for attestation: `isSockPuppetRelation`
    // resolves `excluded:false` (IP downgraded) and the attestation proceeds.
    const result = await submitRealLifeAttestation(envelope(), B);

    expect(result).toEqual({ ok: true, recordId: 'rec-1', subjectUserId: A, attestorUserId: B, points: 25 });
    expect(mockIsSockPuppet).toHaveBeenCalledWith(A, B, expect.objectContaining({ ignoreSharedIp: true }));
  });

  it('rejects a per-pair cooldown hit (no award)', async () => {
    mockTxnFindOne.mockReturnValue({ lean: async () => ({ _id: 'old' }) });
    expect(await submitRealLifeAttestation(envelope(), B)).toEqual({ ok: false, reason: 'pair_cooldown' });
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('rejects a reused nonce (single-use E11000)', async () => {
    mockNonceCreate.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
    expect(await submitRealLifeAttestation(envelope(), B)).toEqual({ ok: false, reason: 'nonce_used' });
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('rejects a bad signature before any graph work', async () => {
    mockVerifySig.mockReturnValue(false);
    expect(await submitRealLifeAttestation(envelope(), B)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(mockIsSockPuppet).not.toHaveBeenCalled();
  });
});
