/**
 * Unit tests for the node-sync ingest service (F5b node → Oxy).
 *
 * `ingestFromNode` pulls a user's authentic signed chain back from their node
 * (over a mocked `safeFetch`) and mirrors it into Oxy's local store. These tests
 * lock the trust + conflict model:
 *
 *  - verifies + appends new records, advances the cursor, counter-signs a witness;
 *  - rejects a forged record (publicKey not a current verification method);
 *  - LWW keeps the higher-`issuedAt` record on conflict (skips the loser);
 *  - a genuine fork stores both branches + advances the materialized head;
 *  - the counter-sign witness is produced — and skipped cleanly when the OXY key
 *    is unset (ingest still proceeds);
 *  - a dead/unreachable node leaves the cache stale WITHOUT throwing.
 *
 * Every model, `safeFetch`, the signature/verify services, the user cache, and
 * the logger are mocked — no DB and no network. `@oxyhq/contracts`' real envelope
 * schema is used so crafted envelopes must be genuinely well-formed.
 */

import { Readable } from 'stream';

const mockSafeFetch = jest.fn();
const mockVerifyAndStore = jest.fn();
const mockGetHead = jest.fn();
const mockSignMessage = jest.fn();
const mockUserNodeFindOne = jest.fn();
const mockUserNodeUpdateOne = jest.fn();
const mockSignedRecordFindOne = jest.fn();
const mockSignedRecordCreate = jest.fn();
const mockWitnessCreate = jest.fn();
const mockUserFindById = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('@oxyhq/core/server', () => ({ safeFetch: (...a: unknown[]) => mockSafeFetch(...a) }));
jest.mock('@oxyhq/core', () => ({
  canonicalize: (v: unknown) => JSON.stringify(v),
  computeRecordId: async (env: { seq?: number }) => `rid-${env.seq}`,
}));
jest.mock('../signedRecord.service', () => ({
  verifyAndStoreRecord: (...a: unknown[]) => mockVerifyAndStore(...a),
}));
jest.mock('../repoLog.service', () => ({ getHead: (...a: unknown[]) => mockGetHead(...a) }));
jest.mock('../signature.service', () => ({
  __esModule: true,
  default: { signMessage: (...a: unknown[]) => mockSignMessage(...a) },
}));
jest.mock('../../models/UserNode', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockUserNodeFindOne(...a),
    updateOne: (...a: unknown[]) => mockUserNodeUpdateOne(...a),
  },
}));
jest.mock('../../models/SignedRecord', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockSignedRecordFindOne(...a),
    create: (...a: unknown[]) => mockSignedRecordCreate(...a),
  },
}));
jest.mock('../../models/NodeIngestWitness', () => ({
  __esModule: true,
  default: { create: (...a: unknown[]) => mockWitnessCreate(...a) },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...a: unknown[]) => mockUserFindById(...a) },
  default: { findById: (...a: unknown[]) => mockUserFindById(...a) },
}));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: (...a: unknown[]) => mockInvalidate(...a) } }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { ingestFromNode } from '../nodeSync.service';

const USER_ID = '507f1f77bcf86cd799439011';
const SUBJECT_DID = `did:web:oxy.so:u:${USER_ID}`;
const PUBLIC_KEY = 'ab'.repeat(33);

/** A well-formed v2 envelope that passes the real contract schema. */
function envelope(seq: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    type: 'identity',
    subject: SUBJECT_DID,
    issuer: SUBJECT_DID,
    record: { v: seq },
    issuedAt: 1_700_000_000_000 + seq,
    seq,
    prev: seq === 0 ? null : `p${seq}`.padEnd(64, '0'),
    collection: 'app.oxy.identity',
    rkey: 'self',
    publicKey: PUBLIC_KEY,
    alg: 'ES256K-DER-SHA256',
    signature: 'deadbeef',
    ...overrides,
  };
}

/** A `safeFetch` result whose body streams `obj` as JSON. */
function jsonResult(obj: unknown, status = 200) {
  return { status, response: Readable.from([Buffer.from(JSON.stringify(obj))]), headers: {}, finalUrl: '' };
}

