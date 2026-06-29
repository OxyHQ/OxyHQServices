import {
  MAX_DISPLAY_NAME_LENGTH,
  cleanDisplayName,
  isValidDisplayName,
} from '../displayNameSanitize';

// Non-ASCII strings use explicit \u escapes so expected values are unambiguous
// regardless of how the source file is Unicode-normalized on disk.
const RENEE = 'Renée'; // Renée (precomposed)
const RAMEE = 'Axe vert de La Ramée'; // Axe vert de La Ramée
const MUNOZ = 'Renée Muñoz'; // Renée Muñoz
const CYRILLIC = 'Владимир'; // Владимир
const CJK = '山田太郎'; // 山田太郎
const PENGUIN = '\u{1f427}'; // 🐧
const ASTERISM = '⁂'; // ⁂
const EARTH_GROUND = '⏚'; // ⏚

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

  describe('cleanDisplayName — allowed characters', () => {
    it('keeps Latin accents and ñ', () => {
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
      // "Cafe" + combining acute U+0301 (NFD) → precomposed "Café" (NFC).
      const decomposed = 'Café';
      expect(decomposed).toHaveLength(5);
      const expected = 'Café'; // precomposed é
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
    it.each([`${RENEE} O'Brien`, CYRILLIC, CJK, 'Ada Lovelace', ''])(
      'returns true for clean name %p',
      (name) => {
        expect(isValidDisplayName(name)).toBe(true);
      },
    );

    it.each([
      `Dabid ${ASTERISM}`,
      `${RAMEE} ${EARTH_GROUND}`,
      'Laura :bongoCat:',
      `nixCraft ${PENGUIN}`,
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
