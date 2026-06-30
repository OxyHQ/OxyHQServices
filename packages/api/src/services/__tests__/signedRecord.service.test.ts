/**
 * Unit tests for the signed-record service — the thin Oxy ADAPTER over the
 * @oxyhq/protocol chain engine (B5).
 *
 * The verification state machine, continuity, and authorization rule are covered
 * by `@oxyhq/protocol`'s chain suite (with stub stores/resolvers). This suite
 * locks the OXY-SPECIFIC glue around it:
 *  - the `subject_mismatch` binding (a caller may only write to their own chain),
 *  - the Oxy STORE strictness gate (only the closed Oxy `type` set is accepted),
 *  - the resolver wiring (current verification methods read from `User`), and
 *  - the same rejection-reason strings the API returned before the extraction.
 *
 * `signRecordEnvelope` (the Oxy signing helper) round-trips against the protocol
 * signature check. The `SignedRecord`/`RepoHead`/`User` models are mocked.
 */

import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockSrFindOne = jest.fn();
const mockSrCreate = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockSrFindOne(...args),
    create: (...args: unknown[]) => mockSrCreate(...args),
  },
}));

// RepoHead is mocked so the real model file does not load under the global
// mongoose mock. These v1 tests never consult the chain head.
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

// The oxyVerificationResolver reads the subject's verification methods from User.
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

import { signedRecordSigningInput, verifyEnvelopeSignature } from '@oxyhq/protocol';
import { signRecordEnvelope, verifyEnvelope, verifyAndStoreRecord } from '../signedRecord.service';
import { buildUserDid } from '../did.service';

const ec = new EC('secp256k1');

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439099';
const keyPair = ec.genKeyPair();
const PUBLIC_KEY = keyPair.getPublic('hex');
const PRIVATE_KEY = keyPair.getPrivate('hex');

function makeEnvelopeFields(
  overrides: Partial<Omit<SignedRecordEnvelope, 'signature'>> = {},
): Omit<SignedRecordEnvelope, 'signature'> {
  return {
    version: 1,
    type: 'identity',
    subject: buildUserDid(USER_ID),
    issuer: buildUserDid(USER_ID),
    record: { displayName: 'Nate', bio: 'hello' },
    issuedAt: Date.now(),
    publicKey: PUBLIC_KEY,
    alg: 'ES256K-DER-SHA256',
    ...overrides,
  };
}

/** The subject resolves to the test key as its sole current verification method. */
function subjectResolvesTo(publicKey: string): void {
  mockUserFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ publicKey }) }) });
}

/** No prior record (monotonic check passes). */
function noPriorRecord(): void {
  mockSrFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
}

beforeEach(() => {
  mockSrFindOne.mockReset();
  mockSrCreate.mockReset();
  mockUserFindById.mockReset();
  subjectResolvesTo(PUBLIC_KEY);
  noPriorRecord();
  mockSrCreate.mockResolvedValue({ _id: 'rec' });
});

describe('signRecordEnvelope + verifyEnvelopeSignature', () => {
  it('a record signed with the private key verifies', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    await expect(verifyEnvelopeSignature(env)).resolves.toBe(true);
  });

  it('a tampered record fails verification', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    const tampered: SignedRecordEnvelope = { ...env, record: { displayName: 'Mallory' } };
    await expect(verifyEnvelopeSignature(tampered)).resolves.toBe(false);
  });

  it('the signing input excludes alg/publicKey/signature and is order-independent', () => {
    const issuedAt = 1_700_000_000_000;
    const a = signedRecordSigningInput(makeEnvelopeFields({ issuedAt, record: { a: 1, b: 2 } }));
    const b = signedRecordSigningInput(makeEnvelopeFields({ issuedAt, record: { b: 2, a: 1 } }));
    expect(a).toBe(b);
    expect(a).not.toContain('alg');
    expect(a).not.toContain('publicKey');
  });
});

describe('verifyEnvelope (Oxy adapter)', () => {
  it('accepts a fresh, well-signed record with no prior record', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: true });
  });

  it('rejects a record whose subject is not the caller', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields({ subject: buildUserDid(OTHER_USER_ID) }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: false, reason: 'subject_mismatch' });
  });

  it('rejects a non-Oxy record type via the store strictness gate', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields({ type: 'app_record' }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: false, reason: 'invalid_envelope' });
  });

  it('rejects a key that is not a current verification method', async () => {
    subjectResolvesTo('cafe');
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({
      ok: false,
      reason: 'public_key_not_a_current_verification_method',
    });
  });

  it('rejects an issuedAt that is not newer than the latest stored record', async () => {
    const issuedAt = Date.now();
    mockSrFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve({ envelope: { issuedAt } }) }) });
    const env = signRecordEnvelope(makeEnvelopeFields({ issuedAt }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: false, reason: 'stale_issued_at' });
  });

  it('rejects an issuedAt too far in the future', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields({ issuedAt: Date.now() + 60 * 60 * 1000 }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: false, reason: 'issued_in_future' });
  });
});

describe('verifyAndStoreRecord (Oxy adapter)', () => {
  it('stores a fresh v1 record and reports the envelope as verified', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    const result = await verifyAndStoreRecord(env, USER_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected success');
    }
    expect(result.record.envelope).toBe(env);
    expect(result.record.verified).toBe(true);
    // v1: stored via the single-object create with NO chain fields.
    const created = mockSrCreate.mock.calls[0][0];
    expect(created.seq).toBeUndefined();
    expect(created.verified).toBe(true);
  });

  it('returns the rejection reason without storing on a subject mismatch', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields({ subject: buildUserDid(OTHER_USER_ID) }), PRIVATE_KEY);
    const result = await verifyAndStoreRecord(env, USER_ID);
    expect(result).toEqual({ ok: false, reason: 'subject_mismatch' });
    expect(mockSrCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-Oxy record type at the store strictness gate without storing', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields({ type: 'app_record' }), PRIVATE_KEY);
    const result = await verifyAndStoreRecord(env, USER_ID);
    expect(result).toEqual({ ok: false, reason: 'invalid_envelope' });
    expect(mockSrCreate).not.toHaveBeenCalled();
  });
});
