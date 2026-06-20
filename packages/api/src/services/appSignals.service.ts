/**
 * App-signal ingest service — the single write path for the cross-app
 * recommendation signals reported via `POST /app-signals/ingest`.
 *
 * Two signal kinds:
 *  - ENDORSEMENTS: an owner endorses a member in a consuming app (e.g. adds them
 *    to a list / starter pack). The endorsement is weighted by the OWNER's
 *    reputation-derived ranking weight, summed into the member's per-app
 *    `AppUserSignal.endorsementScore`, and awards the MEMBER reputation
 *    (`endorsement_received`). The edge ledger (`AppEndorsementEdge`) is the
 *    source of truth so a `remove` subtracts exactly the weight that was added.
 *  - INTERESTS: an app reports how interested a user is in its content, stored as
 *    the latest [0, 1] value on `AppUserSignal.interestScore`.
 *
 * Idempotency:
 *  - Endorsement edges are keyed by (applicationId, ownerId, memberId, sourceId);
 *    re-ingesting the same `add` is a no-op (the edge already exists), and the
 *    member award is idempotent on (applicationId, sourceActionId = edge id).
 *  - A `remove` for an edge that does not exist is a no-op.
 */

import mongoose from 'mongoose';

import { AppUserSignal } from '../models/AppUserSignal';
import { AppEndorsementEdge } from '../models/AppEndorsementEdge';
import { User } from '../models/User';
import reputationService from './reputation.service';
import {
  ENDORSEMENT_RECEIVED_ACTION,
  INFLUENCE_MIN,
} from '../utils/reputation.constants';
import { logger } from '../utils/logger';
import type {
  AppEndorsementInput,
  AppInterestInput,
} from '@oxyhq/contracts';

/** Outcome of an endorsement-ingest batch. */
export interface EndorsementIngestResult {
  /** Edges newly created (op add, edge did not exist). */
  added: number;
  /** Edges removed (op remove, edge existed). */
  removed: number;
  /** Edges skipped (already-present add, or remove of a missing edge). */
  skipped: number;
  /** Edges rejected (invalid id, owner === member). */
  invalid: number;
}

/** Outcome of an interest-ingest batch. */
export interface InterestIngestResult {
  /** Interest signals written (upserted). */
  upserted: number;
  /** Interest signals rejected (invalid id). */
  invalid: number;
}

function toObjectId(value: string): mongoose.Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

