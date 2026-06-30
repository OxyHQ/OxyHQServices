/**
 * Signed Record Service — the thin Oxy ADAPTER over the @oxyhq/protocol chain
 * engine (self-sovereign identity layer — B5; F0.2 hash chain).
 *
 * The verification + continuity + append state machine now lives, app-agnostic,
 * in `@oxyhq/protocol` (`verifyAndAppend`). This module is only the Oxy-specific
 * glue around it:
 *
 *  - the {@link oxyRecordStore} (the protocol `RecordStore` over Mongo
 *    `SignedRecord`/`RepoHead`) and {@link oxyVerificationResolver} (the Oxy
 *    authorization policy: current VMs + the `OXY_DID` custodial issuer) are
 *    injected into the engine;
 *  - the `subject_mismatch` binding (the caller may only write to their OWN
 *    chain) and the Oxy STORE strictness gate (only the closed
 *    `oxySignedRecordTypeSchema` set may land on the Oxy chain) are applied here,
 *    around the engine, because they are Oxy policy, not protocol grammar.
 *
 * The protocol engine guarantees the same ordered checks (signature, issuer
 * authorization, freshness, monotonicity, chain continuity) and the same
 * rejection-reason strings the API returned before the extraction, so responses
 * are unchanged.
 */

import { signedRecordSigningInput } from '@oxyhq/protocol';
import { verifyAndAppend, verifyEnvelope as protocolVerifyEnvelope, type RejectionReason, type VerifyOutcome } from '@oxyhq/protocol';
import { oxySignedRecordTypeSchema, type SignedRecordEnvelope } from '@oxyhq/contracts';
import SignatureService from './signature.service';
import { buildUserDid } from './did.service';
import { oxyRecordStore } from './oxyRecordStore';
import { oxyVerificationResolver } from './oxyVerificationResolver';
import type { ISignedRecord } from '../models/SignedRecord';

/**
 * The reference to a stored record returned on a successful append. Carries the
 * content address + chain `seq` from the engine plus the stored envelope and its
 * `verified` flag — enough for every caller (the route echoes the envelope; the
 * civic/node services read the `recordId`/`seq`).
 */
export interface StoredRecordRef {
  recordId: string;
  seq: number;
  envelope: SignedRecordEnvelope;
  verified: boolean;
}

export type VerifyAndStoreResult =
  | { ok: true; record: StoredRecordRef }
  | { ok: false; reason: RejectionReason };

/**
 * Build and sign a record envelope with a secp256k1 private key. Used to forge a
 * valid client signature in tests and (server-side) for custodial provenance
 * attestations. The returned envelope verifies against the protocol signature
 * check. (Signing — not an engine internal — stays in the Oxy service.)
 */
export function signRecordEnvelope(
  fields: Omit<SignedRecordEnvelope, 'signature'>,
  privateKeyHex: string,
): SignedRecordEnvelope {
  const signature = SignatureService.signMessage(signedRecordSigningInput(fields), privateKeyHex);
  return { ...fields, signature };
}

/**
 * The two Oxy policies that wrap the protocol engine, applied before any
 * verification:
 *  1. `subject_mismatch` — the envelope's `subject` MUST be `subjectUserId`'s DID
 *     (a caller may only publish records about their own account / chain).
 *  2. the STORE strictness gate — the base envelope `type` is an OPEN string so
 *     any Oxy app can sign on the shared grammar, but the Oxy identity/civic/node
 *     store accepts ONLY the closed `oxySignedRecordTypeSchema` set; a non-Oxy
 *     `type` (e.g. an app's `app_record`) is rejected as `invalid_envelope`.
 *
 * Returns the rejection reason when a policy fails, or `null` when both pass.
 */
function oxyStorePolicy(env: SignedRecordEnvelope, subjectUserId: string): RejectionReason | null {
  if (env.subject !== buildUserDid(subjectUserId)) {
    return 'subject_mismatch';
  }
  if (!oxySignedRecordTypeSchema.safeParse(env.type).success) {
    return 'invalid_envelope';
  }
  return null;
}

/**
 * Verify an envelope for a subject WITHOUT persisting it (the Oxy store policy +
 * the protocol verification state machine with the Oxy store + resolver
 * injected). Powers the public re-verify endpoint.
 */
export async function verifyEnvelope(
  env: SignedRecordEnvelope,
  subjectUserId: string,
): Promise<VerifyOutcome> {
  const policyReason = oxyStorePolicy(env, subjectUserId);
  if (policyReason) {
    return { ok: false, reason: policyReason };
  }
  return protocolVerifyEnvelope(oxyRecordStore, oxyVerificationResolver, env);
}

/**
 * Verify an envelope and append it to the subject's chain as `verified: true`,
 * via the protocol engine with the Oxy store + resolver injected (wrapped by the
 * {@link oxyStorePolicy}). Returns the verdict (so the route maps a rejection to
 * a 4xx) rather than throwing on a bad envelope.
 */
export async function verifyAndStoreRecord(
  env: SignedRecordEnvelope,
  subjectUserId: string,
): Promise<VerifyAndStoreResult> {
  const policyReason = oxyStorePolicy(env, subjectUserId);
  if (policyReason) {
    return { ok: false, reason: policyReason };
  }

  const outcome = await verifyAndAppend(oxyRecordStore, oxyVerificationResolver, env);
  if (!outcome.ok) {
    return outcome;
  }
  return {
    ok: true,
    record: { recordId: outcome.recordId, seq: outcome.seq, envelope: env, verified: true },
  };
}

/** Latest stored record of `type` for a user, or null. */
export async function getLatestRecord(userId: string, type: 'identity' | 'profile'): Promise<ISignedRecord | null> {
  return oxyRecordStore.latestRecordOfType(userId, type);
}
