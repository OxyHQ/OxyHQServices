/**
 * Link-preview resolver tests: interstitial rejection, URL normalization, and
 * the generic Open Graph scrape over a mocked SSRF-safe fetch (returning RAW
 * origin image URLs — re-hosting happens later in the service).
 */
import { Readable } from 'stream';

const mockSafeFetch = jest.fn();

jest.mock('@oxyhq/core/server', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  SsrfRejection: class SsrfRejection extends Error {},
}));

import {
  isBlockedInterstitialUrl,
  normalizeUrl,
  resolveLinkMetadata,
} from '../linkMetadataResolver';

function htmlResponse(html: string, finalUrl: string, status = 200): unknown {
  return {
    response: Readable.from([Buffer.from(html)]),
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    finalUrl,
  };
}

beforeEach(() => mockSafeFetch.mockReset());

describe('isBlockedInterstitialUrl', () => {
  it('rejects Google /sorry, consent.*, and accounts.google.com', () => {
    expect(isBlockedInterstitialUrl(new URL('https://www.google.com/sorry/index?continue=x'))).toBe(
      true,
    );
    expect(isBlockedInterstitialUrl(new URL('https://consent.youtube.com/m'))).toBe(true);
    expect(isBlockedInterstitialUrl(new URL('https://accounts.google.com/signin'))).toBe(true);
  });
  it('allows a normal page', () => {
    expect(isBlockedInterstitialUrl(new URL('https://example.com/article'))).toBe(false);
    expect(isBlockedInterstitialUrl(new URL('https://www.google.com/maps'))).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('prepends https:// when scheme missing', () => {
    expect(normalizeUrl('example.com/a')).toBe('https://example.com/a');
  });
  it('rejects empty/oversized', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('https://x.com/' + 'a'.repeat(3000))).toBeNull();
  });
});

describe('resolveLinkMetadata (generic scrape)', () => {
  it('extracts og tags and keeps the RAW absolute image URL', async () => {
    const html = `<html><head>
      <meta property="og:title" content="Great Article">
      <meta property="og:description" content="A &amp; B">
      <meta property="og:image" content="/img/cover.jpg">
      <meta property="og:site_name" content="Example">
    </head><body>...</body></html>`;
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(html, 'https://example.com/article'));

    const result = await resolveLinkMetadata('https://example.com/article');
    expect(result.title).toBe('Great Article');
    expect(result.description).toBe('A & B');
    expect(result.siteName).toBe('Example');
    // RAW absolute origin URL (resolver does NOT re-host).
    expect(result.imageUrl).toBe('https://example.com/img/cover.jpg');
  });

  it('prefers the <title> tag over og:title (faithful port behavior)', async () => {
    const html = `<html><head>
      <title>Document Title</title>
      <meta property="og:title" content="OG Title">
      <meta property="og:image" content="https://example.com/c.jpg">
    </head></html>`;
    mockSafeFetch.mockResolvedValueOnce(htmlResponse(html, 'https://example.com/article'));

    const result = await resolveLinkMetadata('https://example.com/article');
    expect(result.title).toBe('Document Title');
    expect(result.imageUrl).toBe('https://example.com/c.jpg');
  });

  it('throws (without fetching) when the input URL is an interstitial wall', async () => {
    await expect(resolveLinkMetadata('https://www.google.com/sorry/index')).rejects.toThrow();
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('throws when the FINAL url after redirects is an interstitial wall', async () => {
    mockSafeFetch.mockResolvedValueOnce(
      htmlResponse('<html></html>', 'https://www.google.com/sorry/index'),
    );
    await expect(resolveLinkMetadata('https://news.example/x')).rejects.toThrow();
  });
});
