/**
 * Pure derivation tests for #219: trust tiers, capped influence, reliability.
 * No DB — exercises the formulas directly against the documented constants.
 */

import {
  computeReliability,
  deriveTrustTier,
  deriveInfluence,
  baseTrustWeight,
} from '../reputationDerive';
import {
  INFLUENCE_MIN,
  INFLUENCE_MAX,
  TRUST_TIER_HIGH_TRUST_MIN,
  TRUST_TIER_TRUSTED_MIN,
  NEUTRAL_REPORT_ACCURACY,
} from '../reputation.constants';
import type { ReputationReliability } from '../../models/ReputationBalance';

const NEUTRAL: ReputationReliability = {
  accurateReports: 0,
  rejectedReports: 0,
  reportAccuracyScore: NEUTRAL_REPORT_ACCURACY,
  abuseScore: 0,
};

describe('computeReliability', () => {
  it('returns the neutral 0.5 accuracy for a user with no report history', () => {
    const r = computeReliability({ accurateReports: 0, rejectedReports: 0, penaltyCount: 0 });
    expect(r.reportAccuracyScore).toBe(NEUTRAL_REPORT_ACCURACY);
    expect(r.abuseScore).toBe(0);
  });

  it('accuracy rises with accurate reports', () => {
    const r = computeReliability({ accurateReports: 9, rejectedReports: 1, penaltyCount: 0 });
    expect(r.reportAccuracyScore).toBeCloseTo(0.9, 5);
  });

  it('accuracy falls with rejected reports', () => {
    const r = computeReliability({ accurateReports: 1, rejectedReports: 9, penaltyCount: 0 });
    expect(r.reportAccuracyScore).toBeCloseTo(0.1, 5);
  });

  it('abuse score is smoothed and clamped to [0,1]', () => {
    // rejected=10, penalties=10 → numerator 10 + 2*10 = 30; denom 0+10+10+5 = 25
    // raw = 1.2 → clamped to 1.
    const r = computeReliability({ accurateReports: 0, rejectedReports: 10, penaltyCount: 10 });
    expect(r.abuseScore).toBe(1);
  });
});

describe('deriveTrustTier (#219 thresholds)', () => {
  it('a fresh user with zero total is "new"', () => {
    expect(deriveTrustTier(0, false, NEUTRAL)).toBe('new');
  });

  it(`total >= ${TRUST_TIER_TRUSTED_MIN} is "trusted"`, () => {
    expect(deriveTrustTier(TRUST_TIER_TRUSTED_MIN, false, NEUTRAL)).toBe('trusted');
    expect(deriveTrustTier(TRUST_TIER_TRUSTED_MIN - 1, false, NEUTRAL)).toBe('new');
  });

  it(`total >= ${TRUST_TIER_HIGH_TRUST_MIN} is "high_trust"`, () => {
    expect(deriveTrustTier(TRUST_TIER_HIGH_TRUST_MIN, false, NEUTRAL)).toBe('high_trust');
    expect(deriveTrustTier(TRUST_TIER_HIGH_TRUST_MIN - 1, false, NEUTRAL)).toBe('trusted');
  });

  it('a negative total forces "restricted" regardless of verified', () => {
    expect(deriveTrustTier(-1, true, NEUTRAL)).toBe('restricted');
  });

  it('a high abuse score forces "restricted" even with a high total', () => {
    const abusive: ReputationReliability = { ...NEUTRAL, abuseScore: 0.5 };
    expect(deriveTrustTier(10_000, false, abusive)).toBe('restricted');
  });

  it('verified beats both high_trust and trusted thresholds', () => {
    expect(deriveTrustTier(0, true, NEUTRAL)).toBe('verified');
    expect(deriveTrustTier(TRUST_TIER_HIGH_TRUST_MIN, true, NEUTRAL)).toBe('verified');
  });
});

describe('deriveInfluence (#219 capped weights)', () => {
  it('base weight at total=0 is the floor offset', () => {
    expect(baseTrustWeight(0)).toBeCloseTo(0.1, 5);
  });

  it('every weight is clamped to [INFLUENCE_MIN, INFLUENCE_MAX]', () => {
    const inf = deriveInfluence(1_000_000, 'verified', NEUTRAL);
    for (const weight of Object.values(inf)) {
      expect(weight).toBeGreaterThanOrEqual(INFLUENCE_MIN);
      expect(weight).toBeLessThanOrEqual(INFLUENCE_MAX);
    }
    // A pathologically large total saturates the default weight at the cap.
    expect(inf.defaultWeight).toBe(INFLUENCE_MAX);
  });

  it('restricted users are floored to INFLUENCE_MIN on every axis', () => {
    const inf = deriveInfluence(10_000, 'restricted', NEUTRAL);
    expect(inf.defaultWeight).toBe(INFLUENCE_MIN);
    expect(inf.reportWeight).toBe(INFLUENCE_MIN);
    expect(inf.moderationWeight).toBe(INFLUENCE_MIN);
    expect(inf.rankingFeedbackWeight).toBe(INFLUENCE_MIN);
  });

  it('reportWeight rises with accurate reports and falls with rejected ones', () => {
    const total = 500;
    const accurate = computeReliability({ accurateReports: 10, rejectedReports: 0, penaltyCount: 0 });
    const inaccurate = computeReliability({ accurateReports: 0, rejectedReports: 10, penaltyCount: 0 });

    const accurateWeight = deriveInfluence(total, 'high_trust', accurate).reportWeight;
    const neutralWeight = deriveInfluence(total, 'high_trust', NEUTRAL).reportWeight;
    const inaccurateWeight = deriveInfluence(total, 'high_trust', inaccurate).reportWeight;

    expect(accurateWeight).toBeGreaterThan(neutralWeight);
    expect(inaccurateWeight).toBeLessThan(neutralWeight);
  });

  it('moderation weight scales up by tier', () => {
    const total = 200;
    const newWeight = deriveInfluence(total, 'new', NEUTRAL).moderationWeight;
    const trustedWeight = deriveInfluence(total, 'trusted', NEUTRAL).moderationWeight;
    const verifiedWeight = deriveInfluence(total, 'verified', NEUTRAL).moderationWeight;
    expect(trustedWeight).toBeGreaterThan(newWeight);
    expect(verifiedWeight).toBeGreaterThan(trustedWeight);
  });
});
