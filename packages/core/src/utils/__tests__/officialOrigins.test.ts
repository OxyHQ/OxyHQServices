import {
  buildHubSyncUrl,
  buildIdpHubOrigin,
  isAllowedDeviceJoinOrigin,
  isIdpHubOrigin,
  isOfficialWebOrigin,
  normalizeOfficialReturnOrigin,
  parseHubSyncReturnUrl,
} from '../officialOrigins';

describe('officialOrigins', () => {
  it('builds the IdP hub origin', () => {
    expect(buildIdpHubOrigin()).toBe('https://auth.oxy.so');
  });

  it('allows official first-party origins', () => {
    expect(isOfficialWebOrigin('https://inbox.oxy.so')).toBe(true);
    expect(isOfficialWebOrigin('https://mention.earth')).toBe(true);
    expect(isOfficialWebOrigin('https://evil.example')).toBe(false);
  });

  it('keeps the deprecated alias in sync with isOfficialWebOrigin', () => {
    expect(isAllowedDeviceJoinOrigin('https://accounts.oxy.so')).toBe(true);
    expect(isAllowedDeviceJoinOrigin('https://evil.example')).toBe(false);
  });

  it('normalizes return origins to origin only', () => {
    expect(normalizeOfficialReturnOrigin('https://accounts.oxy.so/settings')).toBe(
      'https://accounts.oxy.so',
    );
    expect(normalizeOfficialReturnOrigin('https://evil.example/')).toBeNull();
  });

  it('parses hub-sync return URLs', () => {
    expect(parseHubSyncReturnUrl('https://inbox.oxy.so/messages')).toBe(
      'https://inbox.oxy.so/messages',
    );
    expect(parseHubSyncReturnUrl('https://evil.example/')).toBeNull();
  });

  it('builds hub sync URLs with ticket and optional return', () => {
    const url = new URL(buildHubSyncUrl('tk-abc', 'https://accounts.oxy.so/'));
    expect(url.pathname).toBe('/sync');
    expect(url.searchParams.get('ticket')).toBe('tk-abc');
    expect(url.searchParams.get('return')).toBe('https://accounts.oxy.so/');
  });

  describe('isIdpHubOrigin', () => {
    const originalLocation = globalThis.location;

    afterEach(() => {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    });

    it('returns true on auth.oxy.so', () => {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { href: 'https://auth.oxy.so/sync' },
      });
      expect(isIdpHubOrigin()).toBe(true);
    });

    it('returns false on satellite origins', () => {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { href: 'https://inbox.oxy.so/' },
      });
      expect(isIdpHubOrigin()).toBe(false);
    });
  });
});