/** Chainable `.select().lean()`. */
function selectLean(value: unknown) {
  return { select: () => ({ lean: () => Promise.resolve(value) }) };
}
/** Chainable `.sort().lean()`. */
function sortLean(value: unknown) {
  return { sort: () => ({ lean: () => Promise.resolve(value) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OXY_PRIVATE_KEY = 'aa'.repeat(32);
  process.env.OXY_PUBLIC_KEY = PUBLIC_KEY;

  mockUserNodeFindOne.mockReturnValue(selectLean({ endpoint: 'https://node.example.com', cursor: undefined }));
  mockUserFindById.mockReturnValue(selectLean({ publicKey: PUBLIC_KEY, authMethods: [] }));
  mockGetHead.mockResolvedValue(null); // local head -1
  mockUserNodeUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockSignedRecordFindOne.mockReturnValue(sortLean(null));
  mockSignedRecordCreate.mockResolvedValue({});
  mockWitnessCreate.mockResolvedValue({});
  mockSignMessage.mockReturnValue('witness-sig');
  mockVerifyAndStore.mockImplementation(async (env: { seq?: number }) => ({
    ok: true,
    record: { recordId: `rid-${env.seq}`, seq: env.seq },
  }));
});

afterEach(() => {
  delete process.env.OXY_PRIVATE_KEY;
  delete process.env.OXY_PUBLIC_KEY;
});

describe('ingestFromNode — happy path', () => {
  it('verifies + appends new records, advances the cursor, counter-signs, invalidates cache', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResult({ seq: 2 })) // /oxy/head
      .mockResolvedValueOnce(jsonResult({ records: [envelope(0), envelope(1), envelope(2)] })); // /oxy/log

    await ingestFromNode(USER_ID);

    // Head then log, both via safeFetch (SSRF-safe) — never a raw fetch.
    expect(mockSafeFetch).toHaveBeenNthCalledWith(1, 'https://node.example.com/oxy/head', expect.objectContaining({ maxRedirects: 1 }));
    expect(mockSafeFetch.mock.calls[1][0]).toContain('https://node.example.com/oxy/log?since=-1&limit=100');

    expect(mockVerifyAndStore).toHaveBeenCalledTimes(3);
    expect(mockWitnessCreate).toHaveBeenCalledTimes(3); // one counter-sign per record

    // Cursor advanced to the node head (2) + lastSyncedAt stamped + error cleared.
    const lastUpdate = mockUserNodeUpdateOne.mock.calls.at(-1);
    expect(lastUpdate?.[1].$set).toMatchObject({ cursor: 2 });
    expect(lastUpdate?.[1].$set.lastSyncedAt).toBeInstanceOf(Date);
    expect(lastUpdate?.[1].$unset).toEqual({ lastError: '' });

    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });

  it('is a caught-up no-op (no log fetch) when the node head is not ahead', async () => {
    mockGetHead.mockResolvedValueOnce({ seq: 5, headRecordId: 'h', recordCount: 6 });
    mockSafeFetch.mockResolvedValueOnce(jsonResult({ seq: 5 })); // head only

    await ingestFromNode(USER_ID);

    expect(mockSafeFetch).toHaveBeenCalledTimes(1); // only /oxy/head
    expect(mockVerifyAndStore).not.toHaveBeenCalled();
    const update = mockUserNodeUpdateOne.mock.calls[0];
    expect(update[1].$set).toMatchObject({ cursor: 5 });
    expect(update[1].$set.lastSyncedAt).toBeInstanceOf(Date);
  });
});

describe('ingestFromNode — forged record rejection', () => {
  it('rejects a record whose publicKey is not a current verification method', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResult({ seq: 0 }))
      .mockResolvedValueOnce(jsonResult({ records: [envelope(0)] }));
    mockVerifyAndStore.mockResolvedValueOnce({ ok: false, reason: 'public_key_not_a_current_verification_method' });

    await ingestFromNode(USER_ID);

    expect(mockSignedRecordCreate).not.toHaveBeenCalled(); // not appended
    expect(mockWitnessCreate).not.toHaveBeenCalled(); // not witnessed
    expect(mockInvalidate).not.toHaveBeenCalled(); // nothing changed
    const update = mockUserNodeUpdateOne.mock.calls[0];
    expect(update[1].$set.lastError).toContain('rejected:public_key_not_a_current_verification_method');
  });
});

