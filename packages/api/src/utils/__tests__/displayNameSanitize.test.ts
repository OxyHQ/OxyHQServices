import {
  MAX_DISPLAY_NAME_LENGTH,
  cleanDisplayName,
  isValidDisplayName,
} from '../displayNameSanitize';

// Every non-ASCII fixture is spelled out with explicit \u escapes so its exact
// code points (and thus NFC/combining behaviour) are unambiguous regardless of
// how this source file is Unicode-normalized on disk.
const RENEE = 'Renée'; // "Renee" with precomposed e-acute (U+00E9)
const RAMEE = 'Axe vert de La Ramée'; // "...Ramee" with precomposed e-acute
const MUNOZ = 'Renée Muñoz'; // "Renee Munoz" with e-acute + n-tilde
const CYRILLIC = 'Владимир'; // Vladimir (Cyrillic)
const CJK = '山田太郎'; // CJK name
const PENGUIN = '\u{1f427}'; // penguin emoji
const ASTERISM = '⁂'; // asterism, General_Category Po
const EARTH_GROUND = '⏚'; // earth-ground symbol, General_Category So

// Orphaned-combining-mark fixtures. Lengths are asserted in the tests below.
const TIBETAN_MARK = '༘'; // Tibetan astrological sign, General_Category Mn (combining)
const STAR_OPERATOR = '⋆'; // star operator, General_Category Sm (symbol)
const ORPHAN_PAIR = `${TIBETAN_MARK}${STAR_OPERATOR}`; // the real prod example (U+0F18 U+22C6)
// "Renee" written decomposed: base 'e' + combining acute U+0301 -> NFC e-acute.
const RENEE_DECOMPOSED = 'Renée';
// Devanagari with a virama (U+094D, Mn) and a vowel sign (U+0947, Mn).
const DEVANAGARI = 'नमस्ते';
// Thai consonant KO KAI + SARA I (U+0E34, Mn), a real combining vowel mark.
const THAI = 'กิ';
// Arabic letters interleaved with harakat (U+064F damma, U+064E fatha; Mn).
const ARABIC_MARKS = 'مُحَمَد';
const HEART = '❤'; // heavy black heart, General_Category So (symbol)
const VS16 = '️'; // VARIATION SELECTOR-16, General_Category Mn (combining)

