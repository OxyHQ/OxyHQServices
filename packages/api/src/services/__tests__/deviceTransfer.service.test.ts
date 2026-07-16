/**
 * deviceTransfer.service tests (b3 Feature 2 — device-to-device identity transfer).
 *
 * The relay is E2E-encrypted; the server-side logic under test is the
 * SECURITY-CRITICAL half:
 *   - init validates the ephemeral public key and stamps a short TTL.
 *   - info marks a past-TTL pairing `expired` on read and only surfaces the
 *     sealed material once approved.
 *   - approve requires a FRESH signature over
 *     `{ action:'approve_device_transfer', pairingId, timestamp }` made with the
 *     caller's CURRENT identity key (a bearer alone must not exfiltrate the key),
 *     and the pending->approved transition is ATOMIC (loser gets 409).
 *
 * Real `SignatureService` (secp256k1) is used so signature acceptance/rejection
 * is genuine; the Mongoose models are mocked (api tests mock mongoose globally).
 */

import { ec as EC } from 'elliptic';

const mockPairingFindOne = jest.fn();
const mockPairingFindOneAndUpdate = jest.fn();
const mockPairingCreate = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('../../models/DevicePairingSession', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockPairingFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockPairingFindOneAndUpdate(...args),
    create: (...args: unknown[]) => mockPairingCreate(...args),
  },
  DevicePairingSession: {
    findOne: (...args: unknown[]) => mockPairingFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockPairingFindOneAndUpdate(...args),
    create: (...args: unknown[]) => mockPairingCreate(...args),
  },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...args: unknown[]) => mockUserFindById(...args) },
  default: { findById: (...args: unknown[]) => mockUserFindById(...args) },
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  initDeviceTransfer,
  getDeviceTransferInfo,
  approveDeviceTransfer,
  denyDeviceTransfer,
  buildApprovalSigningMessage,
} from '../deviceTransfer.service';
import { SignatureService } from '../signature.service';

const ec = new EC('secp256k1');
const PAIRING_ID = 'a'.repeat(32);

// A stable identity keypair for the caller (the CURRENT key it must sign with).
const identityKey = ec.genKeyPair();
const identityPriv = identityKey.getPrivate('hex');
const identityPub = identityKey.getPublic('hex');
// A valid single-use ephemeral public key the old device supplies.
const oldEphPub = ec.genKeyPair().getPublic('hex');

/** Chainable `User.findById(id).select('+publicKey')` mock. */
function userWithPublicKey(publicKey: string | undefined) {
  return { select: () => Promise.resolve(publicKey === undefined ? { _id: 'u1' } : { _id: 'u1', publicKey }) };
}

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    pairingId: PAIRING_ID,
    newDeviceEphemeralPublicKey: 'newpub',
    newDeviceLabel: 'New iPhone',
    status: 'pending' as string,
    expiresAt: new Date(Date.now() + 60_000),
    oldDeviceEphemeralPublicKey: null as string | null,
    ciphertext: null as string | null,
    nonce: null as string | null,
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function signApproval(privateKey: string, timestamp: number): string {
  return SignatureService.signMessage(buildApprovalSigningMessage(PAIRING_ID, timestamp), privateKey);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('initDeviceTransfer', () => {
  it('creates a pairing with a short TTL and a 128-bit id', async () => {
    mockPairingCreate.mockResolvedValueOnce({});
    const before = Date.now();

    const outcome = await initDeviceTransfer({ newEphPub: oldEphPub, newDeviceLabel: 'iPad' });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.pairingId).toMatch(/^[0-9a-f]{32}$/);
    // 3-minute TTL (allow a little slack for the clock).
    const ttl = outcome.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(150_000);
    expect(ttl).toBeLessThanOrEqual(180_000 + 1000);
    expect(mockPairingCreate).toHaveBeenCalledWith(
      expect.objectContaining({ newDeviceEphemeralPublicKey: oldEphPub, newDeviceLabel: 'iPad', status: 'pending' }),
    );
  });

  it('rejects an invalid ephemeral public key WITHOUT writing', async () => {
    const outcome = await initDeviceTransfer({ newEphPub: 'not-a-key' });
    expect(outcome).toEqual({ ok: false, status: 400, message: 'Invalid ephemeral public key' });
    expect(mockPairingCreate).not.toHaveBeenCalled();
  });
});

