/**
 * Unit tests for the authoritative `name.displayName` composition (the logic
 * backing the `User.name.displayName` Mongoose virtual — see `models/User.ts`).
 *
 * The composition was previously `username || truncatedPublicKey`, which IGNORED
 * the structured `name` subdocument and made the server's display default
 * unreliable. The fix composes in preference order:
 *
 *   name.full → username → truncated publicKey handle → 'Anonymous'
 *
 * The API jest setup mocks Mongoose wholesale, so the model's virtual getter
 * never runs under test; the rules are exercised here against the pure helper
 * the virtual delegates to.
 */

import {
  composeDisplayName,
  composeFullName,
  formatUserNameResponse,
  truncatePublicKeyHandle,
} from '../displayName';

describe('composeDisplayName (authoritative User.name.displayName default)', () => {
  it('composes the full name when first AND last are present', () => {
    expect(
      composeDisplayName({
        name: { first: 'Jane', last: 'Doe' },
        username: 'janedoe',
        publicKey: '0x1234567890abcdef',
      })
    ).toBe('Jane Doe');
  });

  it('composes a FIRST-ONLY name (does not require both parts) over username', () => {
    expect(
      composeDisplayName({
        name: { first: 'Cher' },
        username: 'mononym',
      })
    ).toBe('Cher');
  });

  it('composes a LAST-ONLY name over username', () => {
    expect(
      composeDisplayName({
        name: { last: 'Prince' },
        username: 'theartist',
      })
    ).toBe('Prince');
  });

  it('falls back to username when there is no usable name', () => {
    expect(
      composeDisplayName({
        name: { first: '', last: '' },
        username: 'fallbackuser',
        publicKey: '0x1234567890abcdef',
      })
    ).toBe('fallbackuser');
  });

  it('falls back to username when the name subdocument is absent', () => {
    expect(composeDisplayName({ username: 'noname' })).toBe('noname');
  });

  it('falls back to the truncated 0x publicKey handle when neither name nor username exists', () => {
    expect(
      composeDisplayName({
        publicKey: '0x1234567890abcdef1234567890abcdef',
      })
    ).toBe('0x123456...abcdef');
  });

  it('falls back to the truncated bare-hex publicKey handle (no 0x prefix)', () => {
    expect(
      composeDisplayName({
        publicKey: 'abcdef1234567890fedcba',
      })
    ).toBe('abcdef...fedcba');
  });

  it("returns 'Anonymous' when name, username, and publicKey are all absent", () => {
    expect(composeDisplayName({})).toBe('Anonymous');
  });

  it('ignores a whitespace-only username and falls through to the publicKey handle', () => {
    expect(
      composeDisplayName({
        username: '   ',
        publicKey: '0xabcdef1234567890abcdef',
      })
    ).toBe('0xabcdef...abcdef');
  });

  it('prefers the name even when a username is also present (name wins)', () => {
    expect(
      composeDisplayName({
        name: { first: 'Ada', last: 'Lovelace' },
        username: 'ada',
      })
    ).toBe('Ada Lovelace');
  });
});

describe('composeFullName', () => {
  it('joins first and last', () => {
    expect(composeFullName({ first: 'Jane', last: 'Doe' })).toBe('Jane Doe');
  });

  it('returns first-only without requiring last', () => {
    expect(composeFullName({ first: 'Cher' })).toBe('Cher');
  });

  it('returns an empty string when both parts are empty', () => {
    expect(composeFullName({ first: '', last: '' })).toBe('');
  });

  it('returns an empty string for a missing name', () => {
    expect(composeFullName(undefined)).toBe('');
    expect(composeFullName(null)).toBe('');
  });
});

describe('formatUserNameResponse', () => {
  it('emits full and displayName for structured names', () => {
    expect(
      formatUserNameResponse({
        name: { first: 'Jane', last: 'Doe' },
        username: 'janedoe',
      })
    ).toEqual({
      first: 'Jane',
      last: 'Doe',
      full: 'Jane Doe',
      displayName: 'Jane Doe',
    });
  });

  it('emits displayName from username when structured names are empty', () => {
    expect(
      formatUserNameResponse({
        name: { first: '', last: '' },
        username: 'janedoe',
      })
    ).toEqual({ displayName: 'janedoe' });
  });
});

describe('truncatePublicKeyHandle', () => {
  it('keeps the 0x prefix and truncates the middle', () => {
    expect(truncatePublicKeyHandle('0x1234567890abcdef1234567890abcdef')).toBe('0x123456...abcdef');
  });

  it('truncates a bare hex key without a prefix', () => {
    expect(truncatePublicKeyHandle('abcdef1234567890fedcba')).toBe('abcdef...fedcba');
  });

  it('returns undefined for a missing key', () => {
    expect(truncatePublicKeyHandle(undefined)).toBeUndefined();
    expect(truncatePublicKeyHandle(null)).toBeUndefined();
    expect(truncatePublicKeyHandle('')).toBeUndefined();
  });
});
