import { shortenKey } from '@/utils/shorten-key';

describe('shortenKey', () => {
  const KEY = '02a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';

  it('shortens a long key to head…tail with the ellipsis (default 8/8)', () => {
    expect(shortenKey(KEY)).toBe('02a1b2c3…ddeeff00');
  });

  it('uses the … ellipsis, never three dots', () => {
    expect(shortenKey(KEY)).toContain('…');
    expect(shortenKey(KEY)).not.toContain('...');
  });

  it('honors a custom head/tail split (6/4 for issuer refs)', () => {
    expect(shortenKey(KEY, 6, 4)).toBe('02a1b2…ff00');
  });

  it('returns short values unchanged when shortening would not save characters', () => {
    expect(shortenKey('abcdef')).toBe('abcdef');
    // Exactly head+tail+1 (17 chars) is the boundary — returned as-is.
    expect(shortenKey('0123456789abcdefg')).toBe('0123456789abcdefg');
  });
});
