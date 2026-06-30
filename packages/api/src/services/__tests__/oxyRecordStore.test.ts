/**
 * Unit tests for the Oxy `RecordStore` adapter — specifically the monotonicity
 * frontier read `latestIssuedAtForKey`.
 *
 * Focus: a v2 envelope whose `collection`/`rkey` are undefined must NOT collapse
 * the Mongo filter to a global-latest comparison across ALL keys. Without the
 * guard, an envelope missing its key would compare against the newest record on
 * ANY key and wrongly reject a valid append on a DIFFERENT key (a replay /
 * rollback false-positive). The guard returns `null` ("no prior record for this
 * key") instead, mirroring the SQLite NodeStore.
 *
 * `SignedRecord` is mocked so we can both stub the returned record AND assert the
 * exact filter the store builds for a well-formed v2 envelope.
 */

import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockSrFindOne = jest.fn();

jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockSrFindOne(...args) },
}));

jest.mock('../../models/RepoHead', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { oxyRecordStore } from '../oxyRecordStore';
import { buildUserDid } from '../did.service';

const USER_ID = '507f1f77bcf86cd799439011';
const SUBJECT = buildUserDid(USER_ID);

type V2Fields = Omit<SignedRecordEnvelope, 'signature' | 'publicKey' | 'alg'>;

function v2Fields(overrides: Partial<V2Fields> = {}): SignedRecordEnvelope {
  return {
    version: 2,
    type: 'identity',
    subject: SUBJECT,
    issuer: SUBJECT,
    record: { displayName: 'Nate' },
    issuedAt: 1_700_000_000_000,
    seq: 0,
    prev: null,
    collection: 'app.oxy.identity',
    rkey: 'self',
    publicKey: 'cafe',
    alg: 'ES256K-DER-SHA256',
    signature: 'sig',
    ...overrides,
  } as SignedRecordEnvelope;
}

/** A prior record with a given issuedAt, returned by the mocked findOne chain. */
function priorRecord(issuedAt: number): void {
  mockSrFindOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve({ envelope: { issuedAt } }) }) });
}

beforeEach(() => {
  mockSrFindOne.mockReset();
});

describe('oxyRecordStore.latestIssuedAtForKey', () => {
  it('queries by the (nsid, rkey) key for a well-formed v2 envelope', async () => {
    priorRecord(1_700_000_000_000);
    const result = await oxyRecordStore.latestIssuedAtForKey(SUBJECT, v2Fields());
    expect(result).toBe(1_700_000_000_000);
    // The filter is scoped to the LOGICAL key — never a global-latest scan.
    expect(mockSrFindOne).toHaveBeenCalledWith({
      userId: { $eq: USER_ID },
      nsid: { $eq: 'app.oxy.identity' },
      rkey: { $eq: 'self' },
    });
  });

  it.each(['collection', 'rkey'] as const)(
    'returns null (no store read) for a v2 envelope missing `%s`',
    async (field) => {
      const env = v2Fields();
      delete (env as Record<string, unknown>)[field];
      const result = await oxyRecordStore.latestIssuedAtForKey(SUBJECT, env);
      expect(result).toBeNull();
      // Crucially, it must NOT issue a global-latest query that could reject a
      // valid append on another key.
      expect(mockSrFindOne).not.toHaveBeenCalled();
    },
  );

  it('returns null when the subject DID does not parse to a userId', async () => {
    const result = await oxyRecordStore.latestIssuedAtForKey('did:web:evil.example', v2Fields());
    expect(result).toBeNull();
    expect(mockSrFindOne).not.toHaveBeenCalled();
  });

  it('queries by `type` for a v1 envelope (singleton monotonicity)', async () => {
    priorRecord(1_699_000_000_000);
    const v1: SignedRecordEnvelope = {
      version: 1,
      type: 'identity',
      subject: SUBJECT,
      issuer: SUBJECT,
      record: { a: 1 },
      issuedAt: 1_699_000_000_000,
      publicKey: 'cafe',
      alg: 'ES256K-DER-SHA256',
      signature: 'sig',
    } as SignedRecordEnvelope;
    const result = await oxyRecordStore.latestIssuedAtForKey(SUBJECT, v1);
    expect(result).toBe(1_699_000_000_000);
    expect(mockSrFindOne).toHaveBeenCalledWith({ userId: { $eq: USER_ID }, type: { $eq: 'identity' } });
  });
});
