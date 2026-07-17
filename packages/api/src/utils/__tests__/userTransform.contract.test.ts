/**
 * Producer drift-guard for `formatUserResponse`.
 *
 * Phase 2 of the name-centralization refactor: the API is the FAITHFUL PRODUCER
 * of the canonical `@oxyhq/contracts` user-response contract. These tests build
 * representative user documents through `formatUserResponse` and assert the
 * output PARSES against `@oxyhq/contracts`'s `userResponseSchema`. If the
 * producer ever drifts from the contract (e.g. drops `name.full`, or emits a
 * shape a consumer can't parse), these tests fail — exactly the class of bug
 * that motivated the contract.
 *
 * The load-bearing assertion is that `name.full` and `name.displayName` are
 * composed from a REAL name (first-only included) even when the source document
 * was loaded WITHOUT Mongoose virtuals (a `.lean()` query). When the user has no
 * real name (username-only / publicKey-only) `name.displayName` is OMITTED and
 * the client falls back to the handle.
 */

import { formatUserResponse, toThemePreference } from '../userTransform';
import {
  userResponseSchema,
  safeParseContract,
  resolveUserId,
} from '@oxyhq/contracts';

/**
 * Minimal lean-document shape used by these tests. Mirrors a `.lean()` read with
 * a `.select('username name avatar email color publicKey ...')` projection: the
 * `name.full` virtual is ABSENT (only `first`/`last` are stored), so
 * `formatUserResponse` must compose `full` itself.
 */
interface LeanUserDoc {
  _id: { toString(): string };
  publicKey?: string;
  username?: string;
  email?: string;
  avatar?: string | null;
  color?: string | null;
  name?: { first?: string; last?: string; full?: string };
  organizationCategory?: string;
}

function leanDoc(id: string, overrides: Partial<Omit<LeanUserDoc, '_id'>> = {}): LeanUserDoc {
  return {
    _id: { toString: () => id },
    ...overrides,
  };
}

describe('formatUserResponse → @oxyhq/contracts userResponseSchema (producer contract)', () => {
  it('composes name.full from first + last and parses against the contract', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439011', {
        username: 'janedoe',
        email: 'jane@oxy.so',
        color: 'blue',
        name: { first: 'Jane', last: 'Doe' },
      })
    );

    expect(formatted).not.toBeNull();
    // name.full is composed even though the lean source carried no `full` virtual.
    expect(formatted?.name?.full).toBe('Jane Doe');
    expect(formatted?.name?.displayName).toBe('Jane Doe');
    expect('displayName' in formatted!).toBe(false);

    const parsed = safeParseContract(userResponseSchema, formatted);
    expect(parsed).not.toBeNull();
    expect(parsed?.name?.full).toBe('Jane Doe');
    expect(parsed?.name?.displayName).toBe('Jane Doe');
    expect(parsed && resolveUserId(parsed)).toBe('507f1f77bcf86cd799439011');
  });

  it('forwards organizationCategory when present and parses against the contract', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439013', {
        username: 'acme',
        name: { first: 'Acme', last: 'Realty' },
        organizationCategory: 'agency',
      })
    );

    expect(formatted?.organizationCategory).toBe('agency');
    const parsed = safeParseContract(userResponseSchema, formatted);
    expect(parsed?.organizationCategory).toBe('agency');
  });

  it('composes name.full from a FIRST-ONLY name (no requirement of both)', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439012', {
        username: 'mononym',
        name: { first: 'Cher' },
      })
    );

    expect(formatted?.name?.first).toBe('Cher');
    expect(formatted?.name?.last).toBeUndefined();
    expect(formatted?.name?.full).toBe('Cher');
    expect(formatted?.name?.displayName).toBe('Cher');

    const parsed = safeParseContract(userResponseSchema, formatted);
    expect(parsed).not.toBeNull();
    expect(parsed?.name?.full).toBe('Cher');
  });

  it('prefers an existing name.full virtual when the source materialised it', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439013', {
        username: 'hydrated',
        name: { first: 'Ada', last: 'Lovelace', full: 'Ada Lovelace' },
      })
    );

    expect(formatted?.name?.full).toBe('Ada Lovelace');
    expect(formatted?.name?.displayName).toBe('Ada Lovelace');
    expect(safeParseContract(userResponseSchema, formatted)).not.toBeNull();
  });

  it('OMITS name.displayName for a publicKey-only user with no username and no human name', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439014', {
        publicKey: '0x1234567890abcdef',
      })
    );

    expect(formatted).not.toBeNull();
    expect(formatted?.username).toBeUndefined();
    // No real name → name is an empty object; displayName is absent and the
    // client falls back to the handle.
    expect(formatted?.name).toEqual({});

    // Still a valid contract object — id is the only guaranteed field.
    const parsed = safeParseContract(userResponseSchema, formatted);
    expect(parsed).not.toBeNull();
    expect(parsed && resolveUserId(parsed)).toBe('507f1f77bcf86cd799439014');
  });

  it('OMITS name.displayName when first and last are both empty strings (username-only)', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439015', {
        username: 'blanknames',
        name: { first: '', last: '' },
      })
    );

    expect(formatted?.name).toEqual({});
    expect(safeParseContract(userResponseSchema, formatted)).not.toBeNull();
  });

  it('returns null for a falsy or id-less source document', () => {
    expect(formatUserResponse(null)).toBeNull();
    expect(formatUserResponse(undefined)).toBeNull();
    expect(formatUserResponse({ _id: { toString: () => '' } })).toBeNull();
  });
});

describe('toThemePreference', () => {
  it('returns a valid preference when mode and colorPreset are present', () => {
    expect(toThemePreference({ mode: 'dark', colorPreset: 'blue' })).toEqual({
      mode: 'dark',
      colorPreset: 'blue',
    });
  });

  it('accepts all supported modes', () => {
    for (const mode of ['light', 'dark', 'system'] as const) {
      expect(toThemePreference({ mode, colorPreset: 'green' })).toEqual({
        mode,
        colorPreset: 'green',
      });
    }
  });

  it('returns undefined for partial or invalid stored values', () => {
    expect(toThemePreference({})).toBeUndefined();
    expect(toThemePreference({ mode: 'dark' })).toBeUndefined();
    expect(toThemePreference({ colorPreset: 'blue' })).toBeUndefined();
    expect(toThemePreference({ mode: 'auto', colorPreset: 'blue' })).toBeUndefined();
    expect(toThemePreference({ mode: 'dark', colorPreset: '' })).toBeUndefined();
    expect(toThemePreference(null)).toBeUndefined();
  });
});
