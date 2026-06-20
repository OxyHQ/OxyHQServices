/**
 * Reputation system constants (product name: "Oxy Trust").
 *
 * This file is the SINGLE SOURCE OF TRUTH for every tunable in the reputation
 * ledger (#217) and the derived trust-tier / capped-influence model (#219).
 * Nothing in the reputation service, routes, or migration may hardcode any of
 * these values — import them from here so the documented, user-approved
 * defaults stay in one auditable place.
 *
 * All exports are frozen (`as const`) so the values cannot drift at runtime.
 */

/**
 * Reputation categories. Drives the per-category balance breakdown. Every
 * `ReputationRule` and `ReputationTransaction` carries exactly one of these.
 *
 * - content    — posts, comments, media a user authored.
 * - social     — follows, likes, social interactions.
 * - trust      — identity / verification / trust-graph signals.
 * - moderation — reports filed, moderation actions, review outcomes.
 * - physical   — real-world signals (event check-ins, verified purchases).
 * - penalty    — negative adjustments for abuse / policy violations.
 * - other      — anything that does not fit the buckets above.
 */
export const REPUTATION_CATEGORIES = [
  'content',
  'social',
  'trust',
  'moderation',
  'physical',
  'penalty',
  'other',
] as const;

export type ReputationCategory = (typeof REPUTATION_CATEGORIES)[number];

/**
 * Transaction lifecycle status.
 * - active   — counts toward the balance.
 * - disputed — under dispute; still counts until the dispute resolves.
 * - reversed — superseded by a compensating reversal transaction; excluded.
 * - voided   — administratively excluded with no compensating entry.
 */
export const REPUTATION_TRANSACTION_STATUSES = [
  'active',
  'disputed',
  'reversed',
  'voided',
] as const;

export type ReputationTransactionStatus = (typeof REPUTATION_TRANSACTION_STATUSES)[number];

/** Trust tiers, lowest → highest trust (plus the punitive `restricted`). */
export const TRUST_TIERS = [
  'restricted',
  'new',
  'trusted',
  'high_trust',
  'verified',
] as const;

export type TrustTier = (typeof TRUST_TIERS)[number];

/** Entity kinds a transaction may target. */
export const REPUTATION_TARGET_ENTITY_TYPES = [
  'post',
  'comment',
  'report',
  'purchase',
  'event',
  'check_in',
  'manual_review',
  'user',
  'other',
] as const;

export type ReputationTargetEntityType = (typeof REPUTATION_TARGET_ENTITY_TYPES)[number];

/** Dispute lifecycle status. */
export const REPUTATION_DISPUTE_STATUSES = [
  'open',
  'accepted',
  'rejected',
  'needs_review',
] as const;

export type ReputationDisputeStatus = (typeof REPUTATION_DISPUTE_STATUSES)[number];

// =============================================================================
// TRUST-TIER THRESHOLDS (#219)
// =============================================================================
//
// Tiers are evaluated TOP-DOWN in priority order:
//   1. restricted — total < 0 OR reliability.abuseScore >= ABUSE_RESTRICT_THRESHOLD
//   2. verified   — the User document has `verified === true`
//   3. high_trust — total >= TRUST_TIER_HIGH_TRUST_MIN
//   4. trusted    — total >= TRUST_TIER_TRUSTED_MIN
//   5. new        — everything else (the default tier)

/** Minimum lifetime total to reach the `high_trust` tier. */
export const TRUST_TIER_HIGH_TRUST_MIN = 500;

/** Minimum lifetime total to reach the `trusted` tier. */
export const TRUST_TIER_TRUSTED_MIN = 100;

/**
 * Abuse-score (0..1) at or above which a user is forced into the `restricted`
 * tier regardless of their total.
 */
export const ABUSE_RESTRICT_THRESHOLD = 0.5;

// =============================================================================
// INFLUENCE WEIGHTS (#219)
// =============================================================================
//
// Every influence weight is CLAMPED to [INFLUENCE_MIN, INFLUENCE_MAX] so no
// single user — however high their total — can dominate ranking / moderation /
// reporting. Restricted users are floored to INFLUENCE_MIN across the board.

/** Hard lower bound on any influence weight. */
export const INFLUENCE_MIN = 0.1;

/** Hard upper bound on any influence weight (the cap). */
export const INFLUENCE_MAX = 3.0;

/**
 * Divisor mapping lifetime `total` onto the base trust weight:
 *   baseTrustWeight = clamp(0.1 + total / INFLUENCE_TOTAL_DIVISOR, MIN, MAX)
 * At total=0 → 0.1; at total=500 → ~1.1; saturates at the cap well before
 * pathological totals.
 */
export const INFLUENCE_TOTAL_DIVISOR = 500;

