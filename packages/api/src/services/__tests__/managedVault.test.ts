/**
 * Unit tests for the F5c managed-vault provisioning flow
 * (`provisionManagedVault` in `nodeRegistry.service`).
 *
 *  - Happy path: Oxy custodial-signs a `type:'node'` record (issuer = OXY_DID,
 *    Oxy custodial public key), stores it via the shared `verifyAndStoreRecord`,
 *    and materializes a `managed:true, controller:'oxy', active` UserNode +
 *    invalidates the user cache.
 *  - Fails closed with a clear reason when the Oxy custodial key is unset, when
 *    the managed-node base URL is unconfigured, and when the user does not exist.
 *  - Idempotent: an existing active managed vault at the same endpoint is a no-op
 *    refresh — no new chain record is signed/stored.
 *  - `removeNode` revokes a managed vault (operator-agnostic teardown signal).
 *
 * The chain/crypto/DB/network dependencies are all mocked — no DB, no network.
 */

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockFindById = jest.fn();
const mockVerifyAndStoreRecord = jest.fn();
const mockGetHead = jest.fn();
const mockSignMessage = jest.fn();
const mockSigningInput = jest.fn();
const mockSafeFetch = jest.fn();
const mockInvalidate = jest.fn();

const OXY_DID = 'did:web:oxy.so';
const USER_ID = '507f1f77bcf86cd799439011';
const OXY_PUBLIC_KEY = 'ab'.repeat(33); // 66-char secp256k1 hex (passes nodeRecordSchema)
const MANAGED_ENDPOINT = `https://nodes.oxy.so/u/${USER_ID}`;

jest.mock('../../models/UserNode', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockFindById(...args) },
  default: { findById: (...args: unknown[]) => mockFindById(...args) },
}));
jest.mock('../../services/signedRecord.service', () => ({
  verifyAndStoreRecord: (...args: unknown[]) => mockVerifyAndStoreRecord(...args),
}));
jest.mock('../../services/repoLog.service', () => ({
  getHead: (...args: unknown[]) => mockGetHead(...args),
}));
jest.mock('../../services/did.service', () => ({
  buildUserDid: (id: string) => `did:web:oxy.so:u:${id}`,
  OXY_DID,
}));
jest.mock('../../services/signature.service', () => ({
  __esModule: true,
  default: { signMessage: (...args: unknown[]) => mockSignMessage(...args) },
}));
jest.mock('@oxyhq/protocol', () => ({ signedRecordSigningInput: (...args: unknown[]) => mockSigningInput(...args) }));
jest.mock('@oxyhq/core/server', () => ({ safeFetch: (...args: unknown[]) => mockSafeFetch(...args) }));
jest.mock('../../utils/userCache', () => ({ __esModule: true, default: { invalidate: (...args: unknown[]) => mockInvalidate(...args) } }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { provisionManagedVault, removeNode } from '../nodeRegistry.service';
import {
  NODE_COLLECTION,
  NODE_RKEY,
} from '../../utils/nodes.constants';

/** A chainable findOne result supporting both `.select().lean()` and `.lean()`. */
function findOneResult(value: unknown) {
  return {
    select: () => ({ lean: () => Promise.resolve(value) }),
    lean: () => Promise.resolve(value),
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

const ENV_KEYS = ['OXY_PRIVATE_KEY', 'OXY_PUBLIC_KEY', 'MANAGED_NODE_BASE_URL', 'MANAGED_NODE_PUBLIC_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OXY_PRIVATE_KEY = 'oxy-private-key';
  process.env.OXY_PUBLIC_KEY = OXY_PUBLIC_KEY;
  process.env.MANAGED_NODE_BASE_URL = 'https://nodes.oxy.so';
  delete process.env.MANAGED_NODE_PUBLIC_KEY;

  mockFindOne.mockReturnValue(findOneResult(null)); // no existing node by default
  mockFindById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: USER_ID }) }) });
  mockGetHead.mockResolvedValue(null); // genesis
  mockSigningInput.mockReturnValue('signing-input');
  mockSignMessage.mockReturnValue('deadbeefsig');
  mockVerifyAndStoreRecord.mockResolvedValue({ ok: true, record: { recordId: 'rec1', seq: 0, envelope: {} } });
  mockFindOneAndUpdate.mockResolvedValue({
    _id: 'node1',
    userId: USER_ID,
    endpoint: MANAGED_ENDPOINT,
    nodePublicKey: OXY_PUBLIC_KEY,
    mode: 'pull',
    managed: true,
    controller: 'oxy',
    status: 'active',
  });
  mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  mockSafeFetch.mockResolvedValue({ status: 200, response: { destroy: jest.fn() }, headers: {}, finalUrl: '' });
});

