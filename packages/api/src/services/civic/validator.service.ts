/**
 * Validator Jury Service (civic / Commons — Fase 2 Part B, the anti-collusion core).
 *
 * A MEDIUM-weight (8 pt) claim is validated by a RANDOMLY-SELECTED jury of
 * trusted peers who each submit a SIGNED verdict. The anti-"bring my friends"
 * defences are layered:
 *  - RANDOM selection — weighted reservoir sampling keyed by a per-request RNG
 *    seed (stored for audit), so a subject cannot predict or pack their jury.
 *  - GRAPH EXCLUSION — the shared `isSockPuppetRelation` (2 hops + shared
 *    device/IP) drops the subject's neighbours from the pool.
 *  - AFFINITY THROTTLE — a candidate that has co-voted heavily with an
 *    already-selected juror is skipped (breaks up voting rings).
 *  - SLASHING — if the resulting award is later reversed (dispute/fraud), the
 *    endorsing jurors are slashed (see `slash.service`).
 *
 * No self-award: jurors submit signed verdicts; THIS service tallies quorum and
 * calls `reputationService.award` in-process for the subject + correct jurors.
 */

import crypto from 'crypto';
import { canonicalize } from '@oxyhq/core';
import { validationVerdictRecordSchema, type ValidationVerdict } from '@oxyhq/contracts';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import { ReputationBalance } from '../../models/ReputationBalance';
import ValidationRequest, { type IValidationRequest } from '../../models/ValidationRequest';
import ValidationVote, { type IValidationVote } from '../../models/ValidationVote';
import ValidatorAffinity from '../../models/ValidatorAffinity';
import { User } from '../../models/User';
import { isSockPuppetRelation } from './graphExclusion';
import {
  verifyEnvelopeSignature,
  verifyAndStoreRecord,
  type SignedRecordSubject,
} from '../signedRecord.service';
import { reputationService } from '../reputation.service';
import { buildUserDid } from '../did.service';
import {
  PEER_VALIDATED_ACTION,
  VALIDATION_CORRECT_ACTION,
} from '../../utils/reputation.constants';
import {
  VALIDATOR_POOL_TIERS,
  VALIDATOR_COUNT,
  VALIDATOR_QUORUM,
  VALIDATOR_SUPERMAJORITY,
  VALIDATION_EXCLUSION_HOPS,
  VALIDATION_TTL_MS,
  AFFINITY_MAX_COVOTES,
  VALIDATOR_POOL_CAP,
} from '../../utils/civic.constants';
import { logger } from '../../utils/logger';

/* -------------------------------------------------------------------------- */
/*  Weighting + deterministic RNG                                             */
/* -------------------------------------------------------------------------- */

/** Damped, capped juror weight from the trust tier (higher tier ⇒ more weight). */
function validatorWeight(trustTier: string): number {
  switch (trustTier) {
    case 'verified':
      return 2;
    case 'high_trust':
      return 1.5;
    default:
      return 1; // trusted
  }
}

/**
 * Deterministic uniform in (0,1) for a (seed, id) pair — the per-candidate
 * randomness of the weighted reservoir. Deterministic so the selection is
 * reproducible from the stored `rngSeed` (audit) yet unpredictable without it.
 */
function hashUnit(seed: string, id: string): number {
  const digest = crypto.createHash('sha256').update(`${seed}:${id}`).digest();
  const n = digest.readUIntBE(0, 6); // 48 bits
  const u = n / 2 ** 48;
  return u <= 0 ? Number.MIN_VALUE : u;
}

/** Canonical (sorted) pair for a ValidatorAffinity lookup. */
function affinityPair(a: string, b: string): { validatorA: string; validatorB: string } {
  return a < b ? { validatorA: a, validatorB: b } : { validatorA: b, validatorB: a };
}

/* -------------------------------------------------------------------------- */
/*  Selection                                                                 */
/* -------------------------------------------------------------------------- */

export interface ValidatorSelection {
  validatorIds: string[];
  rngSeed: string;
  candidateSnapshot: Array<{ userId: string; weight: number }>;
}

/**
 * Select the jury for `subjectUserId`. Eligible pool = balances with a
 * jury-eligible trust tier, minus the subject and anyone the shared exclusion
 * test flags (graph neighbour within {@link VALIDATION_EXCLUSION_HOPS} or shared
 * device/IP). The remaining candidates are ranked by a seeded weighted-reservoir
 * key; the top `VALIDATOR_COUNT` are taken, skipping any candidate with high
 * co-vote affinity to an already-selected juror.
 */
