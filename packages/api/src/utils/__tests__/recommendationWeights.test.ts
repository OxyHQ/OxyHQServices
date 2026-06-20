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
