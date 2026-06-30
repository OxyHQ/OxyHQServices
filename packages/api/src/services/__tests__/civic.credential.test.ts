/**
 * Verifiable Credential service tests (civic / Fase 4).
 *
 * Drives the credential service with the models + the chain-store mocked, but
 * with REAL secp256k1 signing and the REAL `verifyEnvelopeSignature` +
 * `did.service` so the cryptographic verify path is exercised end to end:
 *  - issuing a self-issued, well-signed credential verifies, resolves the holder
 *    from `record.about`, and persists the projection row;
 *  - verifying against the issuer DID's CURRENT verification method passes;
 *  - a tampered claim (broken signature) fails;
 *  - a credential whose issuer key has rotated away fails (`issuer_key_not_current`);
 *  - a revoked credential fails; an expired credential fails (and is lazily flipped);
 *  - only the original issuer may revoke;
 *  - each issuance gate rejects with its stable reason.
 *
 * `verifyAndStoreRecord` is the only part of `signedRecord.service` that is
 * mocked (it needs a real Mongo transaction); `verifyEnvelopeSignature` +
 * `signRecordEnvelope` run for real.
 */

import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockVerifyAndStore = jest.fn();
const mockUserExists = jest.fn();
const mockUserFindById = jest.fn();
const mockVcCreate = jest.fn();
const mockVcFindOne = jest.fn();
const mockVcFindById = jest.fn();
const mockVcFind = jest.fn();
const mockVcUpdateOne = jest.fn();
const mockSignedRecordFindOne = jest.fn();

// Keep the real signing/verify helpers; mock only the transactional store.
jest.mock('../signedRecord.service', () => ({
  ...jest.requireActual('../signedRecord.service'),
  verifyAndStoreRecord: (...a: unknown[]) => mockVerifyAndStore(...a),
}));

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: { findOne: (...a: unknown[]) => mockSignedRecordFindOne(...a) },
}));
// RepoHead is referenced by the real signedRecord.service + repoLog.service at
// load time; these tests never consult the chain head.
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../models/VerifiableCredential', () => ({
  __esModule: true,
  default: {
    create: (...a: unknown[]) => mockVcCreate(...a),
    findOne: (...a: unknown[]) => mockVcFindOne(...a),
    findById: (...a: unknown[]) => mockVcFindById(...a),
    find: (...a: unknown[]) => mockVcFind(...a),
    updateOne: (...a: unknown[]) => mockVcUpdateOne(...a),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: {
    exists: (...a: unknown[]) => mockUserExists(...a),
    findById: (...a: unknown[]) => mockUserFindById(...a),
  },
}));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  issueCredential,
  issueOrgCredential,
  verifyCredential,
  revokeCredential,
  listCredentialsForHolder,
} from '../civic/credential.service';
import { signRecordEnvelope } from '../signedRecord.service';
import { buildUserDid } from '../did.service';

const ec = new EC('secp256k1');
const issuerKey = ec.genKeyPair();
const ISSUER_PUBLIC_KEY = issuerKey.getPublic('hex');
const ISSUER_PRIVATE_KEY = issuerKey.getPrivate('hex');

const HOLDER = 'a'.repeat(24);
const ISSUER = 'b'.repeat(24);
const OTHER = 'c'.repeat(24);
const VC_ID = 'd'.repeat(24);

interface EnvOverrides {
  type?: SignedRecordEnvelope['type'];
  subject?: string;
  issuer?: string;
  about?: string;
  types?: string[];
  claims?: Record<string, unknown>;
  expiresAt?: number;
  rkey?: string;
}

/** Build + REAL-sign a self-issued credential envelope from the issuer. */
function credentialEnvelope(o: EnvOverrides = {}): SignedRecordEnvelope {
  const record: Record<string, unknown> = {
    about: o.about ?? buildUserDid(HOLDER),
    types: o.types ?? ['VerifiableCredential', 'EmploymentCredential'],
    claims: o.claims ?? { employer: 'Acme', from: '2020', to: '2024' },
    ...(o.expiresAt !== undefined ? { expiresAt: o.expiresAt } : {}),
  };
  const fields: Omit<SignedRecordEnvelope, 'signature'> = {
    version: 2,
    type: o.type ?? 'credential',
    subject: o.subject ?? buildUserDid(ISSUER),
    issuer: o.issuer ?? buildUserDid(ISSUER),
    record,
    issuedAt: Date.now(),
    seq: 0,
    prev: null,
    collection: 'app.oxy.credential',
    rkey: o.rkey ?? 'cred-1',
    publicKey: ISSUER_PUBLIC_KEY,
    alg: 'ES256K-DER-SHA256',
  };
  return signRecordEnvelope(fields, ISSUER_PRIVATE_KEY);
}

