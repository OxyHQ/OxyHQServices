import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isRequiredString,
  isRequiredNumber,
  isRequiredBoolean,
  isValidArray,
  isValidObject,
  isValidEmail,
  isValidUsername,
  isValidPassword,
  isValidDisplayName,
  DISPLAY_NAME_ALLOWED_SCRIPTS,
  DISPLAY_NAME_DISALLOWED_SOURCE,
  DISPLAY_NAME_ORPHANED_MARK_SOURCE,
  isValidUUID,
  isValidDate,
  isValidFileSize,
  isValidFileType,
  sanitizeString,
  sanitizeHTML,
  validateAndSanitizeUserInput
} from '../validationUtils';

describe('Validation Utils', () => {
  describe('isRequiredString', () => {
    it('should return true for valid non-empty strings', () => {
      expect(isRequiredString('hello')).toBe(true);
      expect(isRequiredString('  hello  ')).toBe(true); // trims whitespace
    });

    it('should return false for invalid or empty strings', () => {
      expect(isRequiredString('')).toBe(false);
      expect(isRequiredString('   ')).toBe(false); // only whitespace
      expect(isRequiredString(null)).toBe(false);
      expect(isRequiredString(undefined)).toBe(false);
      expect(isRequiredString(123)).toBe(false);
    });
  });

  describe('isRequiredNumber', () => {
    it('should return true for valid numbers', () => {
      expect(isRequiredNumber(123)).toBe(true);
      expect(isRequiredNumber(0)).toBe(true);
      expect(isRequiredNumber(-456)).toBe(true);
      expect(isRequiredNumber(3.14)).toBe(true);
    });

    it('should return false for invalid numbers', () => {
      expect(isRequiredNumber(Number.NaN)).toBe(false);
      expect(isRequiredNumber('123')).toBe(false);
      expect(isRequiredNumber(null)).toBe(false);
      expect(isRequiredNumber(undefined)).toBe(false);
    });
  });

  describe('isRequiredBoolean', () => {
    it('should return true for boolean values', () => {
      expect(isRequiredBoolean(true)).toBe(true);
      expect(isRequiredBoolean(false)).toBe(true);
    });

    it('should return false for non-boolean values', () => {
      expect(isRequiredBoolean('true')).toBe(false);
      expect(isRequiredBoolean(1)).toBe(false);
      expect(isRequiredBoolean(0)).toBe(false);
      expect(isRequiredBoolean(null)).toBe(false);
      expect(isRequiredBoolean(undefined)).toBe(false);
    });
  });

  describe('isValidArray', () => {
    it('should return true for arrays', () => {
      expect(isValidArray([])).toBe(true);
      expect(isValidArray([1, 2, 3])).toBe(true);
      expect(isValidArray(['a', 'b'])).toBe(true);
    });

    it('should return false for non-arrays', () => {
      expect(isValidArray({})).toBe(false);
      expect(isValidArray('[]')).toBe(false);
      expect(isValidArray(null)).toBe(false);
      expect(isValidArray(undefined)).toBe(false);
    });
  });

  describe('isValidObject', () => {
    it('should return true for plain objects', () => {
      expect(isValidObject({})).toBe(true);
      expect(isValidObject({ key: 'value' })).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isValidObject([])).toBe(false);
      expect(isValidObject(null)).toBe(false);
      expect(isValidObject(undefined)).toBe(false);
      expect(isValidObject('object')).toBe(false);
      expect(isValidObject(123)).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name+tag@domain.co.uk')).toBe(true);
      expect(isValidEmail('simple@test.io')).toBe(true);
    });

    it('should return false for invalid email addresses', () => {
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('test.domain.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('isValidUsername', () => {
    it('should return true for valid usernames', () => {
      expect(isValidUsername('user123')).toBe(true);
      expect(isValidUsername('test_user')).toBe(true);
      expect(isValidUsername('john-doe')).toBe(true);
    });

    it('should return false for invalid usernames', () => {
      expect(isValidUsername('')).toBe(false);
      expect(isValidUsername('a')).toBe(false); // too short
      expect(isValidUsername('ab')).toBe(false); // too short
      expect(isValidUsername('user@domain')).toBe(false); // invalid characters
      expect(isValidUsername('user with spaces')).toBe(false); // spaces
    });
  });

  describe('isValidPassword', () => {
    it('should return true for valid passwords', () => {
      expect(isValidPassword('password123')).toBe(true);
      expect(isValidPassword('mySecurePass')).toBe(true);
      expect(isValidPassword('12345678')).toBe(true);
    });

    it('should return false for invalid passwords', () => {
      expect(isValidPassword('')).toBe(false);
      expect(isValidPassword('short')).toBe(false); // too short
      expect(isValidPassword('1234567')).toBe(false); // too short
    });
  });

  describe('isValidDisplayName', () => {
    it('should return true for clean names (letters, spaces, apostrophe)', () => {
      expect(isValidDisplayName("Renée O'Brien")).toBe(true);
      expect(isValidDisplayName('Ada Lovelace')).toBe(true);
      expect(isValidDisplayName('山田太郎')).toBe(true);
      expect(isValidDisplayName('')).toBe(true); // empty is valid; non-empty enforced elsewhere
    });

    it.each([
      ['Владимир', 'Cyrillic'],
      ['مُحَمَد', 'Arabic with harakat'],
      ['נתן', 'Hebrew'],
      ['नमस्ते', 'Devanagari'],
      ['김철수', 'Hangul'],
      ['Αριστοτέλης', 'Greek'],
      ['Արամ', 'Armenian'],
      ['დავით', 'Georgian'],
      ['สมชาย', 'Thai'],
      ['ᏔᎳ', 'Cherokee'],
      ['ᠮᠣᠩᠭᠣᠯ', 'Mongolian'],
    ])('should return true for allowlisted-script real name %p (%s)', (name) => {
      expect(isValidDisplayName(name)).toBe(true);
    });

    it('should return false for emoji, symbols, digits, and punctuation', () => {
      expect(isValidDisplayName('nixCraft \u{1f427}')).toBe(false); // penguin emoji
      expect(isValidDisplayName('Agent007')).toBe(false);
      expect(isValidDisplayName('Jean-Luc')).toBe(false);
      expect(isValidDisplayName('J.R.')).toBe(false);
    });

    it.each([
      ['ᯅ', 'Batak U+1BC5 (Limited-Use script)'],
      ['ᚠ', 'Runic'],
      ['Miguel de Icaza ᯅ', 'a Latin name with a trailing Batak letter'],
    ])('should return false for non-allowlisted-script letter %p (%s)', (name) => {
      // These characters are General_Category Lo (letters), so the old
      // all-scripts policy accepted them; the curated script allowlist rejects
      // decorative / limited-use scripts a real name never uses.
      expect(isValidDisplayName(name)).toBe(false);
    });

    it('should return false for control whitespace (tab/newline/CR)', () => {
      // Space separators only (General_Category Zs) rejects layout-breaking /
      // multi-line spoofing whitespace that \s would have admitted.
      expect(isValidDisplayName('Ada\tLovelace')).toBe(false);
      expect(isValidDisplayName('Ada\nLovelace')).toBe(false);
      expect(isValidDisplayName('Ada\rLovelace')).toBe(false);
    });

    it('should return true for Unicode space separators', () => {
      expect(isValidDisplayName('Ada Lovelace')).toBe(true); // NBSP
      expect(isValidDisplayName('山田　太郎')).toBe(true); // ideographic space
    });
  });

  // Hermes (React Native) has Unicode property escapes compiled OUT: any such
  // escape (Script_Extensions "scx=…" or General_Category classes) in a `u`-flag
  // regex throws "Invalid RegExp: Invalid property name" at module load and
  // crashes every Oxy RN/Expo app at boot. The display-name policy therefore
  // ships explicit code-point RANGES instead. This block guards that invariant
  // AND proves the range regexes behave identically.
  describe('display-name policy is property-escape-free (Hermes safety)', () => {
    const PROPERTY_ESCAPE = /\\[pP]\{/;

    it('exposes runtime regex sources that contain NO Unicode property escape', () => {
      expect(PROPERTY_ESCAPE.test(DISPLAY_NAME_ALLOWED_SCRIPTS)).toBe(false);
      expect(PROPERTY_ESCAPE.test(DISPLAY_NAME_DISALLOWED_SOURCE)).toBe(false);
      expect(PROPERTY_ESCAPE.test(DISPLAY_NAME_ORPHANED_MARK_SOURCE)).toBe(false);
    });

    it('only uses code-point escapes (\\x / \\u) in the class bodies', () => {
      // regexpu-core lowers the property escapes to `\x…` / `\u…` / `\u{…}`
      // code-point escapes. Every backslash-escape in the runtime sources must
      // be one of those forms — never a property escape.
      const escapeLeads = new Set<string>();
      for (const src of [DISPLAY_NAME_DISALLOWED_SOURCE, DISPLAY_NAME_ORPHANED_MARK_SOURCE]) {
        for (const [, lead] of src.matchAll(/\\(.)/g)) {
          escapeLeads.add(lead);
        }
      }
      expect([...escapeLeads].sort()).toEqual(['u', 'x']);
    });

    it('the shipped (non-test) policy source files contain NO property escape', () => {
      const utilsDir = join(__dirname, '..');
      for (const file of [
        'validationUtils.ts',
        'displayNamePolicyRanges.generated.ts',
        'textNormalization.ts',
      ]) {
        const contents = readFileSync(join(utilsDir, file), 'utf8');
        expect(PROPERTY_ESCAPE.test(contents)).toBe(false);
      }
    });

    // Build the actual regexes exactly as production does (range-only sources +
    // `u` flag + lookbehind — the shape Hermes must accept) and assert the full
    // policy behaves as before across scripts, marks, and rejections.
    const disallowed = new RegExp(DISPLAY_NAME_DISALLOWED_SOURCE, 'u');
    const orphaned = new RegExp(DISPLAY_NAME_ORPHANED_MARK_SOURCE, 'u');
    const passesPolicy = (raw: string) =>
      !disallowed.test(raw) && !orphaned.test(raw.normalize('NFC'));

    it('constructs the `u`-flag regexes without throwing', () => {
      expect(() => new RegExp(DISPLAY_NAME_DISALLOWED_SOURCE, 'u')).not.toThrow();
      expect(() => new RegExp(DISPLAY_NAME_ORPHANED_MARK_SOURCE, 'u')).not.toThrow();
      // Global variants are what @oxyhq/api compiles for the strip path.
      expect(() => new RegExp(DISPLAY_NAME_DISALLOWED_SOURCE, 'gu')).not.toThrow();
      expect(() => new RegExp(DISPLAY_NAME_ORPHANED_MARK_SOURCE, 'gu')).not.toThrow();
    });

    it.each([
      ["Renée O'Brien", 'Latin with decomposed accent + apostrophe'],
      ['Ada Lovelace', 'ASCII Latin'],
      ['山田太郎', 'Han'],
      ['田中\u{20000}', 'Han incl. astral CJK Extension B'],
      ['Владимир', 'Cyrillic'],
      ['مُحَمَد', 'Arabic with harakat (combining marks on base letters)'],
      ['נתן', 'Hebrew'],
      ['नमस्ते', 'Devanagari'],
      ['김철수', 'Hangul'],
      ['Αριστοτέλης', 'Greek'],
      ['ᏔᎳ', 'Cherokee'],
      ['ᠮᠣᠩᠭᠣᠯ', 'Mongolian'],
    ])('range regexes ACCEPT allowlisted %p (%s)', (name) => {
      expect(passesPolicy(name)).toBe(true);
      // Parity with the public predicate.
      expect(isValidDisplayName(name)).toBe(true);
    });

    it.each([
      ['nixCraft \u{1f427}', 'emoji (astral)'],
      ['Agent007', 'digit'],
      ['Jean-Luc', 'hyphen'],
      ['J.R.', 'dot'],
      ['ᯅ', 'Batak (non-allowlisted script)'],
      ['ᚠ', 'Runic (non-allowlisted script)'],
      ['Ada\tLovelace', 'tab (control whitespace)'],
      ['Ada\nLovelace', 'newline (control whitespace)'],
      ['Ada\rLovelace', 'carriage return (control whitespace)'],
    ])('range regexes REJECT %p (%s)', (name) => {
      expect(passesPolicy(name)).toBe(false);
      expect(isValidDisplayName(name)).toBe(false);
    });

    it('rejects an orphaned combining mark not riding a base letter', () => {
      expect(passesPolicy('༘⋆')).toBe(false); // lone Tibetan mark + star
      expect(orphaned.test('༘')).toBe(true); // bare mark at string start
      // A decomposed accent recomposes under NFC and rides its base letter.
      expect(orphaned.test('é'.normalize('NFC'))).toBe(false);
    });
  });

  describe('isValidUUID', () => {
    it('should return true for valid UUIDs', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isValidUUID('invalid-uuid')).toBe(false);
      expect(isValidUUID('123-456-789')).toBe(false);
      expect(isValidUUID('')).toBe(false);
    });
  });

  describe('isValidDate', () => {
    it('should return true for valid date strings', () => {
      expect(isValidDate('2024-01-01')).toBe(true);
      expect(isValidDate('2024-12-31T23:59:59.999Z')).toBe(true);
      expect(isValidDate('January 1, 2024')).toBe(true);
    });

    it('should return false for invalid date strings', () => {
      expect(isValidDate('invalid-date')).toBe(false);
      expect(isValidDate('2024-13-01')).toBe(false); // invalid month
      expect(isValidDate('')).toBe(false);
    });
  });

  describe('isValidFileSize', () => {
    const maxSize = 1024 * 1024; // 1MB

    it('should return true for valid file sizes', () => {
      expect(isValidFileSize(1024, maxSize)).toBe(true);
      expect(isValidFileSize(maxSize, maxSize)).toBe(true);
      expect(isValidFileSize(1, maxSize)).toBe(true);
    });

    it('should return false for invalid file sizes', () => {
      expect(isValidFileSize(0, maxSize)).toBe(false);
      expect(isValidFileSize(-1, maxSize)).toBe(false);
      expect(isValidFileSize(maxSize + 1, maxSize)).toBe(false);
    });
  });

  describe('isValidFileType', () => {
    const allowedTypes = ['jpg', 'png', 'gif', 'pdf'];

    it('should return true for allowed file types', () => {
      expect(isValidFileType('image.jpg', allowedTypes)).toBe(true);
      expect(isValidFileType('document.PDF', allowedTypes)).toBe(true); // case insensitive
      expect(isValidFileType('photo.png', allowedTypes)).toBe(true);
    });

    it('should return false for disallowed file types', () => {
      expect(isValidFileType('script.js', allowedTypes)).toBe(false);
      expect(isValidFileType('data.txt', allowedTypes)).toBe(false);
      expect(isValidFileType('noextension', allowedTypes)).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should trim whitespace and remove dangerous characters', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
      expect(sanitizeString('hello<script>alert("xss")</script>world')).toBe('helloalert("xss")world');
      expect(sanitizeString('normal text')).toBe('normal text');
    });
  });

  describe('sanitizeHTML', () => {
    it('should escape HTML characters', () => {
      expect(sanitizeHTML('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(sanitizeHTML('Hello & Goodbye')).toBe('Hello &amp; Goodbye');
      expect(sanitizeHTML("It's a test")).toBe('It&#x27;s a test');
    });
  });

  describe('validateAndSanitizeUserInput', () => {
    it('should validate and sanitize email input', () => {
      expect(validateAndSanitizeUserInput('  test@example.com  ', 'email')).toBe('test@example.com');
      expect(validateAndSanitizeUserInput('invalid-email', 'email')).toBeNull();
      expect(validateAndSanitizeUserInput(123, 'email')).toBeNull();
    });

    it('should validate and sanitize username input', () => {
      expect(validateAndSanitizeUserInput('  testuser  ', 'username')).toBe('testuser');
      expect(validateAndSanitizeUserInput('ab', 'username')).toBeNull(); // too short
      expect(validateAndSanitizeUserInput(123, 'username')).toBeNull();
    });

    it('should validate and sanitize string input', () => {
      expect(validateAndSanitizeUserInput('  hello world  ', 'string')).toBe('hello world');
      expect(validateAndSanitizeUserInput('', 'string')).toBeNull();
      expect(validateAndSanitizeUserInput(123, 'string')).toBeNull();
    });
  });
});
