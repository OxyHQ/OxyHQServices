/**
 * recommendationWeights tests — the pure weight resolver and normalizers.
 *
 * No DB, no models. Asserts that:
 *  - an unknown / absent clientId resolves to the default profile,
 *  - a matched per-app (Mention) profile overrides the defaults,
 *  - caller overrides are CLAMPED into the resolved profile's per-signal range,
 *  - the reputation-weight normalizer maps [INFLUENCE_MIN, INFLUENCE_MAX] → [0, 1].
 *
 * `resolveWeightProfile` reads `MENTION_APPLICATION_ID` at call time (via
 * `buildWeightProfiles()`), so the env var can be toggled per test without
 * reloading the module.
 */

import { INFLUENCE_MIN, INFLUENCE_MAX } from '../reputation.constants';
import {
  resolveWeightProfile,
  normalizeRepWeight,
  DEFAULT_WEIGHT_PROFILE,
  RECOMMENDATION_SIGNALS,
  decayAffinity,
  affinityEventWeight,
  normalizeAffinity,
  AFFINITY_HALF_LIFE_MS,
  AFFINITY_EVENT_WEIGHTS,
  AFFINITY_SATURATION,
} from '../recommendationWeights';

describe('resolveWeightProfile', () => {
  const ORIGINAL_ENV = process.env.MENTION_APPLICATION_ID;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.MENTION_APPLICATION_ID;
    } else {
      process.env.MENTION_APPLICATION_ID = ORIGINAL_ENV;
    }
  });

  it('returns the default profile for an absent clientId', () => {
    expect(resolveWeightProfile()).toEqual(DEFAULT_WEIGHT_PROFILE.weights);
  });

  it('returns the default profile for an unknown clientId', () => {
    expect(resolveWeightProfile('some-unregistered-app-id')).toEqual(
      DEFAULT_WEIGHT_PROFILE.weights,
    );
  });

  it('returns a complete weight set (every signal present)', () => {
    const resolved = resolveWeightProfile();
    for (const signal of RECOMMENDATION_SIGNALS) {
      expect(typeof resolved[signal]).toBe('number');
    }
  });

  it('uses the Mention profile when clientId matches MENTION_APPLICATION_ID', () => {
    process.env.MENTION_APPLICATION_ID = '64f7c2a1b8e9d3f4a1c2b3d4';
    const mention = resolveWeightProfile('64f7c2a1b8e9d3f4a1c2b3d4');
    // Mention leans harder on graph than the default profile.
    expect(mention.graph).toBeGreaterThan(DEFAULT_WEIGHT_PROFILE.weights.graph);
  });

  it('clamps a caller override above the profile range down to the range max', () => {
    const resolved = resolveWeightProfile(undefined, { graph: 1000 });
    expect(resolved.graph).toBe(DEFAULT_WEIGHT_PROFILE.ranges.graph.max);
  });

  it('clamps a negative caller override up to the range min', () => {
    const resolved = resolveWeightProfile(undefined, { interest: -50 });
    expect(resolved.interest).toBe(DEFAULT_WEIGHT_PROFILE.ranges.interest.min);
  });

  it('applies an in-range caller override verbatim', () => {
    const inRange = DEFAULT_WEIGHT_PROFILE.ranges.curation.min + 1;
    const resolved = resolveWeightProfile(undefined, { curation: inRange });
    expect(resolved.curation).toBe(inRange);
  });

  it('includes affinity in the resolved default weight set', () => {
    const resolved = resolveWeightProfile();
    expect(typeof resolved.affinity).toBe('number');
    expect(resolved.affinity).toBe(DEFAULT_WEIGHT_PROFILE.weights.affinity);
  });

  it('clamps an affinity override above the range down to the range max', () => {
    const resolved = resolveWeightProfile(undefined, { affinity: 1000 });
    expect(resolved.affinity).toBe(DEFAULT_WEIGHT_PROFILE.ranges.affinity.max);
  });

  it('clamps a negative affinity override up to the range min', () => {
    const resolved = resolveWeightProfile(undefined, { affinity: -50 });
    expect(resolved.affinity).toBe(DEFAULT_WEIGHT_PROFILE.ranges.affinity.min);
  });

  it('weights affinity higher for Mention than the default profile', () => {
    process.env.MENTION_APPLICATION_ID = '64f7c2a1b8e9d3f4a1c2b3d4';
    const mention = resolveWeightProfile('64f7c2a1b8e9d3f4a1c2b3d4');
    expect(mention.affinity).toBeGreaterThan(DEFAULT_WEIGHT_PROFILE.weights.affinity);
  });

  it('ignores a non-finite caller override (keeps the profile default)', () => {
    const resolved = resolveWeightProfile(undefined, { graph: Number.NaN });
    expect(resolved.graph).toBe(DEFAULT_WEIGHT_PROFILE.weights.graph);
  });
});

