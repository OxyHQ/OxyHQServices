/**
 * Personhood Service (civic / Commons — Fase 3 proof-of-personhood web-of-trust).
 *
 * Personhood answers "is this a real, unique human?" — NEVER from a single
 * third-party KYC, but from a web-of-trust of SIGNED, staked vouches + real-life
 * attestations + an on-device biometric signal, MINUS sybil penalties. A user
 * NEVER self-awards: a voucher signs a self-issued `personhood_vouch` record and
 * THIS service decides eligibility, records the stake, calls
 * `reputationService.award` in-process for the subject, and recomputes the
 * subject's personhood. Mirrors the trust model of `realLife.service`.
 *
 * Anti-gaming layers, all reusing the Fase 2 substrate:
 *  - the voucher must themselves be a real person (personhood ≥ τ) — the network
 *    is bootstrapped by hand-picked `User.isSeedVerifier` genesis nodes;
 *  - the voucher must NOT be a graph-neighbour / shared-device sock-puppet of the
 *    subject (`isSockPuppetRelation`);
 *  - the vouch is STAKED — if the subject is later proven fake (a failed random
 *    audit or a reversed personhood award) every active voucher is SLASHED
 *    (`slashVouchersForFakeSubject`);
 *  - the derived score subtracts a heuristic `sybilPenalty`.
 */

import { z } from 'zod';
import { verifyEnvelopeSignature, type RejectionReason } from '@oxyhq/protocol';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import { User } from '../../models/User';
import { ReputationTransaction } from '../../models/ReputationTransaction';
import { ReputationBalance } from '../../models/ReputationBalance';
import PersonhoodVouch from '../../models/PersonhoodVouch';
import PersonhoodStatus, { type IPersonhoodStatus } from '../../models/PersonhoodStatus';
import { isSelfIssuedByUser, parseUserDid } from '../did.service';
import { isValidObjectId } from '../../utils/validation';
import { verifyAndStoreRecord } from '../signedRecord.service';
import { isSockPuppetRelation } from './graphExclusion';
import { computeSybilPenalty } from './sybil.service';
import { reputationService } from '../reputation.service';
import { personhoodScore, type PersonhoodInputs } from '../../utils/personhoodDerive';
import {
  PERSONHOOD_VOUCHED_ACTION,
  REAL_LIFE_ATTESTED_ACTION,
  VOUCH_SLASHED_ACTION,
  clamp,
} from '../../utils/reputation.constants';
import {
  MIN_VOUCHER_PERSONHOOD,
  PERSONHOOD_VOUCH_EXCLUSION_HOPS,
  PERSONHOOD_VOUCH_DEFAULT_STAKE,
  PERSONHOOD_VOUCH_MIN_STAKE,
  PERSONHOOD_VOUCH_MAX_STAKE,
  vouchWeightForTier,
} from '../../utils/civic.constants';
import userCache from '../../utils/userCache';
import { logger } from '../../utils/logger';

/**
 * The `record` payload of a `personhood_vouch` signed envelope (API-internal —
 * the wire envelope is validated against `@oxyhq/contracts`; only this inner
 * payload shape is API-private). `about` is the subject's DID; `stake` is an
 * optional caller-chosen stake (clamped server-side); `context` is an opaque
 * note from the vouching UI.
 */
const personhoodVouchRecordSchema = z.object({
  about: z.string(),
  context: z.string().optional(),
  stake: z.number().optional(),
});

/** Why a vouch can be rejected (stable, machine-readable). */
export type VouchRejectionReason =
  | 'invalid_type'
  | 'not_self_issued'
  | 'invalid_record'
  | 'invalid_subject'
  | 'self_vouch'
  | 'subject_not_found'
  | 'voucher_below_threshold'
  | 'already_vouched'
  | 'excluded_self'
  | 'excluded_graph_neighbor'
  | 'excluded_shared_device'
  | RejectionReason;

export type VouchResult =
  | { ok: true; recordId: string; subjectUserId: string; voucherUserId: string; stakeAmount: number; points: number }
  | { ok: false; reason: VouchRejectionReason };

