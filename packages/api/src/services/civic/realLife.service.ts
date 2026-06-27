/**
 * Real-life Attestation Service (civic / Commons — Fase 2 Part A).
 *
 * The HIGH-weight (25 pt) anti-gaming signal: a counterparty (B) who physically
 * met the subject (A) scans A's QR (`oxydni://attest?subject=<A.did>&ctx=…&
 * nonce=…&exp=…`) and signs a `real_life_attestation` record with B's OWN key.
 *
 * Trust model:
 *  - B's envelope is SELF-ISSUED (`subject === issuer === B.did`) and stored on
 *    B's own chain — "B attests A" is B's signed statement. `record.about` is
 *    A's DID. (A's reputation award rides a SEPARATE Oxy-signed
 *    `reputation_attestation` on A's chain via `award(emitAttestation)`, which
 *    references B's envelope as provenance.)
 *  - Replay is blocked by a single-use `CivicNonce` (the QR's nonce) + `exp`.
 *  - Sybil farming is blocked by the shared graph-exclusion test (B must not be
 *    A's puppet: no graph edge, no shared device/IP) + a per-pair cooldown.
 *  - B is recorded as the attestor (`createdByUserId`) so B can be SLASHED in
 *    Part B if A's attested action is later found fraudulent.
 *
 * No self-award: B signs; the SERVICE decides eligibility and calls
 * `reputationService.award` for A in-process.
 */

import crypto from 'crypto';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import { realLifeAttestationRecordSchema } from '@oxyhq/contracts';
import { User } from '../../models/User';
import { ReputationTransaction } from '../../models/ReputationTransaction';
import CivicNonce from '../../models/CivicNonce';
import { buildUserDid, parseUserDid } from '../did.service';
import { isValidObjectId } from '../../utils/validation';
import {
  verifyEnvelopeSignature,
  verifyAndStoreRecord,
  type SignedRecordSubject,
  type EnvelopeRejectionReason,
} from '../signedRecord.service';
import { isSockPuppetRelation } from './graphExclusion';
import { reputationService } from '../reputation.service';
import { REAL_LIFE_ATTESTED_ACTION } from '../../utils/reputation.constants';
import {
  REAL_LIFE_NONCE_MAX_AGE_MS,
  REAL_LIFE_PAIR_COOLDOWN_MS,
  REAL_LIFE_EXCLUSION_HOPS,
} from '../../utils/civic.constants';
import { logger } from '../../utils/logger';

const NONCE_PURPOSE = 'real_life_attestation';

/** Why a real-life attestation can be rejected (stable, machine-readable). */
export type RealLifeRejectionReason =
  | 'invalid_type'
  | 'invalid_record'
  | 'not_self_issued'
  | 'invalid_subject'
  | 'self_attestation'
  | 'subject_not_found'
  | 'expired'
  | 'nonce_used'
  | 'pair_cooldown'
  | 'excluded_graph_neighbor'
  | 'excluded_shared_device'
  | 'excluded_shared_ip'
  | EnvelopeRejectionReason;

export type RealLifeResult =
  | { ok: true; recordId: string; subjectUserId: string; attestorUserId: string; points: number }
  | { ok: false; reason: RealLifeRejectionReason };

/** SHA-256 of the purpose-salted raw nonce (we never store the raw value). */
function hashNonce(nonce: string): string {
  return crypto.createHash('sha256').update(`${NONCE_PURPOSE}:${nonce}`).digest('hex');
}

/** True when an error is a MongoDB duplicate-key (E11000) error. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Atomically claim a single-use nonce. Returns false when it was already used
 * (the unique `nonceHash` index rejects the second insert) — the replay guard.
 */