describe('getDeviceTransferInfo', () => {
  it('returns null for an unknown pairing', async () => {
    mockPairingFindOne.mockResolvedValueOnce(null);
    expect(await getDeviceTransferInfo(PAIRING_ID)).toBeNull();
  });

  it('marks a past-TTL pending pairing expired on read (lazy expiry)', async () => {
    const row = pendingRow({ expiresAt: new Date(Date.now() - 1000) });
    mockPairingFindOne.mockResolvedValueOnce(row);

    const info = await getDeviceTransferInfo(PAIRING_ID);

    expect(row.status).toBe('expired');
    expect(row.save).toHaveBeenCalledTimes(1);
    expect(info?.status).toBe('expired');
    // Never leak material for a non-approved pairing.
    expect(info?.ciphertext).toBeNull();
    expect(info?.oldDeviceEphemeralPublicKey).toBeNull();
  });

  it('surfaces the sealed material ONLY once approved', async () => {
    mockPairingFindOne.mockResolvedValueOnce(
      pendingRow({ status: 'approved', oldDeviceEphemeralPublicKey: oldEphPub, ciphertext: 'ct', nonce: 'nn' }),
    );

    const info = await getDeviceTransferInfo(PAIRING_ID);

    expect(info?.status).toBe('approved');
    expect(info?.ciphertext).toBe('ct');
    expect(info?.nonce).toBe('nn');
    expect(info?.oldDeviceEphemeralPublicKey).toBe(oldEphPub);
  });
});

