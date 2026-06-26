import { userIdFromDid } from '@/lib/civic/did';

describe('userIdFromDid', () => {
  it('extracts the userId from a well-formed Oxy did:web', () => {
    expect(userIdFromDid('did:web:oxy.so:u:65f0abc123')).toBe('65f0abc123');
  });

  it('handles a different apex', () => {
    expect(userIdFromDid('did:web:mention.earth:u:deadbeef')).toBe('deadbeef');
  });

  it('trims surrounding whitespace', () => {
    expect(userIdFromDid('  did:web:oxy.so:u:abc  ')).toBe('abc');
  });

  it('rejects a non did:web method', () => {
    expect(userIdFromDid('did:key:zABC')).toBeNull();
  });

  it('rejects a did with no user segment', () => {
    expect(userIdFromDid('did:web:oxy.so')).toBeNull();
  });

  it('rejects an empty user segment', () => {
    expect(userIdFromDid('did:web:oxy.so:u:')).toBeNull();
  });

  it('rejects a trailing path / fragment after the user id', () => {
    expect(userIdFromDid('did:web:oxy.so:u:abc/extra')).toBeNull();
    expect(userIdFromDid('did:web:oxy.so:u:abc#frag')).toBeNull();
  });

  it('rejects non-string input', () => {
    // @ts-expect-error — exercising the runtime guard
    expect(userIdFromDid(null)).toBeNull();
    // @ts-expect-error — exercising the runtime guard
    expect(userIdFromDid(undefined)).toBeNull();
  });
});
