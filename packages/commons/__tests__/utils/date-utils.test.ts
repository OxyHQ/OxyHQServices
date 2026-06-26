import { formatDate, getDisplayName } from '@/utils/date-utils';

describe('formatDate', () => {
  it('returns empty string for undefined input', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('returns empty string for null input', () => {
    expect(formatDate(null)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(formatDate('')).toBe('');
  });

  it('returns empty string for unparseable date strings', () => {
    expect(formatDate('not a real date')).toBe('');
  });

  it('formats a valid ISO date string in en-US format', () => {
    // Use a noon UTC time to dodge timezone-induced day shifts on the host.
    const formatted = formatDate('2025-02-21T12:00:00Z');
    expect(formatted).toBe('Feb 21, 2025');
  });

  it('formats epoch as Jan 1, 1970', () => {
    expect(formatDate('1970-01-01T12:00:00Z')).toBe('Jan 1, 1970');
  });
});

describe('getDisplayName', () => {
  it('returns translated "Unnamed" for null', () => {
    expect(getDisplayName(null)).toBe('Unnamed');
  });

  it('returns translated "Unnamed" for undefined', () => {
    expect(getDisplayName(undefined)).toBe('Unnamed');
  });

  it('returns full name when present', () => {
    expect(getDisplayName({ name: { full: 'Jane Doe' } })).toBe('Jane Doe');
  });

  it('returns first + last when full name is missing', () => {
    expect(getDisplayName({ name: { first: 'Jane', last: 'Doe' } })).toBe('Jane Doe');
  });

  it('returns only first name when last name is missing', () => {
    expect(getDisplayName({ name: { first: 'Jane' } })).toBe('Jane');
  });

  it('falls back to username when name fields are absent', () => {
    expect(getDisplayName({ username: 'janed' })).toBe('janed');
  });

  it('falls back to truncated publicKey when only publicKey is present', () => {
    expect(
      getDisplayName({ publicKey: '0xabcdef1234567890deadbeef' }),
    ).toBe('Account 0xabcdef12…');
  });

  it('returns translated "Unnamed" when no identifying fields are present', () => {
    expect(getDisplayName({})).toBe('Unnamed');
  });

  it('prefers full name over first/last combination', () => {
    expect(
      getDisplayName({ name: { full: 'J. Doe', first: 'Jane', last: 'Doe' } }),
    ).toBe('J. Doe');
  });
});