/** True when an error is a MongoDB duplicate-key (E11000) error. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/** Map a sock-puppet exclusion reason to the matching vouch rejection reason. */
function exclusionReason(
  reason: 'self' | 'graph_neighbor' | 'shared_device',
): VouchRejectionReason {
  switch (reason) {
    case 'self':
      return 'excluded_self';
    case 'shared_device':
      return 'excluded_shared_device';
    default:
      return 'excluded_graph_neighbor';
  }
}

/* -------------------------------------------------------------------------- */
/*  Input aggregation + recompute                                             */
/* -------------------------------------------------------------------------- */

/** Sum the active vouchers' tier weights for a subject (the vouch axis). */
async function weightedVouchScore(subjectUserId: string): Promise<{ score: number; count: number }> {
  const vouches = await PersonhoodVouch.find({ subjectUserId, status: 'active' })
    .select('voucherUserId')
    .lean<Array<{ voucherUserId: unknown }>>();
  if (vouches.length === 0) {
    return { score: 0, count: 0 };
  }
  const voucherIds = vouches.map((v) => String(v.voucherUserId));
  const balances = await ReputationBalance.find({ userId: { $in: voucherIds } })
    .select('userId trustTier')
    .lean<Array<{ userId: unknown; trustTier: string }>>();
  const tierById = new Map<string, string>();
  for (const balance of balances) {
    tierById.set(String(balance.userId), balance.trustTier);
  }
  let score = 0;
  for (const voucherId of voucherIds) {
    // A voucher with no balance snapshot yet defaults to the `new` tier weight.
    score += vouchWeightForTier(tierById.get(voucherId) ?? 'new');
  }
  return { score, count: voucherIds.length };
}

/** Whether the subject has at least one biometric-bound real-life attestation. */
async function isBiometricBound(subjectUserId: string): Promise<boolean> {
  const txn = await ReputationTransaction.findOne({
    userId: subjectUserId,
    actionType: REAL_LIFE_ATTESTED_ACTION,
    status: 'active',
    'metadata.biometricOk': true,
  })
    .select('_id')
    .lean();
  return txn !== null;
}

/** Count of the subject's active real-life counterparty attestations. */
async function realLifeCount(subjectUserId: string): Promise<number> {
  return ReputationTransaction.countDocuments({
    userId: subjectUserId,
    actionType: REAL_LIFE_ATTESTED_ACTION,
    status: 'active',
  });
}

/**
 * Recompute + persist a user's `PersonhoodStatus` from their active vouches,
 * real-life attestations, biometric signal, and sybil penalty. Mirrors
 * `User.verified` to `isRealPerson` so the reputation `deriveTrustTier` promotes
 * a real person to the `verified` tier; when `verified` actually flips, the
 * reputation balance is recalculated and `userCache` invalidated.
 */
export async function recomputePersonhood(userId: string): Promise<IPersonhoodStatus> {
  const user = await User.findById(userId).select('isSeedVerifier verified').lean();

  let inputs: PersonhoodInputs;
  let vouchCount = 0;
  let realLife = 0;
  let biometricBound = false;
  let sybilPenalty = 0;

  if (user?.isSeedVerifier === true) {
    inputs = {
      weightedVouchScore: 0,
      realLifeCount: 0,
      biometricBound: false,
      sybilPenalty: 0,
      isSeedVerifier: true,
    };
  } else {
    const [vouch, life, biometric, sybil] = await Promise.all([
      weightedVouchScore(userId),
      realLifeCount(userId),
      isBiometricBound(userId),
      computeSybilPenalty(userId),
    ]);
    vouchCount = vouch.count;
    realLife = life;
    biometricBound = biometric;
    sybilPenalty = sybil.penalty;
    inputs = {
      weightedVouchScore: vouch.score,
      realLifeCount: life,
      biometricBound: biometric,
      sybilPenalty: sybil.penalty,
      isSeedVerifier: false,
    };
  }

  const derived = personhoodScore(inputs);

  const status = await PersonhoodStatus.findOneAndUpdate(
    { userId },
    {
      $set: {
        score: derived.score,
        isRealPerson: derived.isRealPerson,
        vouchCount,
        realLifeCount: realLife,
        biometricBound,
        sybilPenalty,
        breakdown: derived.breakdown,
      },
      $setOnInsert: { userId },
    },
    { new: true, upsert: true },
  );

  // Mirror onto User.verified so the reputation tier reflects personhood. Only
  // write + recompute + invalidate when the flag actually changes.
  if ((user?.verified === true) !== derived.isRealPerson) {
    await User.updateOne({ _id: userId }, { $set: { verified: derived.isRealPerson } });
    await reputationService.recalculateBalance(userId);
    userCache.invalidate(userId);
  }

  return status;
}

