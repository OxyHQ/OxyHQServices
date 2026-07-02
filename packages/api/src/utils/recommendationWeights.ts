/**
 * Recommendation scoring weight profiles and the pure resolver that merges a
 * default profile, an optional per-app profile, and caller-supplied per-request
 * overrides into the final, CLAMPED signal weights used by the scorer.
 *
 * This module is the SINGLE SOURCE OF TRUTH for every scoring constant, cap, and
 * normalization bound. It is intentionally DB-free (no Mongoose) so it can be
 * unit-tested in isolation and imported by the scorer without loading a model.
 */

import { clamp, INFLUENCE_MIN, INFLUENCE_MAX } from './reputation.constants';

/** The seven scoring signals the recommendation pipeline weights. */
export type RecommendationSignal =
  | 'graph'
  | 'completeness'
  | 'verified'
  | 'curation'
  | 'interest'
  | 'appBoost'
  | 'repCandidate';

export const RECOMMENDATION_SIGNALS: readonly RecommendationSignal[] = [
  'graph',
  'completeness',
  'verified',
  'curation',
  'interest',
  'appBoost',
  'repCandidate',
] as const;

/** A resolved set of scoring weights, one per signal. */
export type RecommendationWeights = Record<RecommendationSignal, number>;

/**
 * A weight profile: the default weight for every signal plus the inclusive
 * [min, max] range each weight may be overridden into. Caller overrides are
 * clamped into this range, so a profile can both bias the defaults AND bound how
 * far a request may re-weight a signal.
 */
export interface WeightProfile {
  weights: RecommendationWeights;
  ranges: Record<RecommendationSignal, { min: number; max: number }>;
}

/** Hard bound on any scoring weight, mirroring the contract's 0..10 input cap. */
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 10;

// =============================================================================
// CANDIDATE-POOL & PIPELINE CAPS
// =============================================================================

/**
 * Window of the highest-mutual-overlap candidates to pre-aggregate before
 * scoring (people followed by the people the viewer follows). Keeps the
 * mutual-count map bounded regardless of how many accounts the viewer follows.
 */
export const MUTUAL_COUNT_WINDOW = 300;

/** Max followed accounts to feed the mutual-overlap aggregation. */
export const MAX_FOLLOWING_FOR_MUTUALS = 2000;

/**
 * Hard cap on the viewer's own mutual-follow id set (`getMutualUserIds`, which
 * powers Mention's "Mutuals" feed). Bounds BOTH the following window scanned and
 * the number of ids returned, so the `$in` query and the response payload stay
 * small regardless of how many accounts the viewer follows.
 */
export const MAX_MUTUAL_IDS = 5000;

/**
 * Hard cap on the viewer's "follows-of-follows" id set (`getFollowsOfFollowsIds`,
 * which SEEDS Mention's friends-of-friends feed). Bounds BOTH the viewer's own
 * following set scanned for exclusion AND the number of ids returned, so the
 * `$nin`/`$in` clauses and the response payload stay small regardless of how many
 * accounts the viewer follows.
 */
export const MAX_FOLLOWS_OF_FOLLOWS_IDS = 5000;

/**
 * Max first-hop follows sampled (most-recent first) as the seed set for the
 * second hop of `getFollowsOfFollowsIds`. Caps the fan-out: without it a viewer
 * who follows tens of thousands of accounts would scan every one of their
 * follows' following edges. The sample is the viewer's most-recent follows, so
 * the recommendation tracks their current interests.
 */
export const MAX_FOF_FIRST_HOP = 500;

/** Max app-signal candidates pulled into the candidate union per request. */
export const MAX_APP_SIGNAL_CANDIDATES = 500;

/** Upper bound on the per-viewer Redis result-cache TTL (seconds). */
export const REC_CACHE_TTL_SECONDS = 90;

// =============================================================================
// NORMALIZATION BOUNDS
// =============================================================================

/**
 * `repCandidate` is the user's denormalized `reputationRankWeight`, which lives
 * in [INFLUENCE_MIN, INFLUENCE_MAX]. It is normalized to [0, 1] across that span
 * so a floor-reputation user contributes ~0 and a capped user contributes ~1.
 */
