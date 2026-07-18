/**
 * Device-to-device identity transfer service (b3 Feature 2 — "add a device").
 *
 * Backs the E2E-encrypted relay in `routes/deviceTransfer.ts`. All model access
 * and the security-critical logic (signature verification, atomic status burn)
 * live here so the route module stays a thin wrapper — and so the flow is unit
 * testable under the api's mocked-mongoose regime (mirrors
 * `authSession.service.ts`).
 *
 * The server NEVER decrypts: it only stores the ephemeral public keys and an
 * opaque ciphertext/nonce and shuttles them between the two devices. The threat
 * model is a PASSIVE / at-rest-compromised relay (DB dump, on-path capture) — a
 * shared transfer key requires an ephemeral PRIVATE key held only by one device,
 * so the stored material is undecryptable server-side. It is explicitly NOT
 * hardened against an actively-malicious backend MITM'ing the ephemeral keys
 * (same trust boundary as the existing QR sign-in; SAS compare deferred).
 */

import crypto from 'crypto';
import { DevicePairingSession } from '../models/DevicePairingSession';
import { User } from '../models/User';
import { SignatureService } from './signature.service';
import { logger } from '../utils/logger';
import type { DeviceTransferInfoResponse, DevicePairingStatus } from '@oxyhq/contracts';

/** Pairing lifetime — deliberately short (single interactive handoff). */
export const DEVICE_TRANSFER_TTL_MS = 3 * 60 * 1000;

/** Max age of the approval signature (freshness against replay). */
const APPROVAL_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The exact bytes the old device signs (and the server reconstructs) to prove
 * possession of the CURRENT identity private key alongside its bearer token.
 * JSON.stringify preserves this key order — it MUST match the client byte-for-byte.
 */
export function buildApprovalSigningMessage(pairingId: string, timestamp: number): string {
  return JSON.stringify({ action: 'approve_device_transfer', pairingId, timestamp });
}

/* -------------------------------------------------------------------------- */
/*  init                                                                       */
/* -------------------------------------------------------------------------- */

export type InitDeviceTransferOutcome =
  | { ok: true; pairingId: string; expiresAt: Date }
  | { ok: false; status: 400; message: string };

/**
 * Register a new pairing from the fresh device's ephemeral public key. Public /
 * unauthenticated — the new device has no identity yet.
 */
export async function initDeviceTransfer(input: {
  newEphPub: string;
  newDeviceLabel?: string;
}): Promise<InitDeviceTransferOutcome> {
  const { newEphPub, newDeviceLabel } = input;

  if (!SignatureService.isValidPublicKey(newEphPub)) {
    return { ok: false, status: 400, message: 'Invalid ephemeral public key' };
  }

  const pairingId = crypto.randomBytes(16).toString('hex'); // 128-bit
  const expiresAt = new Date(Date.now() + DEVICE_TRANSFER_TTL_MS);

  await DevicePairingSession.create({
    pairingId,
    newDeviceEphemeralPublicKey: newEphPub,
    newDeviceLabel: newDeviceLabel ?? null,
    status: 'pending',
    expiresAt,
  });

  return { ok: true, pairingId, expiresAt };
}

/* -------------------------------------------------------------------------- */
/*  info                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a pairing for either device: the old device reads `newEphPub` + label
 * before approving; the new device polls for the sealed material once approved.
 * Public — the QR is not self-contained, so the server is the resolver.
 *
 * Returns `null` when the pairing does not exist (route → 404). Marks a
 * past-TTL pending pairing as `expired` on read (lazy expiry before the TTL
 * sweep). The encrypted material is surfaced ONLY once `status === 'approved'`.
 */