export async function selectValidators(
  subjectUserId: string,
  opts: { rngSeed?: string } = {},
): Promise<ValidatorSelection> {
  const rngSeed = opts.rngSeed ?? crypto.randomBytes(32).toString('hex');

  const balances = await ReputationBalance.find({ trustTier: { $in: VALIDATOR_POOL_TIERS } })
    .select('userId trustTier')
    .limit(VALIDATOR_POOL_CAP)
    .lean<Array<{ userId: unknown; trustTier: string }>>();

  // Exclude the subject + sock-puppets; snapshot the eligible candidate pool.
  const candidates: Array<{ userId: string; weight: number }> = [];
  for (const balance of balances) {
    const candidateId = String(balance.userId);
    if (candidateId === subjectUserId) {
      continue;
    }
    const relation = await isSockPuppetRelation(subjectUserId, candidateId, {
      hops: VALIDATION_EXCLUSION_HOPS,
    });
    if (relation.excluded) {
      continue;
    }
    candidates.push({ userId: candidateId, weight: validatorWeight(balance.trustTier) });
  }

  // Weighted reservoir: key = u^(1/w); highest keys win. Deterministic in seed.
  const ranked = candidates
    .map((c) => ({ ...c, key: Math.pow(hashUnit(rngSeed, c.userId), 1 / c.weight) }))
    .sort((a, b) => b.key - a.key);

  const selected: string[] = [];
  for (const candidate of ranked) {
    if (selected.length >= VALIDATOR_COUNT) {
      break;
    }
    if (await hasHighAffinity(candidate.userId, selected)) {
      continue;
    }
    selected.push(candidate.userId);
  }

  return { validatorIds: selected, rngSeed, candidateSnapshot: candidates };
}