describe('displayNameSanitize', () => {
  describe('cleanDisplayName — user-reported examples', () => {
    it.each([
      [`Dabid ${ASTERISM}`, 'Dabid'],
      [`${RAMEE} ${EARTH_GROUND}`, RAMEE],
      ['Laura :bongoCat:', 'Laura'],
      [`nixCraft ${PENGUIN}`, 'nixCraft'],
    ])('cleans %p → %p', (input, expected) => {
      expect(cleanDisplayName(input)).toBe(expected);
    });

    it('returns empty string for an emoji-only name', () => {
      expect(cleanDisplayName(PENGUIN)).toBe('');
    });
  });

  describe('cleanDisplayName — orphaned combining marks', () => {
    it('cleans the real prod example U+0F18 U+22C6 (Mn + Sm) to empty', () => {
      // U+0F18 is a combining mark allowed by the \p{M}-friendly policy, but it
      // is base-less here, so it must be stripped along with the U+22C6 symbol.
      expect(ORPHAN_PAIR).toHaveLength(2);
      expect(cleanDisplayName(ORPHAN_PAIR)).toBe('');
    });

    it('cleans a lone combining mark (U+0F18) to empty', () => {
      expect(TIBETAN_MARK).toHaveLength(1);
      expect(cleanDisplayName(TIBETAN_MARK)).toBe('');
    });

    it('strips a leading orphaned mark but keeps the following letters', () => {
      expect(cleanDisplayName(`${TIBETAN_MARK}Anna`)).toBe('Anna');
    });

    it('strips the trailing VS16 left after an emoji base is removed', () => {
      // "Mark Holmwood " + heart (U+2764) + VS16 (U+FE0F). The heart is a symbol
      // -> stripped to a space; the variation selector is a combining mark that
      // is now orphaned -> must also be removed, with no stray trailing space.
      const input = `Mark Holmwood ${HEART}${VS16}`;
      const result = cleanDisplayName(input);
      expect(result).toBe('Mark Holmwood');
      expect(result.endsWith(' ')).toBe(false);
      expect(result).not.toContain(VS16);
    });
  });

  describe('cleanDisplayName — allowed characters', () => {
    it('keeps Latin accents and n-tilde', () => {
      expect(cleanDisplayName(MUNOZ)).toBe(MUNOZ);
    });

    it('keeps Cyrillic letters', () => {
      expect(cleanDisplayName(CYRILLIC)).toBe(CYRILLIC);
    });

    it('keeps CJK letters', () => {
      expect(cleanDisplayName(CJK)).toBe(CJK);
    });

    it("keeps the straight apostrophe in O'Brien", () => {
      expect(cleanDisplayName("O'Brien")).toBe("O'Brien");
    });

    it('keeps a precomposed accented name (Renee) unchanged', () => {
      expect(cleanDisplayName(RENEE)).toBe(RENEE);
    });

    it('recomposes a decomposed accent and keeps the mark on its base letter', () => {
      // The combining acute is attached to a base 'e', so the negative
      // lookbehind protects it; NFC then recomposes it into a precomposed char.
      expect(RENEE_DECOMPOSED).toHaveLength(6); // R e n e <combining acute> e
      const result = cleanDisplayName(RENEE_DECOMPOSED);
      expect(result).toBe(RENEE);
      expect(result.normalize('NFC')).toBe(result);
    });

    it('preserves Devanagari combining marks attached to base letters', () => {
      expect(cleanDisplayName(DEVANAGARI)).toBe(DEVANAGARI);
    });

    it('preserves a Thai combining vowel mark on its base letter', () => {
      expect(cleanDisplayName(THAI)).toBe(THAI);
    });

    it('preserves Arabic harakat attached to base letters', () => {
      expect(cleanDisplayName(ARABIC_MARKS)).toBe(ARABIC_MARKS);
    });
  });

  describe('cleanDisplayName — stripping', () => {
    it('strips digits', () => {
      expect(cleanDisplayName('Agent007')).toBe('Agent');
    });

    it('strips hyphens', () => {
      expect(cleanDisplayName('Jean-Luc')).toBe('Jean Luc');
    });

    it('strips dots', () => {
      expect(cleanDisplayName('J.R.R. Tolkien')).toBe('J R R Tolkien');
    });

    it('strips punctuation and symbols', () => {
      expect(cleanDisplayName('!?@#$%^&*()')).toBe('');
    });

    it('removes a shortcode entirely (not just its colons)', () => {
      // The shortcode strip MUST run before the char strip, otherwise the bare
      // word would survive.
      expect(cleanDisplayName('hi :bongoCat: there')).toBe('hi there');
    });

    it('collapses internal whitespace and trims the ends', () => {
      expect(cleanDisplayName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    });
  });

  describe('cleanDisplayName — normalization', () => {
    it('NFC-normalizes decomposed sequences', () => {
      // "Cafe" + combining acute U+0301 (NFD) -> precomposed "Cafe-acute" (NFC).
      const decomposed = 'Café';
      expect(decomposed).toHaveLength(5);
      const expected = 'Café'; // precomposed e-acute
      const result = cleanDisplayName(decomposed);
      expect(result).toBe(expected);
      expect(result).toHaveLength(4);
      expect(result.normalize('NFC')).toBe(result);
    });
  });

  describe('cleanDisplayName — length cap', () => {
    it(`caps the result to ${MAX_DISPLAY_NAME_LENGTH} characters`, () => {
      const long = 'a'.repeat(200);
      expect(cleanDisplayName(long)).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
    });

    it('trims a trailing space left by the slice boundary', () => {
      // 80th char is a space → slice then trim removes it.
      const input = `${'a'.repeat(79)} bbbb`;
      const result = cleanDisplayName(input);
      expect(result).toBe('a'.repeat(79));
      expect(result.endsWith(' ')).toBe(false);
    });
  });

  describe('cleanDisplayName — XSS safety', () => {
    it.each([
      '<script>alert(1)</script>',
      'a & b',
      'O"Neil',
      '<img src=x onerror=y>',
      `Dabid ${ASTERISM} & "friends" <hi>`,
    ])('never emits <, >, &, or " for input %p', (input) => {
      const result = cleanDisplayName(input);
      expect(result).not.toMatch(/[<>&"]/);
    });
  });

  describe('isValidDisplayName', () => {
    it.each([
      `${RENEE} O'Brien`,
      CYRILLIC,
      CJK,
      'Ada Lovelace',
      '',
      RENEE,
      RENEE_DECOMPOSED,
      DEVANAGARI,
      THAI,
      ARABIC_MARKS,
    ])('returns true for clean name %p', (name) => {
      expect(isValidDisplayName(name)).toBe(true);
    });

    it.each([
      `Dabid ${ASTERISM}`,
      `${RAMEE} ${EARTH_GROUND}`,
      'Laura :bongoCat:',
      `nixCraft ${PENGUIN}`,
      ORPHAN_PAIR,
      TIBETAN_MARK,
      `${TIBETAN_MARK}Anna`,
    ])('returns false for dirty name %p', (name) => {
      expect(isValidDisplayName(name)).toBe(false);
    });

    it('returns false for digits', () => {
      expect(isValidDisplayName('Agent007')).toBe(false);
    });

    it('returns false for hyphens and dots', () => {
      expect(isValidDisplayName('Jean-Luc')).toBe(false);
      expect(isValidDisplayName('J.R.')).toBe(false);
    });
  });
});
