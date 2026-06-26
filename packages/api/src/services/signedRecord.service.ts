/**
 * Signed Record Service (self-sovereign identity layer — B5)
 *
 * Verifies and persists the signed-record envelopes a user publishes about their
 * own identity/profile. The signing scheme is shared byte-for-byte with the
 * client (the Commons vault) via the canonical-JSON serializer imported from
 * `@oxyhq/core` — both sides canonicalize every envelope field EXCEPT
 * `publicKey` and `signature`, then sign/verify a secp256k1 DER signature over
 * the SHA-256 of those bytes (`alg: ES256K-DER-SHA256`).
 *
 * Verification asserts FOUR things before a record is stored as `verified`:
 *  1. envelope shape (against `signedRecordEnvelopeSchema`),
 *  2. the signature is valid for the canonical signing input,
 *  3. `publicKey` is a CURRENT verification method of the subject account
 *     (its primary key or an `identity` auth-method key),
 *  4. `issuedAt` is fresh (not in the future beyond clock skew) and strictly
 *     monotonic vs. the latest stored record of the same type (replay/rollback
 *     defence).
 */

import { signedRecordSigningInput } from '@oxyhq/core';
import { signedRecordEnvelopeSchema, type SignedRecordEnvelope } from '@oxyhq/contracts';
import SignatureService from './signature.service';
import { buildUserDid } from './did.service';
import SignedRecord, { type ISignedRecord } from '../models/SignedRecord';

/** Tolerated forward clock skew for a record's `issuedAt` (5 minutes). */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Minimal subject-account shape needed to validate verification methods. */
export interface SignedRecordSubject {
  publicKey?: string | null;
  authMethods?: Array<{ type?: string | null; metadata?: { publicKey?: string | null } | null } | null> | null;
}

/** Reasons an envelope can fail verification (stable, machine-readable). */
export type EnvelopeRejectionReason =
  | 'invalid_envelope'
  | 'subject_mismatch'
  | 'public_key_not_a_current_verification_method'
  | 'bad_signature'
  | 'issued_in_future'
  | 'stale_issued_at';

export type EnvelopeVerification =
  | { ok: true }
  | { ok: false; reason: EnvelopeRejectionReason };

/**
 * True when `signature` is a valid secp256k1 signature of the canonical input.
 *
 * The signing input is computed by `signedRecordSigningInput` from
 * `@oxyhq/core` — the SINGLE shared definition of what the signature covers
 * (`{version, type, subject, issuer, record, issuedAt}`, NOT `alg`/`publicKey`/
 * `signature`). The client (Commons vault) signs with the same function, so a
 * record signed by a client and verified here cannot drift.
 */
export function verifyEnvelopeSignature(env: SignedRecordEnvelope): boolean {
  return SignatureService.verifySignature(signedRecordSigningInput(env), env.signature, env.publicKey);
}

/** True when `publicKey` is the subject's primary key or an `identity` auth-method key. */
export function isCurrentVerificationMethod(subject: SignedRecordSubject, publicKey: string): boolean {
  if (subject.publicKey && subject.publicKey === publicKey) {
    return true;
  }
  return (subject.authMethods ?? []).some(
    (method) => method?.type === 'identity' && method.metadata?.publicKey === publicKey,
  );
}

/**
 * Build and sign a record envelope with a secp256k1 private key. Used by tests
 * to forge a valid client signature and (server-side) for custodial provenance
 * attestations. The returned envelope verifies against {@link verifyEnvelopeSignature}.
 */
export function signRecordEnvelope(
  fields: Omit<SignedRecordEnvelope, 'signature'>,
  privateKeyHex: string,
): SignedRecordEnvelope {
  const signature = SignatureService.signMessage(signedRecordSigningInput(fields), privateKeyHex);
  return { ...fields, signature };
}

/**
 * Full verification of an envelope for a given subject account. Performs the
 * shape, signature, current-verification-method, freshness, and monotonicity
 * checks. The monotonic check queries the latest stored record of the same type.
 */
export async function verifyEnvelope(
  env: SignedRecordEnvelope,
  subject: SignedRecordSubject,
  subjectUserId: string,
): Promise<EnvelopeVerification> {
  const parsed = signedRecordEnvelopeSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_envelope' };
  }

  if (env.subject !== buildUserDid(subjectUserId)) {
    return { ok: false, reason: 'subject_mismatch' };
  }

  if (!isCurrentVerificationMethod(subject, env.publicKey)) {
    return { ok: false, reason: 'public_key_not_a_current_verification_method' };
  }

  if (!verifyEnvelopeSignature(env)) {
    return { ok: false, reason: 'bad_signature' };
  }

  if (env.issuedAt > Date.now() + CLOCK_SKEW_MS) {
    return { ok: false, reason: 'issued_in_future' };
  }

  const latest = await SignedRecord.findOne({ userId: subjectUserId, type: env.type })
    .sort({ createdAt: -1 })
    .lean();
  const latestIssuedAt = latest?.envelope?.issuedAt;
  if (typeof latestIssuedAt === 'number' && env.issuedAt <= latestIssuedAt) {
    return { ok: false, reason: 'stale_issued_at' };
  }

  return { ok: true };
}

/**
 * Verify an envelope and append it to the ledger as `verified: true`. Throws no
 * errors — returns the verification verdict so the route maps it to a 4xx. On
 * success the stored {@link ISignedRecord} is returned.
 */
export async function verifyAndStoreRecord(
  env: SignedRecordEnvelope,
  subject: SignedRecordSubject,
  subjectUserId: string,
): Promise<{ ok: true; record: ISignedRecord } | { ok: false; reason: EnvelopeRejectionReason }> {
  const verification = await verifyEnvelope(env, subject, subjectUserId);
  if (!verification.ok) {
    return verification;
  }

  const record = await SignedRecord.create({
    subjectDid: env.subject,
    userId: subjectUserId,
    type: env.type,
    envelope: env,
    publicKey: env.publicKey,
    verified: true,
  });

  return { ok: true, record };
}

/** Latest stored record of `type` for a user, or null. */
export async function getLatestRecord(userId: string, type: 'identity' | 'profile'): Promise<ISignedRecord | null> {
  return SignedRecord.findOne({ userId, type }).sort({ createdAt: -1 }).lean<ISignedRecord | null>();
}