/** A stored credential projection row (lean-ish doc). */
function vcDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: VC_ID,
    recordId: 'rec-1',
    holderUserId: HOLDER,
    holderDid: buildUserDid(HOLDER),
    issuerUserId: ISSUER,
    issuerDid: buildUserDid(ISSUER),
    types: ['VerifiableCredential', 'EmploymentCredential'],
    claims: { employer: 'Acme' },
    status: 'active',
    issuedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserExists.mockResolvedValue({ _id: HOLDER });
  mockUserFindById.mockReturnValue({
    select: () => ({ lean: async () => ({ _id: ISSUER, publicKey: ISSUER_PUBLIC_KEY, authMethods: [] }) }),
  });
  mockVerifyAndStore.mockResolvedValue({ ok: true, record: { recordId: 'rec-1' } });
  mockVcCreate.mockImplementation(async (doc: Record<string, unknown>) => vcDoc(doc));
});

describe('issueCredential', () => {
  it('verifies, resolves the holder from record.about, and persists the row', async () => {
    const result = await issueCredential(credentialEnvelope(), ISSUER);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.credential.holderUserId).toBe(HOLDER);
    expect(result.credential.issuerUserId).toBe(ISSUER);
    expect(result.credential.recordId).toBe('rec-1');
    expect(result.credential.status).toBe('active');

    expect(mockVcCreate).toHaveBeenCalledTimes(1);
    expect(mockVcCreate.mock.calls[0][0]).toMatchObject({
      holderUserId: HOLDER,
      issuerUserId: ISSUER,
      issuerDid: buildUserDid(ISSUER),
      recordId: 'rec-1',
      types: ['VerifiableCredential', 'EmploymentCredential'],
      status: 'active',
    });
    // The signed record was appended on the ISSUER's chain.
    expect(mockVerifyAndStore.mock.calls[0][1]).toBe(ISSUER);
  });

  it('rejects a wrong envelope type', async () => {
    const env = credentialEnvelope({ type: 'identity' });
    expect(await issueCredential(env, ISSUER)).toEqual({ ok: false, reason: 'invalid_type' });
  });

  it('rejects an envelope not self-issued by the caller', async () => {
    const env = credentialEnvelope({ subject: buildUserDid(HOLDER) });
    expect(await issueCredential(env, ISSUER)).toEqual({ ok: false, reason: 'not_self_issued' });
  });

  it('rejects a record missing the VerifiableCredential base type', async () => {
    const env = credentialEnvelope({ types: ['EmploymentCredential'] });
    expect(await issueCredential(env, ISSUER)).toEqual({ ok: false, reason: 'missing_base_type' });
  });

  it('rejects an unresolvable holder DID', async () => {
    const env = credentialEnvelope({ about: 'not-a-did' });
    expect(await issueCredential(env, ISSUER)).toEqual({ ok: false, reason: 'invalid_holder' });
  });

  it('rejects a self-credential (holder === issuer)', async () => {
    const env = credentialEnvelope({ about: buildUserDid(ISSUER) });
    expect(await issueCredential(env, ISSUER)).toEqual({ ok: false, reason: 'self_credential' });
  });

  it('rejects an already-expired expiry', async () => {
    const env = credentialEnvelope({ expiresAt: Date.now() - 1000 });
    expect(await issueCredential(env, ISSUER)).toEqual({ ok: false, reason: 'invalid_expiry' });
  });

  it('rejects when the holder does not exist', async () => {
    mockUserExists.mockResolvedValue(null);
    expect(await issueCredential(credentialEnvelope(), ISSUER)).toEqual({ ok: false, reason: 'holder_not_found' });
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
  });

  it('rejects a tampered (bad-signature) envelope before storing', async () => {
    const env = credentialEnvelope();
    const tampered: SignedRecordEnvelope = { ...env, record: { ...env.record, claims: { employer: 'Mallory' } } };
    expect(await issueCredential(tampered, ISSUER)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
  });

  it('surfaces a chain-store rejection reason', async () => {
    mockVerifyAndStore.mockResolvedValue({ ok: false, reason: 'chain_conflict' });
    expect(await issueCredential(credentialEnvelope(), ISSUER)).toEqual({ ok: false, reason: 'chain_conflict' });
  });
});