describe('normalizeRepWeight', () => {
  it('maps the influence floor to 0 and the cap to 1', () => {
    expect(normalizeRepWeight(INFLUENCE_MIN)).toBeCloseTo(0, 6);
    expect(normalizeRepWeight(INFLUENCE_MAX)).toBeCloseTo(1, 6);
  });

  it('clamps out-of-range inputs to [0, 1]', () => {
    expect(normalizeRepWeight(INFLUENCE_MIN - 5)).toBe(0);
    expect(normalizeRepWeight(INFLUENCE_MAX + 5)).toBe(1);
  });

  it('maps the midpoint to ~0.5', () => {
    const mid = (INFLUENCE_MIN + INFLUENCE_MAX) / 2;
    expect(normalizeRepWeight(mid)).toBeCloseTo(0.5, 6);
  });
});

describe('decayAffinity', () => {
  const NOW = 1_800_000_000_000; // fixed reference time

  it('returns the stored value unchanged when elapsed is 0', () => {
    expect(decayAffinity(10, new Date(NOW), NOW)).toBe(10);
  });

  it('halves the stored value after exactly one half-life', () => {
    const lastEventAt = new Date(NOW - AFFINITY_HALF_LIFE_MS);
    expect(decayAffinity(10, lastEventAt, NOW)).toBeCloseTo(5, 9);
  });

  it('quarters the stored value after two half-lives', () => {
    const lastEventAt = new Date(NOW - 2 * AFFINITY_HALF_LIFE_MS);
    expect(decayAffinity(10, lastEventAt, NOW)).toBeCloseTo(2.5, 9);
  });

  it('is strictly monotonically decreasing in elapsed time', () => {
    const oneDay = 24 * 60 * 60 * 1000;
    const a = decayAffinity(10, new Date(NOW - oneDay), NOW);
    const b = decayAffinity(10, new Date(NOW - 5 * oneDay), NOW);
    const c = decayAffinity(10, new Date(NOW - 30 * oneDay), NOW);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });

  it('never amplifies for a future (negative-elapsed) lastEventAt — clock skew safe', () => {
    const future = new Date(NOW + AFFINITY_HALF_LIFE_MS);
    expect(decayAffinity(10, future, NOW)).toBe(10);
  });

  it('returns the stored value when lastEventAt is missing', () => {
    expect(decayAffinity(10, null, NOW)).toBe(10);
    expect(decayAffinity(10, undefined, NOW)).toBe(10);
  });

  it('returns 0 for a zero or non-finite stored value', () => {
    expect(decayAffinity(0, new Date(NOW - AFFINITY_HALF_LIFE_MS), NOW)).toBe(0);
    expect(decayAffinity(Number.NaN, new Date(NOW), NOW)).toBe(0);
  });

  it('accepts a numeric lastEventAt as well as a Date', () => {
    const numeric = decayAffinity(10, NOW - AFFINITY_HALF_LIFE_MS, NOW);
    const asDate = decayAffinity(10, new Date(NOW - AFFINITY_HALF_LIFE_MS), NOW);
    expect(numeric).toBeCloseTo(asDate, 12);
  });
});

describe('affinityEventWeight', () => {
  it('returns the per-type default when no override is supplied', () => {
    expect(affinityEventWeight('follow')).toBe(AFFINITY_EVENT_WEIGHTS.follow);
    expect(affinityEventWeight('like')).toBe(AFFINITY_EVENT_WEIGHTS.like);
    expect(affinityEventWeight('profile_view')).toBe(AFFINITY_EVENT_WEIGHTS.profile_view);
  });

  it('ranks follow/reply/quote above passive interactions like profile_view', () => {
    expect(affinityEventWeight('follow')).toBeGreaterThan(affinityEventWeight('profile_view'));
    expect(affinityEventWeight('reply')).toBeGreaterThan(affinityEventWeight('like'));
  });

  it('honors a finite non-negative caller override over the default', () => {
    expect(affinityEventWeight('like', 9)).toBe(9);
    expect(affinityEventWeight('like', 0)).toBe(0);
  });

  it('ignores a negative or non-finite override and falls back to the default', () => {
    expect(affinityEventWeight('like', -1)).toBe(AFFINITY_EVENT_WEIGHTS.like);
    expect(affinityEventWeight('like', Number.NaN)).toBe(AFFINITY_EVENT_WEIGHTS.like);
  });

  it('returns 0 for an unknown type with no override (harmless no-op)', () => {
    expect(affinityEventWeight('unknown_type')).toBe(0);
  });
});

describe('normalizeAffinity', () => {
  it('maps 0 and negative values to 0', () => {
    expect(normalizeAffinity(0)).toBe(0);
    expect(normalizeAffinity(-5)).toBe(0);
  });

  it('maps the saturation point to 1 and saturates above it', () => {
    expect(normalizeAffinity(AFFINITY_SATURATION)).toBe(1);
    expect(normalizeAffinity(AFFINITY_SATURATION * 3)).toBe(1);
  });

  it('maps a sub-saturation value to a proportional fraction', () => {
    expect(normalizeAffinity(AFFINITY_SATURATION / 2)).toBeCloseTo(0.5, 9);
  });
});