export const REP_WEIGHT_NORM_MIN = INFLUENCE_MIN;
export const REP_WEIGHT_NORM_MAX = INFLUENCE_MAX;

/**
 * Saturation point for the endorsement roll-up: `endorsementScore` is normalized
 * to [0, 1] by dividing by this value and clamping, so a single strong endorser
 * does not dominate while a well-endorsed account saturates near 1.
 */
export const ENDORSEMENT_SCORE_SATURATION = 10;

/** Saturation point for mutual-connection overlap, normalized to [0, 1]. */
export const MUTUAL_COUNT_SATURATION = 20;

/** Default weight profile applied to every app unless one overrides it. */
export const DEFAULT_WEIGHT_PROFILE: WeightProfile = {
  weights: {
    graph: 3,
    completeness: 1,
    verified: 1.5,
    curation: 2,
    interest: 1.5,
    appBoost: 2,
    repCandidate: 2,
  },
  ranges: {
    graph: { min: 0, max: 6 },
    completeness: { min: 0, max: 4 },
    verified: { min: 0, max: 4 },
    curation: { min: 0, max: 5 },
    interest: { min: 0, max: 5 },
    appBoost: { min: 0, max: 6 },
    repCandidate: { min: 0, max: 6 },
  },
};

/**
 * Per-app weight profiles keyed by Application `_id`. Mention's app id is read
 * from `MENTION_APPLICATION_ID` (the only app with a bespoke profile today);
 * when the env var is unset no app-specific profile is registered and every
 * caller falls back to {@link DEFAULT_WEIGHT_PROFILE}.
 */
export function buildWeightProfiles(): Record<string, WeightProfile> {
  const profiles: Record<string, WeightProfile> = {};

  const mentionAppId = process.env.MENTION_APPLICATION_ID;
  if (mentionAppId) {
    profiles[mentionAppId] = {
      // Mention is graph- and curation-led: who you follow and who curators
      // (lists / starter packs) endorse matter more than raw verification.
      weights: {
        graph: 4,
        completeness: 1,
        verified: 1,
        curation: 3,
        interest: 2,
        appBoost: 2,
        repCandidate: 2.5,
      },
      ranges: {
        graph: { min: 0, max: 6 },
        completeness: { min: 0, max: 4 },
        verified: { min: 0, max: 4 },
        curation: { min: 0, max: 6 },
        interest: { min: 0, max: 6 },
        appBoost: { min: 0, max: 6 },
        repCandidate: { min: 0, max: 6 },
      },
    };
  }

  return profiles;
}

/**
 * Resolve the final scoring weights for a request.
 *
 * Precedence: default profile → per-app profile (by `clientId` = Application
 * `_id`) → caller `signalWeights` overrides. Each caller override is CLAMPED to
 * the resolved profile's per-signal [min, max] range, so a request can re-weight
 * a signal but never escape the profile's bounds. An unknown `clientId` silently
 * resolves to the default profile.
 */
export function resolveWeightProfile(
  clientId?: string,
  overrides?: Partial<Record<RecommendationSignal, number>>
): RecommendationWeights {
  const profiles = buildWeightProfiles();
  const profile =
    (clientId && profiles[clientId]) || DEFAULT_WEIGHT_PROFILE;

  const resolved: RecommendationWeights = { ...profile.weights };

  if (overrides) {
    for (const signal of RECOMMENDATION_SIGNALS) {
      const override = overrides[signal];
      if (typeof override === 'number' && Number.isFinite(override)) {
        const { min, max } = profile.ranges[signal];
        resolved[signal] = clamp(override, min, max);
      }
    }
  }

  return resolved;
}

/** Normalize a denormalized reputation rank weight to [0, 1]. */
export function normalizeRepWeight(rankWeight: number): number {
  const span = REP_WEIGHT_NORM_MAX - REP_WEIGHT_NORM_MIN;
  if (span <= 0) return 0;
  return clamp((rankWeight - REP_WEIGHT_NORM_MIN) / span, 0, 1);
}

export { INFLUENCE_MIN, INFLUENCE_MAX };