describe('ingestFromNode — last-writer-wins', () => {
  it('keeps the existing higher-issuedAt record and skips the incoming loser', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResult({ seq: 1 }))
      .mockResolvedValueOnce(jsonResult({ records: [envelope(1)] }));
    mockVerifyAndStore.mockResolvedValueOnce({ ok: false, reason: 'stale_issued_at' });
    // Existing materialized value for the key has a STRICTLY higher issuedAt.
    mockSignedRecordFindOne.mockReturnValueOnce(
      sortLean({ recordId: 'rid-existing', envelope: { issuedAt: 1_700_000_000_999 } }),
    );

    await ingestFromNode(USER_ID);

    expect(mockSignedRecordCreate).not.toHaveBeenCalled(); // incoming loser NOT stored
    expect(mockWitnessCreate).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    // Clean stop (skip) → cursor stamped, lastError cleared.
    expect(mockUserNodeUpdateOne.mock.calls[0][1].$unset).toEqual({ lastError: '' });
  });
});

describe('ingestFromNode — fork', () => {
  it('stores both branches (fork archived off-chain) and advances the materialized head', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResult({ seq: 2 }))
      .mockResolvedValueOnce(jsonResult({ records: [envelope(2)] }));
    mockVerifyAndStore.mockResolvedValueOnce({ ok: false, reason: 'chain_fork' });

    await ingestFromNode(USER_ID);

    // The fork branch is preserved append-only as a NON-chained mirror row
    // (no seq → the unique chain index is untouched; both branches persist).
    expect(mockSignedRecordCreate).toHaveBeenCalledTimes(1);
    const created = mockSignedRecordCreate.mock.calls[0][0];
    expect(created.seq).toBeUndefined();
    expect(created.verified).toBe(true);
    expect(created.recordId).toBe('rid-2');
    expect(created.nsid).toBe('app.oxy.identity');

    expect(mockWitnessCreate).toHaveBeenCalledTimes(1); // fork also counter-signed
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
    expect(mockUserNodeUpdateOne.mock.calls[0][1].$set.lastError).toBe('chain_fork');
  });
});

describe('ingestFromNode — counter-sign witness', () => {
  it('produces a witness signed with the OXY custodial key over {recordId,userId,ingestedAt}', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResult({ seq: 0 }))
      .mockResolvedValueOnce(jsonResult({ records: [envelope(0)] }));

    await ingestFromNode(USER_ID);

    expect(mockSignMessage).toHaveBeenCalledTimes(1);
    // The signed message is the canonical JSON of the witness binding.
    expect(mockSignMessage.mock.calls[0][0]).toContain('rid-0');
    const witness = mockWitnessCreate.mock.calls[0][0];
    expect(witness).toMatchObject({ userId: USER_ID, recordId: 'rid-0', witnessSignature: 'witness-sig' });
    expect(typeof witness.ingestedAt).toBe('number');
  });

  it('skips witnessing cleanly when the OXY key is unset, but still ingests', async () => {
    delete process.env.OXY_PRIVATE_KEY;
    delete process.env.OXY_PUBLIC_KEY;
    mockSafeFetch
      .mockResolvedValueOnce(jsonResult({ seq: 0 }))
      .mockResolvedValueOnce(jsonResult({ records: [envelope(0)] }));

    await ingestFromNode(USER_ID);

    expect(mockSignMessage).not.toHaveBeenCalled();
    expect(mockWitnessCreate).not.toHaveBeenCalled();
    // Ingest still happened: the record was verified+stored and the cursor moved.
    expect(mockVerifyAndStore).toHaveBeenCalledTimes(1);
    expect(mockUserNodeUpdateOne.mock.calls[0][1].$set).toMatchObject({ cursor: 0 });
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });
});

describe('ingestFromNode — resilience', () => {
  it('leaves state stale WITHOUT throwing when the node is unreachable', async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(ingestFromNode(USER_ID)).resolves.toBeUndefined();

    expect(mockVerifyAndStore).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(mockUserNodeUpdateOne.mock.calls[0][1].$set.lastError).toContain('ECONNREFUSED');
  });

  it('no-ops when the user has no registered node', async () => {
    mockUserNodeFindOne.mockReturnValueOnce(selectLean(null));

    await ingestFromNode(USER_ID);

    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockUserNodeUpdateOne).not.toHaveBeenCalled();
  });
});
