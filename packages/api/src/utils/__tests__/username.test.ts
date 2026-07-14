import { INVALID_USERNAME_MESSAGE, USERNAME_PATTERN, normalizeUsername } from '../username';

/** Non-breaking space, spelled with an escape so the code point is unambiguous. */
const NBSP = '\u00A0';

/**
 * The composition every write path applies: normalize the submitted value, then
 * test the normalized form. Spelled out here rather than exported as a helper \u2014
 * an `isValidUsername` in this module would collide by name with the LOOSER
 * `isValidUsername` of `@oxyhq/core` (which admits `_` and `-`), and a caller
 * reaching for the wrong import would silently widen the server's policy.
 */
function accepts(raw: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(raw));
}

describe('username policy', () => {
  describe('normalizeUsername', () => {
    it('trims surrounding whitespace', () => {
      expect(normalizeUsername('  alice \n')).toBe('alice');
    });

    it('collapses interior whitespace rather than deleting it, so the value is REJECTED', () => {
      // Silently squashing "al ice" into "alice" would hand the user an account
      // under a name they never chose. It collapses to a single space, which the
      // pattern then rejects.
      expect(normalizeUsername('al   ice')).toBe('al ice');
      expect(accepts('al   ice')).toBe(false);
    });

    it('normalizes a non-breaking space (the invisible-collision case)', () => {
      // A trailing NBSP would otherwise store a second "alice" that no human can
      // tell apart from the first.
      expect(normalizeUsername(`alice${NBSP}`)).toBe('alice');
      expect(accepts(`ali${NBSP}ce`)).toBe(false);
    });
  });

  describe('USERNAME_PATTERN', () => {
    it.each(['alice', 'Alice99', 'abc', 'a'.repeat(30)])('accepts %s', (value) => {
      expect(USERNAME_PATTERN.test(value)).toBe(true);
    });

    it.each([
      'ab',
      'a'.repeat(31),
      'al ice',
      'ali\tce',
      'alice\n',
      'al.ice',
      'al_ice',
      'al-ice',
      'álice',
      '',
    ])('rejects %j', (value) => {
      expect(USERNAME_PATTERN.test(value)).toBe(false);
    });
  });

  it('exposes a single shared 400 message', () => {
    expect(INVALID_USERNAME_MESSAGE).toContain('letters and numbers');
  });
});