/** Constant offset added to `total / INFLUENCE_TOTAL_DIVISOR` for the base weight. */
export const INFLUENCE_BASE_OFFSET = 0.1;

/**
 * Report-weight scaling: `reportWeight = clamp(base * (0.5 + accuracy), MIN, MAX)`.
 * A neutral accuracy of 0.5 yields a factor of 1.0 (no change); perfectly
 * accurate reporters (accuracy=1.0) get a 1.5× boost, chronically inaccurate
 * ones (accuracy=0) are halved.
 */
export const REPORT_WEIGHT_ACCURACY_OFFSET = 0.5;

/**
 * Ranking-feedback weight is deliberately damped relative to the base trust
 * weight so per-user ranking nudges stay conservative:
 *   rankingFeedbackWeight = clamp(base * RANKING_FEEDBACK_FACTOR, MIN, MAX)
 */
export const RANKING_FEEDBACK_FACTOR = 0.8;

/**
 * Per-tier multiplier applied to the base trust weight to derive the
 * moderation weight: `moderationWeight = clamp(base * factor[tier], MIN, MAX)`.
 * `restricted` is 0 (then clamped up to INFLUENCE_MIN), escalating to 1.5 for
 * verified users.
 */
export const MODERATION_TIER_FACTOR: Readonly<Record<TrustTier, number>> = {
  restricted: 0,
  new: 0.5,
  trusted: 1.0,
  high_trust: 1.25,
  verified: 1.5,
} as const;

// =============================================================================
// RELIABILITY (#219)
// =============================================================================
//
// Reliability is computed from the user's moderation track record encoded in
// their active transactions:
//   - accurateReports = count of active txns with sourceActionType === REPORT_CONFIRMED_ACTION
//   - rejectedReports = count of active txns with sourceActionType === REPORT_REJECTED_ACTION
//   - penaltyCount    = count of active txns with category 'penalty' OR points < 0
//
//   reportAccuracyScore =
//     (accurate === 0 && rejected === 0) ? NEUTRAL_REPORT_ACCURACY
//                                        : accurate / (accurate + rejected)
//
//   abuseScore = clamp(
//     (rejected + ABUSE_PENALTY_WEIGHT * penaltyCount) /
//       (accurate + rejected + penaltyCount + ABUSE_SMOOTHING),
//     0, 1)

/**
 * Canonical source action key for a confirmed (accurate) report. The
 * originating system stamps this on the awarding transaction's
 * `sourceActionType` so reliability can be recomputed purely from the ledger.
 */
export const REPORT_CONFIRMED_ACTION = 'report_confirmed';

/** Canonical source action key for a rejected (inaccurate) report. */
export const REPORT_REJECTED_ACTION = 'report_rejected';

/**
 * Report-accuracy score assigned to a user with no report history at all
 * (neither accurate nor rejected) — a neutral 0.5 so newcomers are neither
 * boosted nor penalised on the report-weight axis.
 */
export const NEUTRAL_REPORT_ACCURACY = 0.5;

/** Laplace-style smoothing added to the abuse-score denominator. */
export const ABUSE_SMOOTHING = 5;

/** Weight applied to each penalty in the abuse-score numerator. */
export const ABUSE_PENALTY_WEIGHT = 2;

// =============================================================================
// CROSS-APP SIGNAL RULES
// =============================================================================

/**
 * Canonical action key awarded to the MEMBER of an endorsement edge when a
 * consuming app reports that an owner endorsed them (`POST /app-signals/ingest`,
 * op `add`). The giver is NOT awarded — only the endorsed member gains
 * reputation. Idempotent on (applicationId, sourceActionId = edge id).
 */
export const ENDORSEMENT_RECEIVED_ACTION = 'endorsement_received';

/** Points awarded to the member of an endorsement edge (social category). */
export const ENDORSEMENT_RECEIVED_POINTS = 2;

// =============================================================================
// PAGINATION
// =============================================================================

/** Default page size for a user's transaction ledger. */
export const DEFAULT_TRANSACTION_LIMIT = 50;

/** Maximum page size for a user's transaction ledger. */
export const MAX_TRANSACTION_LIMIT = 100;

/** Default page size for the leaderboard. */
export const DEFAULT_LEADERBOARD_LIMIT = 10;

/** Maximum page size for the leaderboard. */
export const MAX_LEADERBOARD_LIMIT = 100;

/** Default page size for dispute lists. */
export const DEFAULT_DISPUTE_LIMIT = 50;

/** Maximum page size for dispute lists. */
export const MAX_DISPUTE_LIMIT = 100;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Clamp a numeric value into the inclusive range [min, max].
 * Returns `min` when `value` is NaN so a degenerate input can never escape the
 * documented bounds.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