describe('verifyCredential', () => {
  it('passes for a well-signed credential against the issuer DID current VM', async () => {
    const env = credentialEnvelope();
    mockVcFindOne.mockReturnValue({ lean: async () => vcDoc() });
    mockSignedRecordFindOne.mockReturnValue({ lean: async () => ({ envelope: env }) });

    const result = await verifyCredential('rec-1');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.credential?.recordId).toBe('rec-1');
  });

  it('fails a tampered claim (broken signature)', async () => {
    const env = credentialEnvelope();
    const tampered: SignedRecordEnvelope = { ...env, record: { ...env.record, claims: { employer: 'Tampered' } } };
    mockVcFindOne.mockReturnValue({ lean: async () => vcDoc() });
    mockSignedRecordFindOne.mockReturnValue({ lean: async () => ({ envelope: tampered }) });

    const result = await verifyCredential('rec-1');
    expect(result).toMatchObject({ valid: false, reason: 'bad_signature' });
  });

  it('fails when the issuer key has rotated away (not a current VM)', async () => {
    const env = credentialEnvelope();
    const rotated = ec.genKeyPair().getPublic('hex');
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: ISSUER, publicKey: rotated, authMethods: [] }) }),
    });
    mockVcFindOne.mockReturnValue({ lean: async () => vcDoc() });
    mockSignedRecordFindOne.mockReturnValue({ lean: async () => ({ envelope: env }) });

    const result = await verifyCredential('rec-1');
    expect(result).toMatchObject({ valid: false, reason: 'issuer_key_not_current' });
  });

  it('fails a revoked credential', async () => {
    const env = credentialEnvelope();
    mockVcFindOne.mockReturnValue({ lean: async () => vcDoc({ status: 'revoked', revokedAt: new Date() }) });
    mockSignedRecordFindOne.mockReturnValue({ lean: async () => ({ envelope: env }) });

    const result = await verifyCredential('rec-1');
    expect(result).toMatchObject({ valid: false, reason: 'revoked' });
  });

  it('fails an expired credential and lazily flips its status', async () => {
    const env = credentialEnvelope();
    mockVcFindOne.mockReturnValue({ lean: async () => vcDoc({ expiresAt: new Date(Date.now() - 1000) }) });
    mockSignedRecordFindOne.mockReturnValue({ lean: async () => ({ envelope: env }) });
    mockVcUpdateOne.mockResolvedValue({ acknowledged: true });

    const result = await verifyCredential('rec-1');
    expect(result).toMatchObject({ valid: false, reason: 'expired' });
    expect(result.credential?.status).toBe('expired');
    expect(mockVcUpdateOne).toHaveBeenCalledTimes(1);
  });

  it('returns not_found for an unknown record id', async () => {
    mockVcFindOne.mockReturnValue({ lean: async () => null });
    const result = await verifyCredential('rec-missing');
    expect(result).toEqual({ valid: false, reason: 'not_found', credential: null });
  });
});

describe('revokeCredential', () => {
  it('lets the original issuer revoke', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc = { ...vcDoc({ status: 'active' }), save };
    mockVcFindById.mockResolvedValue(doc);

    const result = await revokeCredential(VC_ID, ISSUER);
    expect(result.ok).toBe(true);
    expect(doc.status).toBe('revoked');
    expect(doc.revokedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-issuer', async () => {
    mockVcFindById.mockResolvedValue({ ...vcDoc({ status: 'active' }), save: jest.fn() });
    expect(await revokeCredential(VC_ID, OTHER)).toEqual({ ok: false, reason: 'not_issuer' });
  });

  it('rejects an already-revoked credential', async () => {
    mockVcFindById.mockResolvedValue({ ...vcDoc({ status: 'revoked' }), save: jest.fn() });
    expect(await revokeCredential(VC_ID, ISSUER)).toEqual({ ok: false, reason: 'already_revoked' });
  });

  it('returns not_found for an unknown credential', async () => {
    mockVcFindById.mockResolvedValue(null);
    expect(await revokeCredential(VC_ID, ISSUER)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('listCredentialsForHolder', () => {
  it('returns the holder credentials, newest first', async () => {
    mockVcFind.mockReturnValue({ sort: () => ({ lean: async () => [vcDoc(), vcDoc({ recordId: 'rec-2' })] }) });
    const list = await listCredentialsForHolder(HOLDER);
    expect(list).toHaveLength(2);
    expect(list[0].recordId).toBe('rec-1');
    expect(mockVcFind).toHaveBeenCalledWith({ holderUserId: HOLDER });
  });

  it('passes a status filter through', async () => {
    mockVcFind.mockReturnValue({ sort: () => ({ lean: async () => [] }) });
    await listCredentialsForHolder(HOLDER, { status: 'revoked' });
    expect(mockVcFind).toHaveBeenCalledWith({ holderUserId: HOLDER, status: 'revoked' });
  });
});

describe('issueOrgCredential (custodial seam)', () => {
  it('skips when the Oxy custodial key is unconfigured', async () => {
    const prevPriv = process.env.OXY_PRIVATE_KEY;
    const prevPub = process.env.OXY_PUBLIC_KEY;
    delete process.env.OXY_PRIVATE_KEY;
    delete process.env.OXY_PUBLIC_KEY;
    try {
      const result = await issueOrgCredential({
        holderDid: buildUserDid(HOLDER),
        types: ['VerifiableCredential', 'EmploymentCredential'],
        claims: { employer: 'Acme' },
        rkey: 'org-cred-1',
      });
      expect(result).toEqual({ ok: false, reason: 'oxy_key_unconfigured' });
    } finally {
      if (prevPriv !== undefined) process.env.OXY_PRIVATE_KEY = prevPriv;
      if (prevPub !== undefined) process.env.OXY_PUBLIC_KEY = prevPub;
    }
  });
});
