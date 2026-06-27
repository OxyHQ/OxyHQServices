/**
 * Random Personhood Audit Service (civic / Commons — Fase 3).
 *
 * Keeps the web-of-trust honest after the fact: a background sweep samples a
 * random subset of `isRealPerson` users and opens a `personhood_audit`
 * ValidationRequest for each, REUSING the Fase 2 jury (`openValidationRequest` →
 * `selectValidators` → `tallyAndResolve`). A juror votes `valid` (confirmed real
 * person) or `invalid` (fake) on the SAME `POST /civic/validations/:id/vote`
 * route as any other validation — no separate voting path.
 *
 * On resolution, `validator.service.tallyAndResolve` dispatches the
 * `personhood_audit` action to {@link resolvePersonhoodAuditOutcome}:
 *  - the majority jurors are rewarded `validation_correct`;
 *  - a `rejected` outcome (jury says fake) triggers the STAKING SLASH CASCADE —
 *    every active voucher of the subject is slashed and the subject recomputed.
 *
 * The sweep is wired into `server.ts` next to the Fase 2 validation sweep, behind
 * the same unref'd-interval guard.
 */

import ValidationRequest, { type IValidationRequest } from '../../models/ValidationRequest';
import PersonhoodStatus from '../../models/PersonhoodStatus';
import { openValidationRequest } from './validator.service';
import {
  recomputePersonhood,
  slashVouchersForFakeSubject,
} from './personhood.service';
import { reputationService } from '../reputation.service';
import { buildUserDid } from '../did.service';
import { VALIDATION_CORRECT_ACTION } from '../../utils/reputation.constants';
import {
  PERSONHOOD_AUDIT_ACTION,
  PERSONHOOD_AUDIT_BATCH,
  PERSONHOOD_AUDIT_SAMPLE_RATE,
} from '../../utils/civic.constants';
import { logger } from '../../utils/logger';

/** Stable per-subject idempotency key so at most one audit is open at a time. */
function auditSourceActionId(subjectUserId: string): string {
  return `personhood_audit:${subjectUserId}`;
}

/**
 * Open a random-audit jury request for a subject. Idempotent while an audit for
 * the same subject is already open (the underlying `openValidationRequest`
 * dedups on `sourceActionId`).
 */
export async function openPersonhoodAudit(subjectUserId: string): Promise<IValidationRequest> {
  return openValidationRequest({
    subjectUserId,
    actionType: PERSONHOOD_AUDIT_ACTION,
    sourceActionId: auditSourceActionId(subjectUserId),
    payload: { kind: 'personhood_audit', subjectDid: buildUserDid(subjectUserId) },
  });
}

/**
 * Sample a random subset of `isRealPerson` users and open an audit for each that
 * does not already have one open. Returns the count of NEW audits opened. A no-op
 * when there are no real persons. Best-effort: individual failures are logged.
 */
export async function sweepPersonhoodAudits(): Promise<number> {
  const total = await PersonhoodStatus.countDocuments({ isRealPerson: true });
  if (total === 0) {
    return 0;
  }

  const sampleSize = Math.min(
    PERSONHOOD_AUDIT_BATCH,
    Math.max(1, Math.ceil(total * PERSONHOOD_AUDIT_SAMPLE_RATE)),
  );

  const sampled = await PersonhoodStatus.aggregate<{ userId: unknown }>([
    { $match: { isRealPerson: true } },
    { $sample: { size: sampleSize } },
    { $project: { userId: 1 } },
  ]);
  const subjectIds = sampled.map((doc) => String(doc.userId));
  if (subjectIds.length === 0) {
    return 0;
  }

  // Skip subjects who already have an open audit (avoids churning duplicate
  // requests across sweeps).
  const openExisting = await ValidationRequest.find({
    actionType: PERSONHOOD_AUDIT_ACTION,
    subjectUserId: { $in: subjectIds },
    status: { $in: ['pending', 'quorum_met'] },
  })
    .select('subjectUserId')
    .lean<Array<{ subjectUserId: unknown }>>();
  const alreadyOpen = new Set(openExisting.map((r) => String(r.subjectUserId)));

  let opened = 0;
  for (const subjectId of subjectIds) {
    if (alreadyOpen.has(subjectId)) {
      continue;
    }
    try {
      await openPersonhoodAudit(subjectId);
      opened += 1;
    } catch (error) {
      logger.warn('Failed to open personhood audit (non-fatal)', {
        component: 'civic.personhoodAudit',
        subjectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return opened;
}

/**
 * Resolve a `personhood_audit` request (called by `tallyAndResolve` via a dynamic
 * import to avoid a validator↔audit module cycle). Rewards the majority jurors
 * and, on a `rejected` (fake) outcome, runs the staking slash cascade. Fully
 * best-effort so a reward/slash failure never 500s the last voter's request.
 */
export async function resolvePersonhoodAuditOutcome(
  request: IValidationRequest,
  outcome: 'validated' | 'rejected',
  winningValidatorIds: string[],
): Promise<void> {
  const subjectUserId = request.subjectUserId.toString();

  for (const validatorId of winningValidatorIds) {
    try {
      await reputationService.award({
        userId: validatorId,
        actionType: VALIDATION_CORRECT_ACTION,
        sourceActionId: `${request._id.toString()}:${validatorId}:audit`,
        reason: 'Voted with the resolving majority on a personhood audit',
      });
    } catch (error) {
      logger.warn('Personhood audit juror reward failed (non-fatal)', {
        component: 'civic.personhoodAudit',
        validatorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (outcome === 'rejected') {
    try {
      await slashVouchersForFakeSubject(subjectUserId, 'Failed a random personhood audit');
    } catch (error) {
      logger.warn('Personhood audit slash cascade failed (non-fatal)', {
        component: 'civic.personhoodAudit',
        subjectUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  // A `validated` audit re-affirms the subject — recompute so the status row's
  // freshness reflects the audit.
  try {
    await recomputePersonhood(subjectUserId);
  } catch (error) {
    logger.warn('Personhood audit re-affirm recompute failed (non-fatal)', {
      component: 'civic.personhoodAudit',
      subjectUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