export async function getDeviceTransferInfo(
  pairingId: string,
): Promise<DeviceTransferInfoResponse | null> {
  const session = await DevicePairingSession.findOne({ pairingId });
  if (!session) {
    return null;
  }

  if (session.status === 'pending' && session.expiresAt < new Date()) {
    session.status = 'expired';
    await session.save();
  }

  const approved = session.status === 'approved';
  return {
    pairingId: session.pairingId,
    newDeviceEphemeralPublicKey: session.newDeviceEphemeralPublicKey,
    newDeviceLabel: session.newDeviceLabel ?? null,
    status: session.status as DevicePairingStatus,
    expiresAt: session.expiresAt.toISOString(),
    oldDeviceEphemeralPublicKey: approved ? session.oldDeviceEphemeralPublicKey ?? null : null,
    ciphertext: approved ? session.ciphertext ?? null : null,
    nonce: approved ? session.nonce ?? null : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  approve                                                                    */
/* -------------------------------------------------------------------------- */

export interface ApproveDeviceTransferInput {
  pairingId: string;
  /** Bearer-resolved user id (never client-supplied). */
  authenticatedUserId: string;
  oldEphPub: string;
  ciphertext: string;
  nonce: string;
  signature: string;
  timestamp: number;
}

export type ApproveDeviceTransferOutcome =
  | { ok: true; pairingId: string }
  | { ok: false; status: 400 | 401 | 404 | 409; message: string };

/**
 * Approve a transfer: the bearer-authenticated old device proves possession of
 * the CURRENT identity private key (fresh signature) AND supplies the E2E-sealed
 * key material. The pending->approved transition is ATOMIC so a concurrent
 * approve cannot double-complete; the loser gets 409.
 *
 * Dual-proof rationale: the bearer alone proves account control but NOT key
 * possession — requiring a fresh signature over the current identity key means a
 * stolen bearer token cannot exfiltrate the private key.
 */
export async function approveDeviceTransfer(
  input: ApproveDeviceTransferInput,
): Promise<ApproveDeviceTransferOutcome> {
  const { pairingId, authenticatedUserId, oldEphPub, ciphertext, nonce, signature, timestamp } = input;

  // Freshness FIRST — reject a stale/replayed signature before any DB work.
  if (Date.now() - timestamp > APPROVAL_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, status: 400, message: 'Approval signature has expired' };
  }

  if (!SignatureService.isValidPublicKey(oldEphPub)) {
    return { ok: false, status: 400, message: 'Invalid ephemeral public key' };
  }

  // Resolve the caller's CURRENT identity public key server-side. `publicKey` is
  // `select:false`, so it must be explicitly selected (mirrors the delete flow).
  const user = await User.findById(authenticatedUserId).select('+publicKey');
  if (!user) {
    return { ok: false, status: 404, message: 'User not found' };
  }
  if (!user.publicKey) {
    return { ok: false, status: 400, message: 'Account has no identity key to transfer' };
  }

  // Verify the signature proves control of the CURRENT identity key. A bearer
  // token alone must NOT be able to approve a key clone.
  const message = buildApprovalSigningMessage(pairingId, timestamp);
  if (!SignatureService.verifySignature(message, signature, user.publicKey)) {
    return { ok: false, status: 401, message: 'Invalid approval signature' };
  }

  // Pre-flight read for precise error codes (unknown vs expired vs processed).
  const session = await DevicePairingSession.findOne({ pairingId });
  if (!session) {
    return { ok: false, status: 404, message: 'Pairing not found' };
  }
  if (session.status === 'pending' && session.expiresAt < new Date()) {
    session.status = 'expired';
    await session.save();
    return { ok: false, status: 400, message: 'Pairing has expired' };
  }
  if (session.status !== 'pending') {
    return { ok: false, status: 409, message: 'Pairing already processed' };
  }

  // ATOMIC pending -> approved. Conditioned on status:'pending' + unexpired so
  // two concurrent approves cannot both win; the loser matches nothing.
  const claimed = await DevicePairingSession.findOneAndUpdate(
    { pairingId, status: 'pending', expiresAt: { $gt: new Date() } },
    {
      $set: {
        status: 'approved',
        oldDeviceEphemeralPublicKey: oldEphPub,
        ciphertext,
        nonce,
        approvedByUserId: user._id,
      },
    },
    { new: true },
  );

  if (!claimed) {
    return { ok: false, status: 409, message: 'Pairing not found or already processed' };
  }

  logger.info('Device transfer approved', {
    pairingId: pairingId.substring(0, 8) + '...',
    userId: authenticatedUserId,
  });

  return { ok: true, pairingId };
}

/* -------------------------------------------------------------------------- */
/*  deny                                                                       */
/* -------------------------------------------------------------------------- */

export type DenyDeviceTransferOutcome =
  | { ok: true; status: DevicePairingStatus }
  | { ok: false; status: 404 | 409; message: string };

/**
 * Deny (cancel) a pending transfer so the waiting new device stops. Public — the
 * QR-scanning device cancels without a session. Idempotent for an already-denied
 * pairing; refuses to undo an already-approved one.
 */
export async function denyDeviceTransfer(pairingId: string): Promise<DenyDeviceTransferOutcome> {
  const session = await DevicePairingSession.findOne({ pairingId });
  if (!session) {
    return { ok: false, status: 404, message: 'Pairing not found' };
  }
  if (session.status === 'denied') {
    return { ok: true, status: 'denied' };
  }
  if (session.status !== 'pending') {
    return { ok: false, status: 409, message: `Cannot deny a ${session.status} transfer` };
  }

  const denied = await DevicePairingSession.findOneAndUpdate(
    { pairingId, status: 'pending' },
    { $set: { status: 'denied' } },
    { new: true },
  );
  if (!denied) {
    // Lost the race — someone approved/denied concurrently.
    return { ok: false, status: 409, message: 'Pairing already processed' };
  }

  return { ok: true, status: 'denied' };
}
