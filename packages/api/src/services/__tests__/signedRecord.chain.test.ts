/**
 * Unit tests for the v2 per-subject hash chain (F0.2).
 *
 * Exercises chain continuity + transactional head advance on top of the existing
 * signed-record verification:
 *  - a v2 genesis record stores and creates the RepoHead,
 *  - a second v2 record with the correct prev/seq extends the chain + advances head,
 *  - a wrong `prev` is rejected `chain_fork`; a seq gap is rejected `bad_seq`;
 *    a non-genesis with no head is `chain_gap`,
 *  - a v1 record still verifies + stores WITHOUT touching the chain,
 *  - `recordId` matches core's `computeRecordId`,
 *  - the head advance is transactional,
 *  - a duplicate `{userId, seq}` (E11000) surfaces as `chain_conflict`.
 *
 * Both models + `mongoose.startSession` are mocked; `computeRecordId` from
 * `@oxyhq/core` is the REAL deterministic function (so the recordId assertion is
 * meaningful and client/server cannot drift).
 */

import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockSrFindOne = jest.fn();
const mockSrCreate = jest.fn();
const mockHeadFindOne = jest.fn();
const mockHeadUpdate = jest.fn();

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockSrFindOne(...args),
    create: (...args: unknown[]) => mockSrCreate(...args),
  },
}));

jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockHeadFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockHeadUpdate(...args),
  },
}));

// Keep real mongoose Types/ObjectId, but stub startSession so withTransaction
// runs the work session-lessly through a fake session object.
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

import { computeRecordId } from '@oxyhq/core';
import { signRecordEnvelope, verifyAndStoreRecord } from '../signedRecord.service';
import { buildUserDid } from '../did.service';

const ec = new EC('secp256k1');

const USER_ID = '507f1f77bcf86cd799439011';
const keyPair = ec.genKeyPair();
const PUBLIC_KEY = keyPair.getPublic('hex');
const PRIVATE_KEY = keyPair.getPrivate('hex');
const SUBJECT = { publicKey: PUBLIC_KEY };

type V2Fields = Omit<SignedRecordEnvelope, 'signature'>;

function v2Fields(overrides: Partial<V2Fields> = {}): V2Fields {
  return {
    version: 2,
    type: 'identity',
    subject: buildUserDid(USER_ID),
    issuer: buildUserDid(USER_ID),
    record: { displayName: 'Nate' },
    issuedAt: Date.now(),
    seq: 0,
    prev: null,
    collection: 'app.oxy.identity',
    rkey: 'self',
    publicKey: PUBLIC_KEY,
    alg: 'ES256K-DER-SHA256',
    ...overrides,
  };
}

/** No prior record of this type (monotonic check passes). */
function noPriorRecord(): void {
  mockSrFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
}

/** A prior record with a given issuedAt (so a newer record stays monotonic). */
function priorRecord(issuedAt: number): void {
  mockSrFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve({ envelope: { issuedAt } }) }) });
}

/** No chain head yet. */
function noHead(): void {
  mockHeadFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });
}

/** An existing chain head. */
function headAt(headRecordId: string, seq: number): void {
  mockHeadFindOne.mockReturnValue({ lean: () => Promise.resolve({ headRecordId, seq }) });
}

beforeEach(() => {
  mockSrFindOne.mockReset();
  mockSrCreate.mockReset();
  mockHeadFindOne.mockReset();
  mockHeadUpdate.mockReset();
  // create echoes its input (array form → array; object form → object).
  mockSrCreate.mockImplementation((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.resolve([{ ...(arg[0] as object), _id: 'rec' }])
      : Promise.resolve({ ...(arg as object), _id: 'rec' }),
  );
  mockHeadUpdate.mockResolvedValue({});
});

describe('verifyAndStoreRecord — v2 genesis', () => {
  it('stores the genesis record and creates the RepoHead', async () => {
    noPriorRecord();
    noHead();
    const env = signRecordEnvelope(v2Fields(), PRIVATE_KEY);

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result.ok).toBe(true);
    // SignedRecord inserted with the chain fields. The envelope's `collection`
    // is denormalized to the `nsid` column.
    const created = mockSrCreate.mock.calls[0][0][0];
    expect(created).toMatchObject({ seq: 0, prev: null, nsid: 'app.oxy.identity', rkey: 'self', verified: true });
    expect(created.collection).toBeUndefined();
    // recordId matches core's computeRecordId byte-for-byte.
    expect(created.recordId).toBe(await computeRecordId(env));
    // RepoHead advanced to seq 0 with the genesis recordId.
    const [filter, update] = mockHeadUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: USER_ID });
    expect(update.$set).toMatchObject({ seq: 0, headRecordId: await computeRecordId(env) });
    expect(update.$inc).toEqual({ recordCount: 1 });
  });
});

