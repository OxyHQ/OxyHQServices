/**
 * Unit tests for the node registry service (F5a user nodes).
 *
 *  - `materializeNodeFromRecord` upserts the UserNode cache from a verified node
 *    record (endpoint normalised, default mode, status `active`), invalidates the
 *    user cache, and fires a (fire-and-forget) probe; a non-HTTPS / malformed
 *    record skips materialization (returns null, no write).
 *  - `probeLiveness` updates the badge to `active` on a 2xx and to `unreachable`
 *    on a thrown fetch error — and NEVER throws on a dead endpoint.
 *  - `removeNode` flips the row to `revoked` and invalidates the user cache.
 *  - `getUserNode` reads the row.
 *
 * The UserNode model, `safeFetch`, the user cache, and the logger are all mocked
 * — no DB and no network.
 */

const mockFindOneAndUpdate = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockFind = jest.fn();
const mockSafeFetch = jest.fn();
const mockInvalidate = jest.fn();

jest.mock('../../models/UserNode', () => ({
  __esModule: true,
  default: {
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
    find: (...args: unknown[]) => mockFind(...args),
  },
}));

jest.mock('@oxyhq/core/server', () => ({ safeFetch: (...args: unknown[]) => mockSafeFetch(...args) }));
jest.mock('@oxyhq/core', () => ({ signedRecordSigningInput: jest.fn() }));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: jest.fn() },
  default: { findById: jest.fn() },
}));
jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: { signWithKey: jest.fn(), verify: jest.fn() },
}));
jest.mock('../../services/did.service', () => ({
  buildUserDid: jest.fn((id: string) => `did:web:api.oxy.so:u:${id}`),
  OXY_DID: 'did:web:api.oxy.so',
}));
jest.mock('../../services/repoLog.service', () => ({ getHead: jest.fn() }));
jest.mock('../../services/signedRecord.service', () => ({ verifyAndStoreRecord: jest.fn() }));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) } }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import {
  materializeNodeFromRecord,
  probeLiveness,
  removeNode,
  getUserNode,
} from '../nodeRegistry.service';

const USER_ID = '507f1f77bcf86cd799439011';
const NODE_PUBLIC_KEY = 'ab'.repeat(33); // 66-char compressed secp256k1 hex

/** A chainable findOne result supporting both `.select().lean()` and `.lean()`. */
function findOneResult(value: unknown) {
  return {
    select: () => ({ lean: () => Promise.resolve(value) }),
    lean: () => Promise.resolve(value),
  };
}

/** Flush the floating (fire-and-forget) probe so it never logs after a test. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockReturnValue(findOneResult(null)); // probe early-returns by default
  mockFindOneAndUpdate.mockResolvedValue({
    _id: 'node1',
    userId: USER_ID,
    endpoint: 'https://node.example.com',
    nodePublicKey: NODE_PUBLIC_KEY,
    mode: 'pull',
    status: 'active',
  });
  mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockSafeFetch.mockResolvedValue({ status: 200, response: { destroy: jest.fn() }, headers: {}, finalUrl: '' });
});

describe('materializeNodeFromRecord', () => {
  it('upserts the UserNode cache from a verified node record + invalidates the cache', async () => {
    const node = await materializeNodeFromRecord(USER_ID, {
      endpoint: 'https://node.example.com/', // trailing slash normalised away
      nodePublicKey: NODE_PUBLIC_KEY,
      mode: 'push',
      nodeDid: 'did:web:node.example.com',
    });

    expect(node).not.toBeNull();
    const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ userId: USER_ID });
    expect(update.$set).toMatchObject({
      endpoint: 'https://node.example.com',
      nodePublicKey: NODE_PUBLIC_KEY,
      mode: 'push',
      status: 'active',
      nodeDid: 'did:web:node.example.com',
    });
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
    await flushMicrotasks();
  });

  it('defaults mode to pull when the record omits it', async () => {
    await materializeNodeFromRecord(USER_ID, { endpoint: 'https://node.example.com', nodePublicKey: NODE_PUBLIC_KEY });
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set.mode).toBe('pull');
    await flushMicrotasks();
  });

  it('skips materialization for a non-HTTPS endpoint (returns null, no write)', async () => {
    const node = await materializeNodeFromRecord(USER_ID, { endpoint: 'http://node.example.com', nodePublicKey: NODE_PUBLIC_KEY });
    expect(node).toBeNull();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('skips materialization for a malformed record (missing nodePublicKey)', async () => {
    const node = await materializeNodeFromRecord(USER_ID, { endpoint: 'https://node.example.com' });
    expect(node).toBeNull();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('skips materialization for a non-hex node public key', async () => {
    const node = await materializeNodeFromRecord(USER_ID, { endpoint: 'https://node.example.com', nodePublicKey: 'not-hex' });
    expect(node).toBeNull();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('probeLiveness', () => {
  it('marks the node active + records lastSeenAt on a 2xx response', async () => {
    mockFindOne.mockReturnValue(findOneResult({ endpoint: 'https://node.example.com' }));
    const destroy = jest.fn();
    mockSafeFetch.mockResolvedValueOnce({ status: 200, response: { destroy }, headers: {}, finalUrl: '' });

    await probeLiveness(USER_ID);

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://node.example.com/.well-known/oxy-node.json',
      expect.objectContaining({ maxRedirects: 1 }),
    );
    expect(destroy).toHaveBeenCalled();
    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$set).toMatchObject({ status: 'active' });
    expect(update.$set.lastSeenAt).toBeInstanceOf(Date);
  });

  it('marks the node unreachable on a non-2xx response', async () => {
    mockFindOne.mockReturnValue(findOneResult({ endpoint: 'https://node.example.com' }));
    mockSafeFetch.mockResolvedValueOnce({ status: 503, response: { destroy: jest.fn() }, headers: {}, finalUrl: '' });

    await probeLiveness(USER_ID);

    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$set).toMatchObject({ status: 'unreachable' });
    expect(update.$set.lastError).toContain('503');
  });

  it('marks the node unreachable WITHOUT throwing when the fetch fails (dead endpoint)', async () => {
    mockFindOne.mockReturnValue(findOneResult({ endpoint: 'https://down.example.com' }));
    mockSafeFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(probeLiveness(USER_ID)).resolves.toBeUndefined();

    const [, update] = mockUpdateOne.mock.calls[0];
    expect(update.$set).toMatchObject({ status: 'unreachable', lastError: 'ECONNREFUSED' });
  });

  it('no-ops (no fetch) when the user has no non-revoked node', async () => {
    mockFindOne.mockReturnValue(findOneResult(null));
    await probeLiveness(USER_ID);
    expect(mockSafeFetch).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

describe('removeNode', () => {
  it('flips the row to revoked and invalidates the user cache', async () => {
    mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });
    const ok = await removeNode(USER_ID);

    expect(ok).toBe(true);
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toMatchObject({ userId: USER_ID });
    expect(update.$set).toEqual({ status: 'revoked' });
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });

  it('returns false and does not invalidate when nothing changed', async () => {
    mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const ok = await removeNode(USER_ID);
    expect(ok).toBe(false);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

describe('getUserNode', () => {
  it('reads the cached node row', async () => {
    mockFindOne.mockReturnValue(findOneResult({ endpoint: 'https://node.example.com', status: 'active' }));
    const node = await getUserNode(USER_ID);
    expect(node).toMatchObject({ status: 'active', endpoint: 'https://node.example.com' });
  });
});
