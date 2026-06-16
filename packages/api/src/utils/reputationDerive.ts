/**
 * Pure derivation of trust tier, influence weights, and reliability (#219).
 *
 * These functions are intentionally DB-free and side-effect-free so they can be
 * unit-tested in isolation and reused anywhere. `reputation.service.ts` feeds
 * them aggregated counts from the ledger; they return the derived snapshot that
 * is persisted on `ReputationBalance`.
 *
 * Every constant lives in `reputation.constants.ts` — nothing here is hardcoded.
 */

import {
  clamp,
  ABUSE_PENALTY_WEIGHT,
  ABUSE_RESTRICT_THRESHOLD,
  ABUSE_SMOOTHING,
  INFLUENCE_BASE_OFFSET,
  INFLUENCE_MAX,
  INFLUENCE_MIN,
  INFLUENCE_TOTAL_DIVISOR,
  MODERATION_TIER_FACTOR,
  NEUTRAL_REPORT_ACCURACY,
  RANKING_FEEDBACK_FACTOR,
  REPORT_WEIGHT_ACCURACY_OFFSET,
  TRUST_TIER_HIGH_TRUST_MIN,
  TRUST_TIER_TRUSTED_MIN,
  type TrustTier,
} from './reputation.constants';
import type {
  ReputationInfluence,
  ReputationReliability,
} from '../models/ReputationBalance';

/** Raw moderation counts pulled from the active ledger for one user. */
export interface ReliabilityCounts {
  accurateReports: number;
  rejectedReports: number;
  penaltyCount: number;
}

/**
 * Compute the reliability block (report accuracy + abuse score) from raw
 * moderation counts.
 *
 * - reportAccuracyScore: neutral 0.5 when the user has filed no reports at all,
 *   otherwise accurate / (accurate + rejected).
 * - abuseScore: Laplace-smoothed ratio of "bad signals" (rejected reports +
 *   weighted penalties) to total moderation events, clamped to [0, 1].
 */
export function computeReliability(counts: ReliabilityCounts): ReputationReliability {
  const { accurateReports, rejectedReports, penaltyCount } = counts;

  const reportTotal = accurateReports + rejectedReports;
  const reportAccuracyScore =
    reportTotal === 0 ? NEUTRAL_REPORT_ACCURACY : accurateReports / reportTotal;

  const abuseNumerator = rejectedReports + ABUSE_PENALTY_WEIGHT * penaltyCount;
  const abuseDenominator =
    accurateReports + rejectedReports + penaltyCount + ABUSE_SMOOTHING;
  const abuseScore = clamp(abuseNumerator / abuseDenominator, 0, 1);

  return {
    accurateReports,
    rejectedReports,
    reportAccuracyScore,
    abuseScore,
  };
}

/**
 * Derive the trust tier from the lifetime total, the User's `verified` flag,
 * and the reliability block. Evaluated strictly top-down in priority order:
 *   restricted → verified → high_trust → trusted → new.
 */
export function deriveTrustTier(
  total: number,
  verified: boolean,
  reliability: ReputationReliability
): TrustTier {
  if (total < 0 || reliability.abuseScore >= ABUSE_RESTRICT_THRESHOLD) {
    return 'restricted';
  }
  if (verified) {
    return 'verified';
  }
  if (total >= TRUST_TIER_HIGH_TRUST_MIN) {
    return 'high_trust';
  }
  if (total >= TRUST_TIER_TRUSTED_MIN) {
    return 'trusted';
  }
  return 'new';
}

/**
 * The base trust weight that every influence axis scales from:
 *   clamp(INFLUENCE_BASE_OFFSET + total / INFLUENCE_TOTAL_DIVISOR, MIN, MAX).
 */
export function baseTrustWeight(total: number): number {
  return clamp(
    INFLUENCE_BASE_OFFSET + total / INFLUENCE_TOTAL_DIVISOR,
    INFLUENCE_MIN,
    INFLUENCE_MAX
  );
}

/**
 * Derive all four capped influence weights. Restricted users are floored to
 * INFLUENCE_MIN on every axis regardless of their total.
 */
export function deriveInfluence(
  total: number,
  tier: TrustTier,
  reliability: ReputationReliability
): ReputationInfluence {
  if (tier === 'restricted') {
    return {
      defaultWeight: INFLUENCE_MIN,
      reportWeight: INFLUENCE_MIN,
      moderationWeight: INFLUENCE_MIN,
      rankingFeedbackWeight: INFLUENCE_MIN,
    };
  }

  const base = baseTrustWeight(total);

  const defaultWeight = base;
  const reportWeight = clamp(
    base * (REPORT_WEIGHT_ACCURACY_OFFSET + reliability.reportAccuracyScore),
    INFLUENCE_MIN,
    INFLUENCE_MAX
  );
  const moderationWeight = clamp(
    base * MODERATION_TIER_FACTOR[tier],
    INFLUENCE_MIN,
    INFLUENCE_MAX
  );
  const rankingFeedbackWeight = clamp(
    base * RANKING_FEEDBACK_FACTOR,
    INFLUENCE_MIN,
    INFLUENCE_MAX
  );

  return { defaultWeight, reportWeight, moderationWeight, rankingFeedbackWeight };
}
