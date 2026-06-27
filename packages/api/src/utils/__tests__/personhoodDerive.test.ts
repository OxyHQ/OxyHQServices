/**
 * Pure derivation tests for Fase 3 personhood scoring. No DB — exercises the
 * `personhoodScore` formula directly against the documented civic constants.
 */

import { personhoodScore, type PersonhoodInputs } from '../personhoodDerive';
import {
  PERSONHOOD_THRESHOLD,
  PERSONHOOD_VOUCH_TARGET,
  PERSONHOOD_REAL_LIFE_TARGET,
  PERSONHOOD_VOUCH_COMPONENT,
  PERSONHOOD_REAL_LIFE_COMPONENT,
  PERSONHOOD_BIOMETRIC_COMPONENT,
} from '../civic.constants';

const base: PersonhoodInputs = {
  weightedVouchScore: 0,
  realLifeCount: 0,
  biometricBound: false,
  sybilPenalty: 0,
  isSeedVerifier: false,
};

describe('personhoodScore — seed verifiers', () => {
  it('a seed verifier is score 1 / real outright, with the seed breakdown flag', () => {
    const r = personhoodScore({ ...base, isSeedVerifier: true });
    expect(r.score).toBe(1);
    expect(r.isRealPerson).toBe(true);
    expect(r.breakdown.seed).toBe(true);
  });

  it('seed short-circuits even with a maxed sybil penalty', () => {
    const r = personhoodScore({ ...base, isSeedVerifier: true, sybilPenalty: 1 });
    expect(r.score).toBe(1);
    expect(r.isRealPerson).toBe(true);
  });
});

describe('personhoodScore — evidence blend', () => {
  it('a user with no signals scores 0 and is not a real person', () => {
    const r = personhoodScore(base);
    expect(r.score).toBe(0);
    expect(r.isRealPerson).toBe(false);
    expect(r.breakdown.seed).toBe(false);
  });

  it('a full vouch signal ALONE falls below θ (no single class suffices)', () => {
    const r = personhoodScore({ ...base, weightedVouchScore: PERSONHOOD_VOUCH_TARGET });
    expect(r.breakdown.vouchSignal).toBe(1);
    expect(r.score).toBeCloseTo(PERSONHOOD_VOUCH_COMPONENT, 5);
    expect(r.isRealPerson).toBe(PERSONHOOD_VOUCH_COMPONENT >= PERSONHOOD_THRESHOLD);
    expect(r.isRealPerson).toBe(false);
  });

  it('full vouch + biometric crosses θ', () => {
    const r = personhoodScore({
      ...base,
      weightedVouchScore: PERSONHOOD_VOUCH_TARGET,
      biometricBound: true,
    });
    expect(r.score).toBeCloseTo(PERSONHOOD_VOUCH_COMPONENT + PERSONHOOD_BIOMETRIC_COMPONENT, 5);
    expect(r.isRealPerson).toBe(true);
  });

  it('full vouch + full real-life crosses θ', () => {
    const r = personhoodScore({
      ...base,
      weightedVouchScore: PERSONHOOD_VOUCH_TARGET,
      realLifeCount: PERSONHOOD_REAL_LIFE_TARGET,
    });
    expect(r.score).toBeCloseTo(PERSONHOOD_VOUCH_COMPONENT + PERSONHOOD_REAL_LIFE_COMPONENT, 5);
    expect(r.isRealPerson).toBe(true);
  });

  it('every maxed signal reaches exactly 1.0', () => {
    const r = personhoodScore({
      ...base,
      weightedVouchScore: PERSONHOOD_VOUCH_TARGET,
      realLifeCount: PERSONHOOD_REAL_LIFE_TARGET,
      biometricBound: true,
    });
    expect(r.score).toBeCloseTo(1, 5);
    expect(r.isRealPerson).toBe(true);
  });

  it('saturates the vouch signal at 1 beyond the target', () => {
    const r = personhoodScore({ ...base, weightedVouchScore: PERSONHOOD_VOUCH_TARGET * 10 });
    expect(r.breakdown.vouchSignal).toBe(1);
  });

  it('saturates the real-life signal at 1 beyond the target', () => {
    const r = personhoodScore({ ...base, realLifeCount: PERSONHOOD_REAL_LIFE_TARGET * 5 });
    expect(r.breakdown.realLifeSignal).toBe(1);
  });
});

describe('personhoodScore — sybil penalty', () => {
  it('attenuates the evidence multiplicatively', () => {
    const full: PersonhoodInputs = {
      ...base,
      weightedVouchScore: PERSONHOOD_VOUCH_TARGET,
      realLifeCount: PERSONHOOD_REAL_LIFE_TARGET,
      biometricBound: true,
    };
    const clean = personhoodScore(full);
    const penalised = personhoodScore({ ...full, sybilPenalty: 0.5 });
    expect(penalised.score).toBeCloseTo(clean.score * 0.5, 5);
    expect(penalised.breakdown.sybilPenalty).toBe(0.5);
  });

  it('a full sybil penalty zeroes the score even with maxed evidence', () => {
    const r = personhoodScore({
      ...base,
      weightedVouchScore: PERSONHOOD_VOUCH_TARGET,
      realLifeCount: PERSONHOOD_REAL_LIFE_TARGET,
      biometricBound: true,
      sybilPenalty: 1,
    });
    expect(r.score).toBe(0);
    expect(r.isRealPerson).toBe(false);
  });

  it('clamps an out-of-range sybil penalty to [0,1]', () => {
    const r = personhoodScore({
      ...base,
      weightedVouchScore: PERSONHOOD_VOUCH_TARGET,
      biometricBound: true,
      sybilPenalty: 1.7,
    });
    expect(r.breakdown.sybilPenalty).toBe(1);
    expect(r.score).toBe(0);
  });
});
