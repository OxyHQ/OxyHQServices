/**
 * Unit tests for the signed-record service (B5).
 *
 * Exercises the shared canonical-JSON signing scheme end to end: a record signed
 * with a secp256k1 private key verifies; a tampered record or a wrong-key
 * signature does not. Also covers the current-verification-method check and the
 * full `verifyEnvelope` orchestration (subject match, freshness, monotonicity).
 *
 * The `SignedRecord` model is mocked (the global mongoose mock cannot load the
 * real schema), so the monotonic check's `findOne` is controllable.
 */

import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockFindOne = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

// RepoHead is mocked so the real model file (which needs real mongoose
// Schema.Types) does not load under the global mongoose mock. These v1-only
// tests never consult the chain head.
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

import { signedRecordSigningInput } from '@oxyhq/core';
import {
  signRecordEnvelope,
  verifyEnvelopeSignature,
  isCurrentVerificationMethod,
  verifyEnvelope,
} from '../signedRecord.service';
import { buildUserDid } from '../did.service';

const ec = new EC('secp256k1');

const USER_ID = '507f1f77bcf86cd799439011';
const keyPair = ec.genKeyPair();
const PUBLIC_KEY = keyPair.getPublic('hex');
const PRIVATE_KEY = keyPair.getPrivate('hex');

function makeEnvelopeFields(overrides: Partial<Omit<SignedRecordEnvelope, 'signature'>> = {}): Omit<SignedRecordEnvelope, 'signature'> {
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

beforeEach(() => {
  mockFindOne.mockReset();
  mockCreate.mockReset();
});

describe('signedRecordSigningInput (shared with @oxyhq/core)', () => {
  it('is order-independent (canonical JSON) and excludes alg/publicKey/signature', () => {
    const issuedAt = 1_700_000_000_000;
    const a = signedRecordSigningInput(makeEnvelopeFields({ issuedAt, record: { a: 1, b: 2 } }));
    const b = signedRecordSigningInput(makeEnvelopeFields({ issuedAt, record: { b: 2, a: 1 } }));
    expect(a).toBe(b);
    expect(a).not.toContain('alg');
    expect(a).not.toContain('publicKey');
  });
});

describe('signRecordEnvelope + verifyEnvelopeSignature', () => {
  it('a record signed with the private key verifies', () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    expect(verifyEnvelopeSignature(env)).toBe(true);
  });

  it('a tampered record fails verification', () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    const tampered: SignedRecordEnvelope = { ...env, record: { displayName: 'Mallory' } };
    expect(verifyEnvelopeSignature(tampered)).toBe(false);
  });

  it('a signature from a different key fails verification', () => {
    const otherKey = ec.genKeyPair();
    const env = signRecordEnvelope(
      makeEnvelopeFields({ publicKey: otherKey.getPublic('hex') }),
      PRIVATE_KEY, // signed with the WRONG private key for the claimed publicKey
    );
    expect(verifyEnvelopeSignature(env)).toBe(false);
  });
});

describe('isCurrentVerificationMethod', () => {
  it('accepts the primary publicKey', () => {
    expect(isCurrentVerificationMethod({ publicKey: PUBLIC_KEY }, PUBLIC_KEY)).toBe(true);
  });

  it('accepts an identity auth-method key', () => {
    const subject = { authMethods: [{ type: 'identity', metadata: { publicKey: PUBLIC_KEY } }] };
    expect(isCurrentVerificationMethod(subject, PUBLIC_KEY)).toBe(true);
  });

  it('rejects an unknown key', () => {
    expect(isCurrentVerificationMethod({ publicKey: PUBLIC_KEY }, 'deadbeef')).toBe(false);
  });
});

describe('verifyEnvelope', () => {
  const subject = { publicKey: PUBLIC_KEY };

  it('accepts a fresh, well-signed record with no prior record', async () => {
    mockFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    await expect(verifyEnvelope(env, subject, USER_ID)).resolves.toEqual({ ok: true });
  });

  it('rejects a record whose subject is not the caller', async () => {
    const env = signRecordEnvelope(
      makeEnvelopeFields({ subject: buildUserDid('507f1f77bcf86cd799439099') }),
      PRIVATE_KEY,
    );
    await expect(verifyEnvelope(env, subject, USER_ID)).resolves.toEqual({
      ok: false,
      reason: 'subject_mismatch',
    });
  });

  it('rejects a key that is not a current verification method', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);
    await expect(verifyEnvelope(env, { publicKey: 'cafe' }, USER_ID)).resolves.toEqual({
      ok: false,
      reason: 'public_key_not_a_current_verification_method',
    });
  });

  it('rejects an issuedAt that is not newer than the latest stored record', async () => {
    const issuedAt = Date.now();
    mockFindOne.mockReturnValue({
      sort: () => ({ lean: () => Promise.resolve({ envelope: { issuedAt } }) }),
    });
    const env = signRecordEnvelope(makeEnvelopeFields({ issuedAt }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, subject, USER_ID)).resolves.toEqual({
      ok: false,
      reason: 'stale_issued_at',
    });
  });

  it('rejects an issuedAt too far in the future', async () => {
    mockFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
    const env = signRecordEnvelope(
      makeEnvelopeFields({ issuedAt: Date.now() + 60 * 60 * 1000 }),
      PRIVATE_KEY,
    );
    await expect(verifyEnvelope(env, subject, USER_ID)).resolves.toEqual({
      ok: false,
      reason: 'issued_in_future',
    });
  });
});
