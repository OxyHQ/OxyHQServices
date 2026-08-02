import {
  computeOfficialRedirectUriRepair,
  includesRedirectUri,
  originOfWebsiteUrl,
  unionRedirectUris,
} from '../redirectUris';

describe('unionRedirectUris', () => {
  it('preserves existing entries and appends new ones without duplicates', () => {
    expect(unionRedirectUris(['https://a.example', 'https://b.example'], ['https://b.example', 'https://c.example'])).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ]);
  });

  it('treats null/undefined current as empty', () => {
    expect(unionRedirectUris(null, ['https://a.example'])).toEqual(['https://a.example']);
  });
});

describe('computeOfficialRedirectUriRepair', () => {
  it('returns null when the website origin is already registered', () => {
    expect(
      computeOfficialRedirectUriRepair(
        ['https://oxy.so', 'https://fairco.in'],
        'https://oxy.so/about',
      ),
    ).toBeNull();
  });

  it('UNIONs the website origin instead of replacing the allowlist', () => {
    expect(
      computeOfficialRedirectUriRepair(
        ['https://fairco.in'],
        'https://oxy.so',
      ),
    ).toEqual(['https://fairco.in', 'https://oxy.so']);
  });

  it('seeds the origin when redirectUris is empty', () => {
    expect(computeOfficialRedirectUriRepair([], 'https://crowdsource.oxy.so')).toEqual([
      'https://crowdsource.oxy.so',
    ]);
  });

  it('returns null for invalid website URLs', () => {
    expect(computeOfficialRedirectUriRepair(['https://a.example'], 'not-a-url')).toBeNull();
  });
});

describe('includesRedirectUri', () => {
  it('matches exact entries only', () => {
    expect(includesRedirectUri(['https://a.example'], 'https://a.example')).toBe(true);
    expect(includesRedirectUri(['https://a.example'], 'https://a.example/')).toBe(false);
  });
});

describe('originOfWebsiteUrl', () => {
  it('extracts the origin from a full URL', () => {
    expect(originOfWebsiteUrl('https://console.oxy.so/settings')).toBe('https://console.oxy.so');
  });
});
