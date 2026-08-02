import { formatDate } from '@/utils/date-utils';

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
