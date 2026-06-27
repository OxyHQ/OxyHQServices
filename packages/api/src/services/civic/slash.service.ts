/**
 * Slash Service (civic / Commons — Fase 2 Part B).
 *
 * Closes the staking loop: when a civic reputation transaction is REVERSED
 * (dispute / audit / fraud), the people who VOUCHED for it lose reputation. This
 * is what makes the random-jury + real-life signals expensive to game — an
 * endorser who backs a fraudulent claim is slashed.
 *
 * Wired from `reputationService.reverseTransaction` via a dynamic import (to
 * avoid a reputation↔slash module cycle) and is fully non-fatal: a slash failure
 * never blocks or rolls back the reversal.
 *
 *  - A reversed `peer_validated` award → slash every juror who voted `valid` on
 *    the originating request (`validation_incorrect`, -10).
 *  - A reversed `real_life_attested` award → slash the counterparty who attested
 *    it (`createdByUserId`), same penalty.
 */

import { reputationService } from '../reputation.service';
import ValidationRequest from '../../models/ValidationRequest';
import ValidationVote, { type IValidationVote } from '../../models/ValidationVote';
import {
  PEER_VALIDATED_ACTION,
  REAL_LIFE_ATTESTED_ACTION,
  VALIDATION_INCORRECT_ACTION,
} from '../../utils/reputation.constants';
import { logger } from '../../utils/logger';

/** The minimal reversed-transaction shape the slash needs. */
export interface SlashableTransaction {
  _id: unknown;
  actionType: string;
  createdByUserId?: unknown;
}

/** Apply the `validation_incorrect` slash to a user, non-fatally. */
async function slashUser(userId: string, txnId: string, reason: string): Promise<void> {
  try {
    await reputationService.award({
      userId,
      actionType: VALIDATION_INCORRECT_ACTION,
      sourceActionId: `slash:${txnId}:${userId}`,
      reason,
    });
  } catch (error) {
    logger.warn('Slash award failed (non-fatal)', {
      component: 'civic.slash',
      userId,
      txnId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fan out slashes for a reversed civic transaction. Returns the number of users
 * slashed. Best-effort: individual failures are logged and skipped.
 */
export async function slashForReversedTransaction(txn: SlashableTransaction): Promise<number> {
  const txnId = String(txn._id);
  let slashed = 0;

  if (txn.actionType === PEER_VALIDATED_ACTION) {
    const request = await ValidationRequest.findOne({ resolvedTxnId: txnId })
      .select('_id')
      .lean<{ _id: { toString(): string } } | null>();
    if (!request) {
      return 0;
    }
    const votes = await ValidationVote.find({ requestId: request._id, verdict: 'valid' })
      .select('validatorUserId')
      .lean<IValidationVote[]>();
    for (const vote of votes) {
      await slashUser(
        vote.validatorUserId.toString(),
        txnId,
        'Endorsed a verdict later reverted as fraud',
      );
      slashed += 1;
    }
    return slashed;
  }

  if (txn.actionType === REAL_LIFE_ATTESTED_ACTION && txn.createdByUserId) {
    await slashUser(
      String(txn.createdByUserId),
      txnId,
      'Real-life attestation of an action later reverted as fraud',
    );
    return 1;
  }

  return 0;
}