describe('provisionManagedVault — happy path', () => {
  it('custodial-signs a node record, stores it, and materializes a managed UserNode', async () => {
    const result = await provisionManagedVault(USER_ID);

    expect(result.ok).toBe(true);

    // Signed the canonical signing input with the Oxy custodial PRIVATE key.
    expect(mockSignMessage).toHaveBeenCalledTimes(1);
    expect(mockSignMessage).toHaveBeenCalledWith('signing-input', 'oxy-private-key');

    // The envelope handed to verifyAndStoreRecord is an Oxy-custodial v2 node record.
    expect(mockVerifyAndStoreRecord).toHaveBeenCalledTimes(1);
    const [envelope, subjectUserId] = mockVerifyAndStoreRecord.mock.calls[0];
    expect(envelope).toMatchObject({
      version: 2,
      type: 'node',
      subject: `did:web:oxy.so:u:${USER_ID}`,
      issuer: OXY_DID,
      publicKey: OXY_PUBLIC_KEY,
      alg: 'ES256K-DER-SHA256',
      seq: 0,
      prev: null,
      collection: NODE_COLLECTION,
      rkey: NODE_RKEY,
      signature: 'deadbeefsig',
    });
    expect(envelope.record).toMatchObject({
      endpoint: MANAGED_ENDPOINT,
      nodePublicKey: OXY_PUBLIC_KEY,
      mode: 'pull',
      managed: true,
    });
    // Stored against the subject's chain (the resolver resolves the custodial key).
    expect(subjectUserId).toBe(USER_ID);

    // Materialized as a managed, Oxy-operated, active node.
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({
      endpoint: MANAGED_ENDPOINT,
      nodePublicKey: OXY_PUBLIC_KEY,
      mode: 'pull',
      managed: true,
      controller: 'oxy',
      status: 'active',
    });
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
    await flushMicrotasks();
  });

  it('derives the endpoint from MANAGED_NODE_BASE_URL + /u/<userId> (no hardcoded URL)', async () => {
    process.env.MANAGED_NODE_BASE_URL = 'https://vault.example.org/'; // trailing slash trimmed
    await provisionManagedVault(USER_ID);
    const [envelope] = mockVerifyAndStoreRecord.mock.calls[0];
    expect(envelope.record.endpoint).toBe(`https://vault.example.org/u/${USER_ID}`);
    await flushMicrotasks();
  });
});

describe('provisionManagedVault — fails closed', () => {
  it('returns oxy_key_unconfigured when the Oxy custodial key is unset (no broken vault)', async () => {
    delete process.env.OXY_PRIVATE_KEY;
    const result = await provisionManagedVault(USER_ID);
    expect(result).toEqual({ ok: false, reason: 'oxy_key_unconfigured' });
    expect(mockSignMessage).not.toHaveBeenCalled();
    expect(mockVerifyAndStoreRecord).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns managed_endpoint_unconfigured when MANAGED_NODE_BASE_URL is unset', async () => {
    delete process.env.MANAGED_NODE_BASE_URL;
    const result = await provisionManagedVault(USER_ID);
    expect(result).toEqual({ ok: false, reason: 'managed_endpoint_unconfigured' });
    expect(mockVerifyAndStoreRecord).not.toHaveBeenCalled();
  });

  it('returns managed_endpoint_unconfigured for a non-HTTPS managed base URL', async () => {
    process.env.MANAGED_NODE_BASE_URL = 'http://nodes.oxy.so';
    const result = await provisionManagedVault(USER_ID);
    expect(result).toEqual({ ok: false, reason: 'managed_endpoint_unconfigured' });
  });

  it('returns user_not_found when the user does not exist', async () => {
    mockFindById.mockReturnValueOnce({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const result = await provisionManagedVault(USER_ID);
    expect(result).toEqual({ ok: false, reason: 'user_not_found' });
    expect(mockVerifyAndStoreRecord).not.toHaveBeenCalled();
  });

  it('returns provision_failed when the chain rejects the record for a hard reason', async () => {
    mockVerifyAndStoreRecord.mockResolvedValueOnce({ ok: false, reason: 'subject_mismatch' });
    const result = await provisionManagedVault(USER_ID);
    expect(result).toEqual({ ok: false, reason: 'provision_failed' });
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('provisionManagedVault — idempotent re-provision', () => {
  it('refreshes an existing active managed vault without signing a new chain record', async () => {
    const existing = {
      userId: USER_ID,
      endpoint: MANAGED_ENDPOINT,
      nodePublicKey: OXY_PUBLIC_KEY,
      mode: 'pull',
      managed: true,
      controller: 'oxy',
      status: 'active',
    };
    mockFindOne.mockReturnValue(findOneResult(existing));

    const result = await provisionManagedVault(USER_ID);

    expect(result).toEqual({ ok: true, node: existing });
    // No new chain record, no re-materialization.
    expect(mockSignMessage).not.toHaveBeenCalled();
    expect(mockVerifyAndStoreRecord).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    // Still refreshes the cache + re-probes.
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
    await flushMicrotasks();
  });

  it('does NOT treat a self-hosted node as an existing managed vault (re-provisions)', async () => {
    mockFindOne.mockReturnValue(
      findOneResult({ endpoint: MANAGED_ENDPOINT, managed: false, controller: 'self', status: 'active' }),
    );
    const result = await provisionManagedVault(USER_ID);
    expect(result.ok).toBe(true);
    expect(mockVerifyAndStoreRecord).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
  });
});

describe('removeNode — managed teardown signal', () => {
  it('revokes a managed vault (operator-agnostic) and invalidates the cache', async () => {
    mockUpdateOne.mockResolvedValueOnce({ modifiedCount: 1 });
    const ok = await removeNode(USER_ID);
    expect(ok).toBe(true);
    const [filter, update] = mockUpdateOne.mock.calls[0];
    expect(filter).toMatchObject({ userId: USER_ID, status: { $ne: 'revoked' } });
    expect(update.$set).toEqual({ status: 'revoked' });
    expect(mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });
});