describe('approveDeviceTransfer', () => {
  function baseInput(over: Record<string, unknown> = {}) {
    const timestamp = Date.now();
    return {
      pairingId: PAIRING_ID,
      authenticatedUserId: 'u1',
      oldEphPub,
      ciphertext: 'ff'.repeat(20),
      nonce: '00'.repeat(24),
      signature: signApproval(identityPriv, timestamp),
      timestamp,
      ...over,
    };
  }

  it('accepts a valid signature and ATOMICALLY seals the material', async () => {
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(identityPub));
    mockPairingFindOne.mockResolvedValueOnce(pendingRow());
    mockPairingFindOneAndUpdate.mockResolvedValueOnce(pendingRow({ status: 'approved' }));

    const outcome = await approveDeviceTransfer(baseInput());

    expect(outcome).toEqual({ ok: true, pairingId: PAIRING_ID });
    expect(mockPairingFindOneAndUpdate).toHaveBeenCalledWith(
      { pairingId: PAIRING_ID, status: 'pending', expiresAt: { $gt: expect.any(Date) } },
      {
        $set: expect.objectContaining({
          status: 'approved',
          oldDeviceEphemeralPublicKey: oldEphPub,
          ciphertext: 'ff'.repeat(20),
          nonce: '00'.repeat(24),
        }),
      },
      { new: true },
    );
  });

  it('rejects a signature NOT matching the caller current publicKey (401) before any pairing read', async () => {
    // Sign with a DIFFERENT key than the account's registered publicKey.
    const attackerPriv = ec.genKeyPair().getPrivate('hex');
    const timestamp = Date.now();
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(identityPub));

    const outcome = await approveDeviceTransfer(baseInput({ signature: signApproval(attackerPriv, timestamp), timestamp }));

    expect(outcome).toEqual({ ok: false, status: 401, message: 'Invalid approval signature' });
    // Never touched the pairing — signature is the gate.
    expect(mockPairingFindOne).not.toHaveBeenCalled();
    expect(mockPairingFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a stale signature (400) before any DB work', async () => {
    const staleTs = Date.now() - 6 * 60 * 1000;
    const outcome = await approveDeviceTransfer(baseInput({ signature: signApproval(identityPriv, staleTs), timestamp: staleTs }));

    expect(outcome).toEqual({ ok: false, status: 400, message: 'Approval signature has expired' });
    expect(mockUserFindById).not.toHaveBeenCalled();
  });

  it('rejects when the account has no identity key (400)', async () => {
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(undefined));
    const outcome = await approveDeviceTransfer(baseInput());
    expect(outcome).toEqual({ ok: false, status: 400, message: 'Account has no identity key to transfer' });
  });

  it('rejects an already-approved pairing (409) WITHOUT the atomic update', async () => {
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(identityPub));
    mockPairingFindOne.mockResolvedValueOnce(pendingRow({ status: 'approved' }));

    const outcome = await approveDeviceTransfer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 409, message: 'Pairing already processed' });
    expect(mockPairingFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('expires a past-TTL pairing on approve (400) WITHOUT the atomic update', async () => {
    const row = pendingRow({ expiresAt: new Date(Date.now() - 1000) });
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(identityPub));
    mockPairingFindOne.mockResolvedValueOnce(row);

    const outcome = await approveDeviceTransfer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 400, message: 'Pairing has expired' });
    expect(row.status).toBe('expired');
    expect(row.save).toHaveBeenCalledTimes(1);
    expect(mockPairingFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects the LOSER of a concurrent approve (409) when the atomic burn matches nothing', async () => {
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(identityPub));
    mockPairingFindOne.mockResolvedValueOnce(pendingRow());
    mockPairingFindOneAndUpdate.mockResolvedValueOnce(null); // a concurrent approve already won

    const outcome = await approveDeviceTransfer(baseInput());

    expect(outcome).toEqual({ ok: false, status: 409, message: 'Pairing not found or already processed' });
  });

  it('returns 404 for an unknown pairing (after a valid signature)', async () => {
    mockUserFindById.mockReturnValueOnce(userWithPublicKey(identityPub));
    mockPairingFindOne.mockResolvedValueOnce(null);

    const outcome = await approveDeviceTransfer(baseInput());
    expect(outcome).toEqual({ ok: false, status: 404, message: 'Pairing not found' });
  });

  it('rejects an invalid ephemeral public key (400)', async () => {
    const outcome = await approveDeviceTransfer(baseInput({ oldEphPub: 'nope' }));
    expect(outcome).toEqual({ ok: false, status: 400, message: 'Invalid ephemeral public key' });
    expect(mockUserFindById).not.toHaveBeenCalled();
  });
});

describe('denyDeviceTransfer', () => {
  it('cancels a pending pairing', async () => {
    mockPairingFindOne.mockResolvedValueOnce(pendingRow());
    mockPairingFindOneAndUpdate.mockResolvedValueOnce(pendingRow({ status: 'denied' }));

    const outcome = await denyDeviceTransfer(PAIRING_ID);
    expect(outcome).toEqual({ ok: true, status: 'denied' });
  });

  it('is idempotent for an already-denied pairing', async () => {
    mockPairingFindOne.mockResolvedValueOnce(pendingRow({ status: 'denied' }));
    const outcome = await denyDeviceTransfer(PAIRING_ID);
    expect(outcome).toEqual({ ok: true, status: 'denied' });
    expect(mockPairingFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to deny an already-approved pairing (409)', async () => {
    mockPairingFindOne.mockResolvedValueOnce(pendingRow({ status: 'approved' }));
    const outcome = await denyDeviceTransfer(PAIRING_ID);
    expect(outcome).toEqual({ ok: false, status: 409, message: 'Cannot deny a approved transfer' });
  });

  it('returns 404 for an unknown pairing', async () => {
    mockPairingFindOne.mockResolvedValueOnce(null);
    const outcome = await denyDeviceTransfer(PAIRING_ID);
    expect(outcome).toEqual({ ok: false, status: 404, message: 'Pairing not found' });
  });
});