/** True when `candidate` has met the co-vote affinity ceiling with any `selected`. */
async function hasHighAffinity(candidate: string, selected: string[]): Promise<boolean> {
  for (const other of selected) {
    const edge = await ValidatorAffinity.findOne(affinityPair(candidate, other)).lean<{ coVoteCount?: number } | null>();
    if (edge && (edge.coVoteCount ?? 0) >= AFFINITY_MAX_COVOTES) {
      return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Opening a request                                                         */
/* -------------------------------------------------------------------------- */

export interface OpenValidationInput {
  subjectUserId: string;
  actionType: string;
  sourceActionId: string;
  payload: Record<string, unknown>;
  applicationId?: string;
  highValue?: boolean;
}

/**
 * Open a validation request: select the jury, snapshot the selection rationale,
 * and persist. Idempotent on `sourceActionId` while an open request exists.
 */
export async function openValidationRequest(input: OpenValidationInput): Promise<IValidationRequest> {
  const existing = await ValidationRequest.findOne({
    sourceActionId: input.sourceActionId,
    status: { $in: ['pending', 'quorum_met'] },
  });
  if (existing) {
    return existing;
  }

  const selection = await selectValidators(input.subjectUserId);
  const payloadHash = crypto.createHash('sha256').update(canonicalize(input.payload)).digest('hex');
  const highValue = input.highValue ?? false;

  const request = await ValidationRequest.create({
    subjectUserId: input.subjectUserId,
    actionType: input.actionType,
    applicationId: input.applicationId,
    sourceActionId: input.sourceActionId,
    payload: input.payload,
    payloadHash,
    status: 'pending',
    selectedValidatorIds: selection.validatorIds,
    quorum: VALIDATOR_QUORUM,
    threshold: highValue ? VALIDATOR_SUPERMAJORITY : VALIDATOR_QUORUM,
    highValue,
    rngSeed: selection.rngSeed,
    candidateSnapshot: selection.candidateSnapshot,
    expiresAt: new Date(Date.now() + VALIDATION_TTL_MS),
  });

  return request;
}

/* -------------------------------------------------------------------------- */
/*  Voting                                                                    */
/* -------------------------------------------------------------------------- */

export type VoteRejectionReason =
  | 'request_not_found'
  | 'request_closed'
  | 'not_selected'
  | 'invalid_type'
  | 'not_self_issued'
  | 'invalid_verdict_record'
  | 'request_mismatch'
  | 'payload_mismatch'
  | 'bad_signature'
  | 'already_voted'
  | 'store_failed';

export type VoteResult =
  | { ok: true; verdict: ValidationVerdict; status: IValidationRequest['status'] }
  | { ok: false; reason: VoteRejectionReason };

/** True when an error is a MongoDB duplicate-key (E11000) error. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Record a juror's SIGNED verdict on a request and (re)tally. The verdict is a
 * self-issued `validation_verdict` envelope bound to the request id + payload
 * hash; it is stored on the juror's chain. One vote per juror (unique index).
 */
export async function submitVote(
  requestId: string,
  validatorUserId: string,
  envelope: SignedRecordEnvelope,
): Promise<VoteResult> {
  const request = await ValidationRequest.findById(requestId);
  if (!request) {
    return { ok: false, reason: 'request_not_found' };
  }
  if (request.status !== 'pending' && request.status !== 'quorum_met') {
    return { ok: false, reason: 'request_closed' };
  }
  if (request.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'request_closed' };
  }
  if (!request.selectedValidatorIds.some((id) => id.toString() === validatorUserId)) {
    return { ok: false, reason: 'not_selected' };
  }

  if (envelope.type !== 'validation_verdict') {
    return { ok: false, reason: 'invalid_type' };
  }
  const validatorDid = buildUserDid(validatorUserId);
  if (envelope.subject !== validatorDid || envelope.issuer !== validatorDid) {
    return { ok: false, reason: 'not_self_issued' };
  }

  const parsed = validationVerdictRecordSchema.safeParse(envelope.record);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_verdict_record' };
  }
  const verdict = parsed.data.verdict;
  if (parsed.data.requestId !== requestId) {
    return { ok: false, reason: 'request_mismatch' };
  }
  if (parsed.data.payloadHash !== request.payloadHash) {
    return { ok: false, reason: 'payload_mismatch' };
  }

  if (!verifyEnvelopeSignature(envelope)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const voter = await User.findById(validatorUserId).select('publicKey authMethods').lean();
  const subject: SignedRecordSubject = { publicKey: voter?.publicKey, authMethods: voter?.authMethods };
  const stored = await verifyAndStoreRecord(envelope, subject, validatorUserId);
  if (!stored.ok) {
    return { ok: false, reason: 'store_failed' };
  }

  const balance = await ReputationBalance.findOne({ userId: validatorUserId }).select('trustTier').lean<{ trustTier?: string } | null>();
  try {
    await ValidationVote.create({
      requestId,
      validatorUserId,
      verdict,
      envelope,
      publicKey: envelope.publicKey,
      recordId: stored.record.recordId ?? '',
      stakeWeight: validatorWeight(balance?.trustTier ?? 'trusted'),
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { ok: false, reason: 'already_voted' };
    }
    throw error;
  }

  const status = await tallyAndResolve(requestId);
  return { ok: true, verdict, status };
}

/* -------------------------------------------------------------------------- */
/*  Tally + resolve                                                           */
/* -------------------------------------------------------------------------- */

/** Decide an outcome (or null to stay open) from the vote counts. */
function decideOutcome(
  valid: number,
  invalid: number,
  threshold: number,
  allVoted: boolean,
  expired: boolean,
): 'validated' | 'rejected' | null {
  if (valid >= threshold) {
    return 'validated';
  }
  if (invalid >= threshold) {
    return 'rejected';
  }
  if (allVoted || expired) {
    return valid > invalid ? 'validated' : 'rejected';
  }
  return null;
}

/**
 * Tally a request. Resolves (awards the subject + rewards correct jurors) when a
 * side reaches threshold, on full participation, or on expiry with quorum; marks
 * `expired` when it lapses without quorum; otherwise leaves it pending. The
 * status transition is an atomic CAS so it resolves at most once.
 */
export async function tallyAndResolve(requestId: string): Promise<IValidationRequest['status']> {
  const request = await ValidationRequest.findById(requestId);
  if (!request) {
    return 'expired';
  }
  if (request.status === 'validated' || request.status === 'rejected' || request.status === 'expired') {
    return request.status;
  }

  const votes = await ValidationVote.find({ requestId }).lean<IValidationVote[]>();
  const valid = votes.filter((v) => v.verdict === 'valid');
  const invalid = votes.filter((v) => v.verdict === 'invalid');
  const total = votes.length;
  const expired = request.expiresAt.getTime() <= Date.now();
  const allVoted = total >= request.selectedValidatorIds.length;

  if (total < request.quorum) {
    if (expired) {
      request.status = 'expired';
      await request.save();
      return 'expired';
    }
    return request.status;
  }

  const outcome = decideOutcome(valid.length, invalid.length, request.threshold, allVoted, expired);
  if (!outcome) {
    if (request.status !== 'quorum_met') {
      request.status = 'quorum_met';
      await request.save();
    }
    return request.status;
  }

  // Atomic claim: only one resolver advances past pending/quorum_met.
  const claimed = await ValidationRequest.findOneAndUpdate(
    { _id: requestId, status: { $in: ['pending', 'quorum_met'] } },
    { $set: { status: outcome, outcome } },
    { new: true },
  );
  if (!claimed) {
    return request.status;
  }

  const winners = outcome === 'validated' ? valid : invalid;
  await resolveAwards(claimed, outcome, valid, votes);
  await bumpAffinity(winners.map((v) => v.validatorUserId.toString()));

  logger.info('Validation request resolved', {
    component: 'civic.validator',
    requestId,
    outcome,
    valid: valid.length,
    invalid: invalid.length,
  });

  return outcome;
}

/** On a `validated` outcome, award the subject + reward the correct jurors. */
async function resolveAwards(
  request: IValidationRequest,
  outcome: 'validated' | 'rejected',
  validVotes: IValidationVote[],
  allVotes: IValidationVote[],
): Promise<void> {
  if (outcome !== 'validated') {
    return;
  }

  const subjectUserId = request.subjectUserId.toString();
  const txn = await reputationService.award({
    userId: subjectUserId,
    actionType: PEER_VALIDATED_ACTION,
    sourceActionId: request._id.toString(),
    reason: 'Validated by a randomly-selected jury of peers',
    metadata: {
      requestId: request._id.toString(),
      voterUserIds: allVotes.map((v) => v.validatorUserId.toString()),
    },
    emitAttestation: true,
    sourceEnvelopeIds: validVotes.map((v) => v.recordId).filter((id) => id.length > 0),
  });
  request.resolvedTxnId = txn._id;
  await request.save();

  // Reward each juror who voted with the resolving majority.
  for (const vote of validVotes) {
    await reputationService.award({
      userId: vote.validatorUserId.toString(),
      actionType: VALIDATION_CORRECT_ACTION,
      sourceActionId: `${request._id.toString()}:${vote.validatorUserId.toString()}`,
      reason: 'Voted with the resolving majority on a peer validation',
    });
  }
}

/** Increment the co-vote affinity for every pair within the winning side. */
async function bumpAffinity(winnerIds: string[]): Promise<void> {
  for (let i = 0; i < winnerIds.length; i += 1) {
    for (let j = i + 1; j < winnerIds.length; j += 1) {
      const pair = affinityPair(winnerIds[i], winnerIds[j]);
      await ValidatorAffinity.findOneAndUpdate(
        pair,
        { $inc: { coVoteCount: 1 }, $set: { lastCoVoteAt: new Date() } },
        { upsert: true },
      );
    }
  }
}

export type DenyResult =
  | { ok: true }
  | { ok: false; reason: 'request_not_found' | 'request_closed' | 'not_selected' };

/**
 * A selected juror RECUSES from a request (e.g. a conflict of interest they
 * know of). The juror is removed from the jury and the request is re-tallied
 * (so a now-complete set can resolve, or lapse to `expired` if it can no longer
 * reach quorum). Replacement-juror selection is a future enhancement.
 */
export async function denyValidation(requestId: string, validatorUserId: string): Promise<DenyResult> {
  const request = await ValidationRequest.findById(requestId);
  if (!request) {
    return { ok: false, reason: 'request_not_found' };
  }
  if (request.status !== 'pending' && request.status !== 'quorum_met') {
    return { ok: false, reason: 'request_closed' };
  }
  if (!request.selectedValidatorIds.some((id) => id.toString() === validatorUserId)) {
    return { ok: false, reason: 'not_selected' };
  }

  request.selectedValidatorIds = request.selectedValidatorIds.filter(
    (id) => id.toString() !== validatorUserId,
  );
  await request.save();
  await tallyAndResolve(requestId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Inbox + sweep                                                             */
/* -------------------------------------------------------------------------- */

/** The pending requests a juror still needs to vote on. */
export async function getValidatorInbox(validatorUserId: string): Promise<IValidationRequest[]> {
  const requests = await ValidationRequest.find({
    selectedValidatorIds: validatorUserId,
    status: { $in: ['pending', 'quorum_met'] },
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<IValidationRequest[]>();

  if (requests.length === 0) {
    return [];
  }

  // Drop the ones this juror has already voted on.
  const votedRequestIds = await ValidationVote.find({
    validatorUserId,
    requestId: { $in: requests.map((r) => r._id) },
  })
    .select('requestId')
    .lean<Array<{ requestId: unknown }>>();
  const voted = new Set(votedRequestIds.map((v) => String(v.requestId)));
  return requests.filter((r) => !voted.has(r._id.toString()));
}

/**
 * Sweep stale validation requests: re-tally those past their expiry so they
 * resolve (on quorum) or are marked `expired`. Returns the count swept. Intended
 * to run periodically (alongside `seedDefaultRules`) and is a no-op when there
 * is nothing to do.
 */
export async function sweepValidations(): Promise<number> {
  const stale = await ValidationRequest.find({
    status: { $in: ['pending', 'quorum_met'] },
    expiresAt: { $lte: new Date() },
  })
    .select('_id')
    .limit(200)
    .lean<Array<{ _id: { toString(): string } }>>();

  for (const request of stale) {
    await tallyAndResolve(request._id.toString());
  }
  return stale.length;
}
