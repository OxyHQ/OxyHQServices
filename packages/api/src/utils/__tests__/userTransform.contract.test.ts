/**
 * Producer drift-guard for `formatUserResponse`.
 *
 * Phase 2 of the name-centralization refactor: the API is the FAITHFUL PRODUCER
 * of the canonical `@oxyhq/contracts` user-response contract. These tests build
 * representative user documents through `formatUserResponse` and assert the
 * output PARSES against `@oxyhq/contracts`'s `userResponseSchema` /
 * `refreshAllResponseSchema`. If the producer ever drifts from the contract
 * (e.g. drops `name.full`, or emits a shape the auth-app switcher can't parse),
 * these tests fail — exactly the class of bug that motivated the contract.
 *
 * The load-bearing assertion is that `name.full` is ALWAYS composed (first-only
 * included) even when the source document was loaded WITHOUT Mongoose virtuals
 * (a `.lean()` query), because the `/auth/refresh-all` handler reads users via
 * `.lean()` and the absent `name.full` virtual was the original switcher bug.
 */

import { formatUserResponse } from '../userTransform';
import {
  userResponseSchema,
  refreshAllResponseSchema,
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

    const parsed = safeParseContract(userResponseSchema, formatted);
    expect(parsed).not.toBeNull();
    expect(parsed?.name?.full).toBe('Jane Doe');
    expect(parsed && resolveUserId(parsed)).toBe('507f1f77bcf86cd799439011');
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
    expect(safeParseContract(userResponseSchema, formatted)).not.toBeNull();
  });

  it('omits name entirely for a publicKey-only user with no username and no name', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439014', {
        publicKey: '0x1234567890abcdef',
      })
    );

    expect(formatted).not.toBeNull();
    expect(formatted?.username).toBeUndefined();
    expect(formatted?.name).toBeUndefined();

    // Still a valid contract object — id is the only guaranteed field.
    const parsed = safeParseContract(userResponseSchema, formatted);
    expect(parsed).not.toBeNull();
    expect(parsed && resolveUserId(parsed)).toBe('507f1f77bcf86cd799439014');
  });

  it('omits name when first and last are both empty strings (no empty full)', () => {
    const formatted = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439015', {
        username: 'blanknames',
        name: { first: '', last: '' },
      })
    );

    expect(formatted?.name).toBeUndefined();
    expect(safeParseContract(userResponseSchema, formatted)).not.toBeNull();
  });

  it('returns null for a falsy or id-less source document', () => {
    expect(formatUserResponse(null)).toBeNull();
    expect(formatUserResponse(undefined)).toBeNull();
    expect(formatUserResponse({ _id: { toString: () => '' } })).toBeNull();
  });
});

describe('synthetic /auth/refresh-all response → refreshAllResponseSchema', () => {
  it('parses a multi-account response including a legacy authuser: null slot', () => {
    const indexedUser = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439021', {
        username: 'indexed',
        color: 'green',
        name: { first: 'Indexed', last: 'User' },
      })
    );
    const legacyUser = formatUserResponse(
      leanDoc('507f1f77bcf86cd799439022', {
        username: 'legacy',
        name: { first: 'Legacy' },
      })
    );

    const response = {
      accounts: [
        {
          authuser: 0,
          accessToken: 'access-indexed',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          sessionId: 'sess-indexed',
          user: indexedUser,
        },
        {
          // Legacy un-suffixed `oxy_rt` cookie slot — authuser MUST be null and
          // the account MUST NOT be dropped from the chooser.
          authuser: null,
          accessToken: 'access-legacy',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          sessionId: 'sess-legacy',
          user: legacyUser,
        },
      ],
    };

    const parsed = safeParseContract(refreshAllResponseSchema, response);
    expect(parsed).not.toBeNull();
    expect(parsed?.accounts).toHaveLength(2);
    expect(parsed?.accounts[0].authuser).toBe(0);
    expect(parsed?.accounts[0].user.name?.full).toBe('Indexed User');
    expect(parsed?.accounts[1].authuser).toBeNull();
    expect(parsed?.accounts[1].user.name?.full).toBe('Legacy');
  });

  it('parses an empty accounts array (no signed-in accounts on device)', () => {
    expect(safeParseContract(refreshAllResponseSchema, { accounts: [] })).not.toBeNull();
  });
});