class AppSignalsService {
  /**
   * Resolve the ranking weight of an endorsement giver. Prefers the denormalized
   * `User.reputationRankWeight` (cheap, kept in sync by recalculateBalance) and
   * falls back to the reputation service's capped `ranking` influence when the
   * denorm field is absent. A user with no reputation resolves to the influence
   * floor (`INFLUENCE_MIN`), so a zero-reputation endorser contributes the
   * minimum, not zero — but never a disproportionate boost.
   */
  private async resolveOwnerWeight(ownerId: mongoose.Types.ObjectId): Promise<number> {
    const user = await User.findById(ownerId)
      .select('reputationRankWeight')
      .lean();
    if (user && typeof user.reputationRankWeight === 'number') {
      return user.reputationRankWeight;
    }
    try {
      const influence = await reputationService.getInfluence(
        ownerId.toString(),
        'ranking'
      );
      return influence.weight;
    } catch (error) {
      logger.warn('appSignals: failed to resolve owner ranking weight; using floor', {
        component: 'appSignals.service',
        ownerId: ownerId.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return INFLUENCE_MIN;
    }
  }

  /**
   * Apply a batch of endorsement edges for one application. Each edge is applied
   * independently and idempotently; a single bad edge never fails the batch.
   */
  async ingestEndorsements(
    applicationId: string,
    edges: AppEndorsementInput[]
  ): Promise<EndorsementIngestResult> {
    const appObjectId = toObjectId(applicationId);
    if (!appObjectId) {
      throw new Error('Invalid applicationId');
    }

    const result: EndorsementIngestResult = {
      added: 0,
      removed: 0,
      skipped: 0,
      invalid: 0,
    };

    for (const edge of edges) {
      const ownerId = toObjectId(edge.ownerId);
      const memberId = toObjectId(edge.memberId);
      const sourceId = edge.sourceId ?? '';

      // Reject malformed ids and self-endorsement (a user cannot endorse
      // themselves into the recommendation surface).
      if (!ownerId || !memberId || ownerId.equals(memberId)) {
        result.invalid += 1;
        continue;
      }

      if (edge.op === 'remove') {
        await this.removeEdge(appObjectId, ownerId, memberId, sourceId, result);
      } else {
        await this.addEdge(appObjectId, ownerId, memberId, sourceId, result);
      }
    }

    return result;
  }

  /** Apply a single `add` edge idempotently. */
  private async addEdge(
    applicationId: mongoose.Types.ObjectId,
    ownerId: mongoose.Types.ObjectId,
    memberId: mongoose.Types.ObjectId,
    sourceId: string,
    result: EndorsementIngestResult
  ): Promise<void> {
    // Idempotency: if the edge already exists, this add is a no-op (the score
    // already includes its weight and the member was already awarded).
    const existing = await AppEndorsementEdge.findOne({
      applicationId,
      ownerId,
      memberId,
      sourceId,
    });
    if (existing) {
      result.skipped += 1;
      return;
    }

    const weight = await this.resolveOwnerWeight(ownerId);

    let edgeId: mongoose.Types.ObjectId;
    try {
      const created = await AppEndorsementEdge.create({
        applicationId,
        ownerId,
        memberId,
        sourceId,
        weight,
      });
      edgeId = created._id;
    } catch (error) {
      // Concurrent insert lost the unique-index race — the winner already
      // applied the score and award, so treat this as a skip.
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        result.skipped += 1;
        return;
      }
      throw error;
    }

    // Increment the member's per-app roll-up by the applied weight.
    await AppUserSignal.updateOne(
      { applicationId, userId: memberId },
      {
        $inc: { endorsementScore: weight, endorsementCount: 1 },
        $set: { lastEndorsedAt: new Date() },
        $setOnInsert: { applicationId, userId: memberId },
      },
      { upsert: true }
    );

    // Award the MEMBER (not the giver). Idempotent on (applicationId,
    // sourceActionId = edge id), so a retried ingest never double-awards.
    try {
      await reputationService.award({
        userId: memberId.toString(),
        actionType: ENDORSEMENT_RECEIVED_ACTION,
        applicationId: applicationId.toString(),
        sourceActionId: edgeId.toString(),
        sourceActionType: ENDORSEMENT_RECEIVED_ACTION,
        targetEntityId: edgeId.toString(),
        targetEntityType: 'user',
      });
    } catch (error) {
      // A missing/disabled rule must not fail the whole ingest — the edge and
      // roll-up are already applied; surface the award failure for diagnosis.
      logger.warn('appSignals: endorsement_received award failed', {
        component: 'appSignals.service',
        memberId: memberId.toString(),
        edgeId: edgeId.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    result.added += 1;
  }

  /** Apply a single `remove` edge idempotently. */
  private async removeEdge(
    applicationId: mongoose.Types.ObjectId,
    ownerId: mongoose.Types.ObjectId,
    memberId: mongoose.Types.ObjectId,
    sourceId: string,
    result: EndorsementIngestResult
  ): Promise<void> {
    const existing = await AppEndorsementEdge.findOneAndDelete({
      applicationId,
      ownerId,
      memberId,
      sourceId,
    });
    if (!existing) {
      // Removing an edge that was never applied is a no-op.
      result.skipped += 1;
      return;
    }

    // Subtract exactly the weight that was applied when the edge was added,
    // regardless of the owner's current reputation.
    await AppUserSignal.updateOne(
      { applicationId, userId: memberId },
      {
        $inc: { endorsementScore: -existing.weight, endorsementCount: -1 },
      }
    );

    // The member's reputation award is intentionally NOT reversed here — an
    // endorsement that happened still happened; only the live ranking signal is
    // withdrawn. (Reversals are a staff/dispute action on the ledger.)
    result.removed += 1;
  }

  /**
   * Upsert a batch of interest signals for one application. Each item sets the
   * latest interest score (last write wins) on the member's per-app roll-up.
   */
  async ingestInterests(
    applicationId: string,
    items: AppInterestInput[]
  ): Promise<InterestIngestResult> {
    const appObjectId = toObjectId(applicationId);
    if (!appObjectId) {
      throw new Error('Invalid applicationId');
    }

    const result: InterestIngestResult = { upserted: 0, invalid: 0 };

    for (const item of items) {
      const userId = toObjectId(item.userId);
      if (!userId) {
        result.invalid += 1;
        continue;
      }

      await AppUserSignal.updateOne(
        { applicationId: appObjectId, userId },
        {
          $set: { interestScore: item.interestScore },
          $setOnInsert: { applicationId: appObjectId, userId },
        },
        { upsert: true }
      );
      result.upserted += 1;
    }

    return result;
  }
}

export const appSignalsService = new AppSignalsService();
export default appSignalsService;