async function claimNonce(nonce: string, subjectUserId: string, exp: number): Promise<boolean> {
  try {
    await CivicNonce.create({
      nonceHash: hashNonce(nonce),
      purpose: NONCE_PURPOSE,
      subjectUserId,
      expiresAt: new Date(exp),
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false;
    }
    throw error;
  }
}

/** Map a graph-exclusion reason to the matching rejection reason. */
function exclusionReason(
  reason: 'self' | 'graph_neighbor' | 'shared_device' | 'shared_ip',
): RealLifeRejectionReason {
  switch (reason) {
    case 'shared_device':
      return 'excluded_shared_device';
    case 'shared_ip':
      return 'excluded_shared_ip';
    case 'self':
      return 'self_attestation';
    default:
      return 'excluded_graph_neighbor';
  }
}

/**
 * Verify + record a real-life attestation signed by `attestorUserId` (B) about
 * the subject referenced in `record.about` (A), and award A the HIGH-weight
 * points. Returns a verdict so the route maps a rejection to the right status.
 */
export async function submitRealLifeAttestation(
  envelope: SignedRecordEnvelope,
  attestorUserId: string,
): Promise<RealLifeResult> {
  if (envelope.type !== 'real_life_attestation') {
    return { ok: false, reason: 'invalid_type' };
  }

  // B's envelope must be SELF-ISSUED (B signs as the subject; `about` carries A).
  const attestorDid = buildUserDid(attestorUserId);
  if (envelope.subject !== attestorDid || envelope.issuer !== attestorDid) {
    return { ok: false, reason: 'not_self_issued' };
  }

  const parsedRecord = realLifeAttestationRecordSchema.safeParse(envelope.record);
  if (!parsedRecord.success) {
    return { ok: false, reason: 'invalid_record' };
  }
  const record = parsedRecord.data;

  const subjectUserId = parseUserDid(record.about);
  if (!subjectUserId || !isValidObjectId(subjectUserId)) {
    return { ok: false, reason: 'invalid_subject' };
  }
  if (subjectUserId === attestorUserId) {
    return { ok: false, reason: 'self_attestation' };
  }

  // Freshness: the QR's `exp` must be in the future but not absurdly far out.
  const now = Date.now();
  if (record.exp <= now || record.exp > now + REAL_LIFE_NONCE_MAX_AGE_MS) {
    return { ok: false, reason: 'expired' };
  }

  const [subjectExists, attestor] = await Promise.all([
    User.exists({ _id: subjectUserId }),
    User.findById(attestorUserId).select('publicKey authMethods').lean(),
  ]);
  if (!subjectExists) {
    return { ok: false, reason: 'subject_not_found' };
  }
  const subject: SignedRecordSubject = {
    publicKey: attestor?.publicKey,
    authMethods: attestor?.authMethods,
  };

  // Cheap forgery gate before any expensive graph work (authoritative
  // verification happens again inside verifyAndStoreRecord).
  if (!verifyEnvelopeSignature(envelope)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Anti-sybil: B must not be A's puppet (no graph edge, no shared device/IP).
  const relation = await isSockPuppetRelation(subjectUserId, attestorUserId, {
    hops: REAL_LIFE_EXCLUSION_HOPS,
  });
  if (relation.excluded) {
    return { ok: false, reason: exclusionReason(relation.reason) };
  }

  // Per-pair cooldown: B may attest A at most once per window.
  const since = new Date(now - REAL_LIFE_PAIR_COOLDOWN_MS);
  const recentPair = await ReputationTransaction.findOne({
    userId: subjectUserId,
    createdByUserId: attestorUserId,
    actionType: REAL_LIFE_ATTESTED_ACTION,
    createdAt: { $gt: since },
  }).lean();
  if (recentPair) {
    return { ok: false, reason: 'pair_cooldown' };
  }

  // Burn the single-use nonce (replay guard) only after the eligibility gates,
  // so a rejected attempt never consumes the subject's QR.
  const claimed = await claimNonce(record.nonce, subjectUserId, record.exp);
  if (!claimed) {
    return { ok: false, reason: 'nonce_used' };
  }

  // Store B's signed attestation on B's chain (authoritative verify + append).
  const stored = await verifyAndStoreRecord(envelope, subject, attestorUserId);
  if (!stored.ok) {
    return { ok: false, reason: stored.reason };
  }
  const recordId = stored.record.recordId ?? '';

  // Award A the HIGH-weight points, recording B as the attestor + emitting the
  // Oxy provenance attestation that references B's envelope.
  const txn = await reputationService.award({
    userId: subjectUserId,
    actionType: REAL_LIFE_ATTESTED_ACTION,
    createdByUserId: attestorUserId,
    sourceActionId: recordId,
    reason: 'Real-life attestation by a counterparty',
    metadata: { attestorUserId, context: record.context, biometricOk: record.biometricOk ?? false },
    emitAttestation: true,
    sourceEnvelopeIds: recordId ? [recordId] : [],
  });

  logger.info('Real-life attestation accepted', {
    component: 'civic.realLife',
    subjectUserId,
    attestorUserId,
    recordId,
  });

  return {
    ok: true,
    recordId,
    subjectUserId,
    attestorUserId,
    points: txn.points,
  };
}
