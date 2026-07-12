/**
 * Regression: the signed-record Oxy adapter under the PRODUCTION did:web anchor.
 *
 * Production sets `DID_WEB_DOMAIN=api.oxy.so` (server-emitted DIDs) while the
 * shipped SDK signs envelopes at the canonical identity apex
 * (`did:web:oxy.so:u:<accountId>`). The `oxyStorePolicy` subject binding used to
 * string-compare `env.subject !== buildUserDid(subjectUserId)`, so every
 * client-signed identity/civic record was rejected `subject_mismatch` in prod.
 * The binding is now account-based (`parseUserDid(env.subject) !== subjectUserId`
 * with a dual-anchor parse), and the resolver + store key chains by the PARSED
 * account id, so both spellings land on the same chain.
 *
 * Real secp256k1 crypto; the `SignedRecord`/`RepoHead`/`User` models are mocked
 * (mirrors `signedRecord.service.test.ts`). Modules load FRESH under
 * `DID_WEB_DOMAIN=api.oxy.so` via `jest.isolateModulesAsync` because the anchor
 * is read at module load.
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
jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));

const ec = new EC('secp256k1');

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439099';
const keyPair = ec.genKeyPair();
const PUBLIC_KEY = keyPair.getPublic('hex');
const PRIVATE_KEY = keyPair.getPrivate('hex');

/** The spelling the shipped SDK signs with (`@oxyhq/core` OXY_IDENTITY_APEX). */
function sdkDid(id: string): string {
  return `did:web:oxy.so:u:${id}`;
}

function makeEnvelopeFields(
  overrides: Partial<Omit<SignedRecordEnvelope, 'signature'>> = {},
): Omit<SignedRecordEnvelope, 'signature'> {
  return {
    version: 1,
    type: 'identity',
    subject: sdkDid(USER_ID),
    issuer: sdkDid(USER_ID),
    record: { displayName: 'Nate' },
    issuedAt: Date.now(),
    publicKey: PUBLIC_KEY,
    alg: 'ES256K-DER-SHA256',
    ...overrides,
  };
}

describe('signedRecord adapter under DID_WEB_DOMAIN=api.oxy.so (prod anchor)', () => {
  const ORIGINAL_DID_WEB_DOMAIN = process.env.DID_WEB_DOMAIN;
  let signRecordEnvelope: typeof import('../signedRecord.service').signRecordEnvelope;
  let verifyEnvelope: typeof import('../signedRecord.service').verifyEnvelope;
  let verifyAndStoreRecord: typeof import('../signedRecord.service').verifyAndStoreRecord;

  beforeAll(async () => {
    process.env.DID_WEB_DOMAIN = 'api.oxy.so';
    await jest.isolateModulesAsync(async () => {
      ({ signRecordEnvelope, verifyEnvelope, verifyAndStoreRecord } = await import('../signedRecord.service'));
    });
  });

  afterAll(() => {
    if (ORIGINAL_DID_WEB_DOMAIN === undefined) {
      delete process.env.DID_WEB_DOMAIN;
    } else {
      process.env.DID_WEB_DOMAIN = ORIGINAL_DID_WEB_DOMAIN;
    }
    jest.resetModules();
  });

  beforeEach(() => {
    mockSrFindOne.mockReset();
    mockSrCreate.mockReset();
    mockUserFindById.mockReset();
    // The subject resolves to the test key as its sole current verification method.
    mockUserFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ publicKey: PUBLIC_KEY }) }) });
    // No prior record (monotonic check passes).
    mockSrFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
    mockSrCreate.mockResolvedValue({ _id: 'rec' });
  });

  it('accepts and stores an SDK-spelled (did:web:oxy.so) self-issued record', async () => {
    const env = signRecordEnvelope(makeEnvelopeFields(), PRIVATE_KEY);

    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: true });

    const result = await verifyAndStoreRecord(env, USER_ID);
    expect(result.ok).toBe(true);
    // The stored row is keyed by the PARSED account id, so both spellings share
    // one chain regardless of the envelope's anchor.
    expect(mockSrCreate.mock.calls[0][0]).toMatchObject({ userId: USER_ID, subjectDid: sdkDid(USER_ID) });
  });

  it('accepts a server-spelled (did:web:api.oxy.so) self-issued record too', async () => {
    const did = `did:web:api.oxy.so:u:${USER_ID}`;
    const env = signRecordEnvelope(makeEnvelopeFields({ subject: did, issuer: did }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: true });
  });

  it('still rejects a record whose subject is another account', async () => {
    const env = signRecordEnvelope(
      makeEnvelopeFields({ subject: sdkDid(OTHER_USER_ID), issuer: sdkDid(OTHER_USER_ID) }),
      PRIVATE_KEY,
    );
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: false, reason: 'subject_mismatch' });
  });

  it('still rejects a foreign-domain subject', async () => {
    const did = `did:web:evil.com:u:${USER_ID}`;
    const env = signRecordEnvelope(makeEnvelopeFields({ subject: did, issuer: did }), PRIVATE_KEY);
    await expect(verifyEnvelope(env, USER_ID)).resolves.toEqual({ ok: false, reason: 'subject_mismatch' });
  });
});