describe('verifyAndStoreRecord — v2 extension', () => {
  it('a second record with correct prev/seq extends the chain and advances the head', async () => {
    const genesisEnv = signRecordEnvelope(v2Fields({ issuedAt: 1_700_000_000_000 }), PRIVATE_KEY);
    const genesisId = await computeRecordId(genesisEnv);

    priorRecord(1_700_000_000_000);
    headAt(genesisId, 0);
    const env = signRecordEnvelope(
      v2Fields({ seq: 1, prev: genesisId, issuedAt: 1_700_000_001_000, record: { bio: 'hi' } }),
      PRIVATE_KEY,
    );

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result.ok).toBe(true);
    const created = mockSrCreate.mock.calls[0][0][0];
    expect(created).toMatchObject({ seq: 1, prev: genesisId });
    const [, update] = mockHeadUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({ seq: 1, headRecordId: await computeRecordId(env) });
  });
});

describe('verifyAndStoreRecord — chain rejections', () => {
  it('rejects a wrong prev with chain_fork (and does not store)', async () => {
    priorRecord(1_700_000_000_000);
    headAt('a'.repeat(64), 0);
    const env = signRecordEnvelope(
      v2Fields({ seq: 1, prev: 'b'.repeat(64), issuedAt: 1_700_000_001_000 }),
      PRIVATE_KEY,
    );

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result).toEqual({ ok: false, reason: 'chain_fork' });
    expect(mockSrCreate).not.toHaveBeenCalled();
    expect(mockHeadUpdate).not.toHaveBeenCalled();
  });

  it('rejects a seq gap (correct prev, wrong seq) with bad_seq', async () => {
    priorRecord(1_700_000_000_000);
    headAt('a'.repeat(64), 0);
    const env = signRecordEnvelope(
      v2Fields({ seq: 5, prev: 'a'.repeat(64), issuedAt: 1_700_000_001_000 }),
      PRIVATE_KEY,
    );

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result).toEqual({ ok: false, reason: 'bad_seq' });
    expect(mockSrCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-genesis record when no head exists with chain_gap', async () => {
    priorRecord(1_700_000_000_000);
    noHead();
    const env = signRecordEnvelope(
      v2Fields({ seq: 1, prev: 'a'.repeat(64), issuedAt: 1_700_000_001_000 }),
      PRIVATE_KEY,
    );

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result).toEqual({ ok: false, reason: 'chain_gap' });
    expect(mockSrCreate).not.toHaveBeenCalled();
  });
});

describe('verifyAndStoreRecord — v1 back-compat', () => {
  it('verifies + stores a v1 record WITHOUT touching the chain', async () => {
    noPriorRecord();
    const env = signRecordEnvelope(
      {
        version: 1,
        type: 'identity',
        subject: buildUserDid(USER_ID),
        issuer: buildUserDid(USER_ID),
        record: { displayName: 'Nate' },
        issuedAt: Date.now(),
        publicKey: PUBLIC_KEY,
        alg: 'ES256K-DER-SHA256',
      },
      PRIVATE_KEY,
    );

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result.ok).toBe(true);
    // v1 create is the single-object form, with NO chain fields.
    const created = mockSrCreate.mock.calls[0][0];
    expect(created.seq).toBeUndefined();
    expect(created.recordId).toBeUndefined();
    expect(created.verified).toBe(true);
    // The chain is never consulted or advanced for v1.
    expect(mockHeadFindOne).not.toHaveBeenCalled();
    expect(mockHeadUpdate).not.toHaveBeenCalled();
  });
});

describe('verifyAndStoreRecord — concurrency backstop', () => {
  it('surfaces a duplicate {userId, seq} (E11000) as chain_conflict', async () => {
    noPriorRecord();
    noHead();
    mockSrCreate.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));
    const env = signRecordEnvelope(v2Fields(), PRIVATE_KEY);

    const result = await verifyAndStoreRecord(env, SUBJECT, USER_ID);

    expect(result).toEqual({ ok: false, reason: 'chain_conflict' });
  });
});