/** The voucher's current personhood score (seed verifiers count as 1). */
async function voucherPersonhoodScore(voucherUserId: string): Promise<number> {
  const user = await User.findById(voucherUserId).select('isSeedVerifier').lean();
  if (user?.isSeedVerifier === true) {
    return 1;
  }
  const status = await PersonhoodStatus.findOne({ userId: voucherUserId }).select('score').lean<{ score?: number } | null>();
  if (status) {
    return status.score ?? 0;
  }
  const recomputed = await recomputePersonhood(voucherUserId);
  return recomputed.score;
}

/* -------------------------------------------------------------------------- */
/*  Vouch                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Verify + record a `personhood_vouch` signed by `voucherUserId` about the
 * subject in `record.about`, stake the voucher, award the subject the
 * `personhood_vouched` points, and recompute the subject's personhood. Returns a
 * verdict so the route maps a rejection to the right HTTP status.
 */
export async function vouchForPerson(
  envelope: SignedRecordEnvelope,
  voucherUserId: string,
): Promise<VouchResult> {
  if (envelope.type !== 'personhood_vouch') {
    return { ok: false, reason: 'invalid_type' };
  }

  // The vouch is the voucher's SELF-ISSUED statement (`subject === issuer === B`).
  // Account-based: the SDK's DID spelling may differ from the server's
  // `DID_WEB_DOMAIN` anchor for the same account.
  if (!isSelfIssuedByUser(envelope, voucherUserId)) {
    return { ok: false, reason: 'not_self_issued' };
  }

  const parsed = personhoodVouchRecordSchema.safeParse(envelope.record);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_record' };
  }
  const record = parsed.data;

  const subjectUserId = parseUserDid(record.about);
  if (!subjectUserId || !isValidObjectId(subjectUserId)) {
    return { ok: false, reason: 'invalid_subject' };
  }
  if (subjectUserId === voucherUserId) {
    return { ok: false, reason: 'self_vouch' };
  }

  // Cheap forgery gate before any expensive graph / DB work.
  if (!(await verifyEnvelopeSignature(envelope))) {
    return { ok: false, reason: 'bad_signature' };
  }

  // The voucher must themselves be a real person (≥ τ) — only real people can
  // vouch; the genesis is the seed verifiers.
  const voucherScore = await voucherPersonhoodScore(voucherUserId);
  if (voucherScore < MIN_VOUCHER_PERSONHOOD) {
    return { ok: false, reason: 'voucher_below_threshold' };
  }

  const subjectExists = await User.exists({ _id: subjectUserId });
  if (!subjectExists) {
    return { ok: false, reason: 'subject_not_found' };
  }

  // Anti-sybil: the voucher must not be the subject's puppet (no graph edge, no
  // shared device/IP).
  const relation = await isSockPuppetRelation(subjectUserId, voucherUserId, {
    hops: PERSONHOOD_VOUCH_EXCLUSION_HOPS,
  });
  if (relation.excluded) {
    return { ok: false, reason: exclusionReason(relation.reason) };
  }

  // Reject any existing vouch for this pair BEFORE appending a signed record.
  // Withdrawn/slashed vouches remain audit history and must not make the pair
  // eligible for a fresh reputation award.
  const existing = await PersonhoodVouch.findOne({
    voucherUserId,
    subjectUserId,
  })
    .select('_id')
    .lean();
  if (existing) {
    return { ok: false, reason: 'already_vouched' };
  }

  // Store the voucher's signed statement on the voucher's own chain.
  const stored = await verifyAndStoreRecord(envelope, voucherUserId);
  if (!stored.ok) {
    return { ok: false, reason: stored.reason };
  }
  const recordId = stored.record.recordId ?? '';

  const stakeAmount = clamp(
    record.stake ?? PERSONHOOD_VOUCH_DEFAULT_STAKE,
    PERSONHOOD_VOUCH_MIN_STAKE,
    PERSONHOOD_VOUCH_MAX_STAKE,
  );

  try {
    await PersonhoodVouch.create({ voucherUserId, subjectUserId, stakeAmount, recordId, status: 'active' });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { ok: false, reason: 'already_vouched' };
    }
    throw error;
  }

  // Award the subject — no self-award: the SERVICE awards, referencing the
  // voucher's envelope as provenance and recording the voucher (so they can be
  // slashed if the subject is later proven fake).
  const txn = await reputationService.award({
    userId: subjectUserId,
    actionType: PERSONHOOD_VOUCHED_ACTION,
    createdByUserId: voucherUserId,
    sourceActionId: recordId,
    reason: 'Vouched for as a real person by a staking voucher',
    metadata: { voucherUserId, stakeAmount },
    emitAttestation: true,
    sourceEnvelopeIds: recordId ? [recordId] : [],
  });

  await recomputePersonhood(subjectUserId);

  logger.info('Personhood vouch accepted', {
    component: 'civic.personhood',
    subjectUserId,
    voucherUserId,
    recordId,
  });

  return { ok: true, recordId, subjectUserId, voucherUserId, stakeAmount, points: txn.points };
}

