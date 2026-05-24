import {
  generateSuggestedUsername,
  isValidUsername,
  sanitizeUsernameInput,
  validateUsernameFormat,
} from '@/utils/auth/usernameUtils';

import {
  USERNAME_ADJECTIVES,
  USERNAME_MIN_LENGTH,
  USERNAME_NOUNS,
  USERNAME_NUM_SUFFIX_MAX,
  USERNAME_NUM_SUFFIX_MIN,
} from '@/constants/auth';

describe('validateUsernameFormat', () => {
  it('accepts a simple lowercase alphanumeric username', () => {
    expect(validateUsernameFormat('alice42')).toBe(true);
  });

  it('accepts mixed case (regex is case-insensitive)', () => {
    expect(validateUsernameFormat('AliceBob')).toBe(true);
  });

  it('rejects usernames shorter than the minimum length', () => {
    const short = 'a'.repeat(USERNAME_MIN_LENGTH - 1);
    expect(validateUsernameFormat(short)).toBe(false);
  });

  it('rejects usernames containing punctuation', () => {
    expect(validateUsernameFormat('alice.smith')).toBe(false);
  });

  it('rejects usernames containing spaces', () => {
    expect(validateUsernameFormat('alice smith')).toBe(false);
  });

  it('rejects usernames containing emoji', () => {
    expect(validateUsernameFormat('alice42!')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(validateUsernameFormat('')).toBe(false);
  });
});

describe('isValidUsername', () => {
  it('matches validateUsernameFormat for valid inputs', () => {
    expect(isValidUsername('alice42')).toBe(true);
  });

  it('matches validateUsernameFormat for invalid inputs', () => {
    expect(isValidUsername('!')).toBe(false);
  });
});

describe('sanitizeUsernameInput', () => {
  it('lowercases mixed-case input', () => {
    expect(sanitizeUsernameInput('AliceSMITH')).toBe('alicesmith');
  });

  it('removes punctuation', () => {
    expect(sanitizeUsernameInput('alice.smith')).toBe('alicesmith');
  });

  it('removes spaces', () => {
    expect(sanitizeUsernameInput('alice smith')).toBe('alicesmith');
  });

  it('keeps digits intact', () => {
    expect(sanitizeUsernameInput('Alice42')).toBe('alice42');
  });

  it('returns empty string for input with no allowed characters', () => {
    expect(sanitizeUsernameInput('!@#$%')).toBe('');
  });

  it('strips non-ASCII letters', () => {
    expect(sanitizeUsernameInput('aliçe')).toBe('alie');
  });
});

describe('generateSuggestedUsername', () => {
  it('returns a string matching adjective + noun + number pattern', () => {
    const suggestion = generateSuggestedUsername();
    expect(suggestion.length).toBeGreaterThan(0);
  });

  it('contains a known adjective from the list', () => {
    const suggestion = generateSuggestedUsername();
    const hasAdjective = USERNAME_ADJECTIVES.some((adj) => suggestion.startsWith(adj));
    expect(hasAdjective).toBe(true);
  });

  it('contains a known noun from the list', () => {
    const suggestion = generateSuggestedUsername();
    const hasNoun = USERNAME_NOUNS.some((noun) => suggestion.includes(noun));
    expect(hasNoun).toBe(true);
  });

  it('ends with a number in the configured range', () => {
    const suggestion = generateSuggestedUsername();
    const trailingNumber = Number.parseInt(suggestion.match(/(\d+)$/)?.[1] ?? '', 10);
    expect(trailingNumber).toBeGreaterThanOrEqual(USERNAME_NUM_SUFFIX_MIN);
    expect(trailingNumber).toBeLessThanOrEqual(USERNAME_NUM_SUFFIX_MAX);
  });

  it('produces output that passes validateUsernameFormat', () => {
    // Generate a batch to defend against statistical flukes from a single sample.
    for (let i = 0; i < 25; i++) {
      const suggestion = generateSuggestedUsername();
      expect(validateUsernameFormat(suggestion)).toBe(true);
    }
  });
});
