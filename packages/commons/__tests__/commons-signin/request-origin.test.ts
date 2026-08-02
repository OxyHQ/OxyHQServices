import { formatRequestOrigin } from '@/lib/commons-signin/request-origin';

describe('formatRequestOrigin', () => {
  it('renders a plain https origin as its bare host', () => {
    expect(formatRequestOrigin('https://mention.earth')).toBe('mention.earth');
  });

  it('keeps a non-default port', () => {
    expect(formatRequestOrigin('http://localhost:8081')).toBe('localhost:8081');
  });

  it('tolerates a trailing slash', () => {
    expect(formatRequestOrigin('https://mention.earth/')).toBe('mention.earth');
  });

  it('shows nothing when the request has no bound origin', () => {
    expect(formatRequestOrigin(undefined)).toBeNull();
    expect(formatRequestOrigin(null)).toBeNull();
    expect(formatRequestOrigin('   ')).toBeNull();
  });

  it('rejects a credentials look-alike rather than showing a misleading host', () => {
    // `https://mention.earth@evil.example` is served by evil.example. Showing
    // nothing is safe; showing "mention.earth" would be the phish.
    expect(formatRequestOrigin('https://mention.earth@evil.example')).toBeNull();
  });

  it('rejects anything carrying a path, query or fragment', () => {
    expect(formatRequestOrigin('https://mention.earth/login?next=/x')).toBeNull();
    expect(formatRequestOrigin('https://mention.earth#mention.earth')).toBeNull();
  });

  it('rejects a value that is not an origin at all', () => {
    expect(formatRequestOrigin('mention.earth')).toBeNull();
    expect(formatRequestOrigin('javascript:alert(1)')).toBeNull();
  });
});