/* -------------------------------------------------------------------------- */
/*  Withdraw                                                                   */
/* -------------------------------------------------------------------------- */

export type WithdrawResult = { ok: true } | { ok: false; reason: 'not_found' };

/**
 * Withdraw the caller's active vouch for `subjectUserId`. The vouch flips to
 * `withdrawn` (kept for audit) so it no longer contributes to the subject's
 * personhood; the subject is recomputed (which may demote them below θ). The
 * already-awarded `personhood_vouched` reputation points are NOT clawed back,
 * and the historical vouch still prevents re-vouching the same pair to avoid
 * farming reputation through withdraw/re-vouch loops.
 */
export async function withdrawVouch(voucherUserId: string, subjectUserId: string): Promise<WithdrawResult> {
  const vouch = await PersonhoodVouch.findOneAndUpdate(
    { voucherUserId, subjectUserId, status: 'active' },
    { $set: { status: 'withdrawn' } },
    { new: true },
  );
  if (!vouch) {
    return { ok: false, reason: 'not_found' };
  }
  await recomputePersonhood(subjectUserId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Slash cascade                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Slash every ACTIVE voucher of a subject who was proven fake (a failed random
 * audit, or a reversed personhood award): award each `vouch_slashed` (-20), flip
 * their vouch to `slashed`, and recompute that voucher's standing. Finally
 * recompute the (now un-vouched) subject. Returns the number of vouchers
 * slashed. Best-effort — individual failures are logged and skipped.
 */
export async function slashVouchersForFakeSubject(subjectUserId: string, reason: string): Promise<number> {
  const vouches = await PersonhoodVouch.find({ subjectUserId, status: 'active' })
    .select('_id voucherUserId')
    .lean<Array<{ _id: unknown; voucherUserId: unknown }>>();

  let slashed = 0;
  for (const vouch of vouches) {
    const voucherUserId = String(vouch.voucherUserId);
    const vouchId = String(vouch._id);
    try {
      await reputationService.award({
        userId: voucherUserId,
        actionType: VOUCH_SLASHED_ACTION,
        sourceActionId: `vouch_slash:${vouchId}`,
        reason,
      });
      await PersonhoodVouch.updateOne({ _id: vouch._id }, { $set: { status: 'slashed' } });
      await recomputePersonhood(voucherUserId);
      slashed += 1;
    } catch (error) {
      logger.warn('Vouch slash failed (non-fatal)', {
        component: 'civic.personhood',
        voucherUserId,
        vouchId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The subject's vouches are now slashed → recompute drops their vouch signal
  // (and, if it was their main evidence, demotes them below θ).
  await recomputePersonhood(subjectUserId);

  return slashed;
}
