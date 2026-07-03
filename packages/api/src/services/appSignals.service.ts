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
import { AppAffinityEdge } from '../models/AppAffinityEdge';
import { AppAffinityEventSeen } from '../models/AppAffinityEventSeen';
import { User } from '../models/User';
import reputationService from './reputation.service';
import {
  ENDORSEMENT_RECEIVED_ACTION,
  INFLUENCE_MIN,
} from '../utils/reputation.constants';
import { decayAffinity, affinityEventWeight } from '../utils/recommendationWeights';
import { logger } from '../utils/logger';
import type {
  AppEndorsementInput,
  AppInterestInput,
  AppAffinityEvent,
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

/** Outcome of an interaction-affinity-event ingest batch. */
export interface AffinityIngestResult {
  /** Events successfully folded into an affinity edge. */
  applied: number;
  /** New affinity edges created (a subset of `applied`). */
  edgesCreated: number;
  /** Events skipped as duplicates (repeated `eventId`). */
  duplicate: number;
  /** Events rejected (invalid id, self-edge, or unweighted unknown type). */
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

  /**
   * Fold a batch of directed interaction events into per-app affinity edges.
   *
   * For each valid event `fromUserId → toUserId` (self-edges and malformed ids
   * rejected; a supplied `eventId` deduped via the bounded `AppAffinityEventSeen`
   * ledger): the existing edge's stored `affinity` is DECAYED from its
   * `lastEventAt` to now, then the event's additive weight (a caller override or
   * the per-type default) is ADDED; `lastEventAt` is advanced to the event time
   * (or now) and `eventCount` incremented. A missing edge is created at the
   * event's weight. This is a per-edge read-modify-write (decay-then-add cannot
   * be expressed as a single atomic `$inc`); the unique index makes a lost
   * create-race safe (the loser retries the update path).
   *
   * Correctness-first and independent per event: a single bad event never fails
   * the batch, and the whole operation is a strict no-op when `events` is empty.
   */
  async ingestAffinityEvents(
    applicationId: string,
    events: AppAffinityEvent[]
  ): Promise<AffinityIngestResult> {
    const appObjectId = toObjectId(applicationId);
    if (!appObjectId) {
      throw new Error('Invalid applicationId');
    }

    const result: AffinityIngestResult = {
      applied: 0,
      edgesCreated: 0,
      duplicate: 0,
      invalid: 0,
    };

    for (const event of events) {
      const fromUserId = toObjectId(event.fromUserId);
      const toUserId = toObjectId(event.toUserId);

      // Reject malformed ids and self-edges (a user cannot build affinity toward
      // themselves — it would only pollute their own recommendation surface).
      if (!fromUserId || !toUserId || fromUserId.equals(toUserId)) {
        result.invalid += 1;
        continue;
      }

      const weight = affinityEventWeight(event.type, event.weight);
      // A zero weight (unknown type with no override) carries no affinity — skip
      // it as invalid rather than touching the edge / advancing its decay clock.
      if (weight <= 0) {
        result.invalid += 1;
        continue;
      }

      // Idempotency: an app-supplied eventId is folded at most once. The unique
      // (applicationId, eventId) index + TTL bound the ledger; a duplicate insert
      // (or a pre-existing marker) marks the event as already seen.
      if (event.eventId) {
        const alreadySeen = await this.reserveAffinityEventId(appObjectId, event.eventId);
        if (alreadySeen) {
          result.duplicate += 1;
          continue;
        }
      }

      const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
      const eventAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

      await this.foldAffinityEdge(appObjectId, fromUserId, toUserId, weight, eventAt, result);
    }

    return result;
  }

  /**
   * Record an app-supplied `eventId` as seen for this application. Returns `true`
   * when the id was ALREADY seen (this delivery is a duplicate), `false` when it
   * was newly reserved (fold it). A lost unique-index race resolves to "already
   * seen" so concurrent duplicate deliveries fold at most once.
   */
  private async reserveAffinityEventId(
    applicationId: mongoose.Types.ObjectId,
    eventId: string
  ): Promise<boolean> {
    try {
      await AppAffinityEventSeen.create({ applicationId, eventId });
      return false;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        return true;
      }
      throw error;
    }
  }

  /**
   * Decay-then-add one interaction onto a directed affinity edge. Creates the
   * edge when absent; on a lost create-race (concurrent insert) it falls back to
   * the same decay-then-add update path against the winning edge.
   */
  private async foldAffinityEdge(
    applicationId: mongoose.Types.ObjectId,
    fromUserId: mongoose.Types.ObjectId,
    toUserId: mongoose.Types.ObjectId,
    weight: number,
    eventAt: Date,
    result: AffinityIngestResult
  ): Promise<void> {
    const now = Date.now();
    const existing = await AppAffinityEdge.findOne({ applicationId, fromUserId, toUserId });

    if (!existing) {
      try {
        await AppAffinityEdge.create({
          applicationId,
          fromUserId,
          toUserId,
          affinity: weight,
          lastEventAt: eventAt,
          eventCount: 1,
        });
        result.applied += 1;
        result.edgesCreated += 1;
        return;
      } catch (error) {
        // Concurrent insert won the unique-index race — fall through to the
        // update path so this event's weight is still folded onto the winner.
        if (
          !(error instanceof Error &&
            'code' in error &&
            (error as { code?: number }).code === 11000)
        ) {
          throw error;
        }
      }
    }

    const storedAffinity = existing && typeof existing.affinity === 'number' ? existing.affinity : 0;
    const storedLastEventAt = existing?.lastEventAt ?? null;
    const decayed = decayAffinity(storedAffinity, storedLastEventAt, now);
    // Advance the decay reference to the later of the stored point and this
    // event so an out-of-order (older) event never rewinds the edge's clock.
    const storedMs = storedLastEventAt instanceof Date ? storedLastEventAt.getTime() : 0;
    const nextLastEventAt = eventAt.getTime() >= storedMs ? eventAt : new Date(storedMs);

    await AppAffinityEdge.updateOne(
      { applicationId, fromUserId, toUserId },
      {
        $set: { affinity: decayed + weight, lastEventAt: nextLastEventAt },
        $inc: { eventCount: 1 },
        $setOnInsert: { applicationId, fromUserId, toUserId },
      },
      { upsert: true }
    );
    result.applied += 1;
  }
}

export const appSignalsService = new AppSignalsService();
export default appSignalsService;
