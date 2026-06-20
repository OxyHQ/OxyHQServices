/**
 * `OxyServices.getFileDownloadUrl()` resolution tests.
 *
 * This is the single chokepoint every Oxy app uses to turn a stored asset id
 * into a `<img src>`-ready URL. It resolves to one of two forms:
 *
 *   - PUBLIC (no access token planted, no `expiresIn`) → the clean CDN form
 *     `${cloudURL}/<id>[?variant=...]` (default `https://cloud.oxy.so/<id>`),
 *     which CloudFront resolves against the public media origin.
 *   - SIGNED / PRIVATE (an access token is present OR `expiresIn` is passed) →
 *     the authenticated API origin form
 *     `${baseURL}/assets/<id>/stream?...&token=...` — private assets are not on
 *     the public CDN.
 */

import { OxyServices } from '../../OxyServices';

describe('OxyServices.getFileDownloadUrl', () => {
  describe('public assets (no token, no expiresIn) → CDN', () => {
    it('returns the clean cloud.oxy.so URL for a bare file id', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      expect(oxy.getFileDownloadUrl('file123')).toBe('https://cloud.oxy.so/file123');
    });

    it('appends only a variant query param (no token/fallback) for the thumb variant', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      expect(oxy.getFileDownloadUrl('file123', 'thumb')).toBe(
        'https://cloud.oxy.so/file123?variant=thumb',
      );
    });

    it('uses the configured cloudURL when overridden', () => {
      const oxy = new OxyServices({
        baseURL: 'https://api.oxy.so',
        cloudURL: 'https://cdn.example.test',
      });

      expect(oxy.getFileDownloadUrl('file123', 'thumb')).toBe(
        'https://cdn.example.test/file123?variant=thumb',
      );
    });

    it('URL-encodes the file id and the variant', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      expect(oxy.getFileDownloadUrl('a/b c', 'large size')).toBe(
        'https://cloud.oxy.so/a%2Fb%20c?variant=large%20size',
      );
    });
  });

  describe('signed / private assets → authenticated API origin', () => {
    it('returns the stream endpoint with the token when an access token is present', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
      oxy.setTokens('access-token-abc');

      const url = oxy.getFileDownloadUrl('file123', 'thumb');

      expect(url.startsWith('https://api.oxy.so/assets/file123/stream?')).toBe(true);
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('variant')).toBe('thumb');
      expect(params.get('token')).toBe('access-token-abc');
      expect(params.get('fallback')).toBe('placeholderVisible');
      expect(url).not.toContain('cloud.oxy.so');
    });

    it('routes through the stream endpoint when expiresIn is requested even without a token', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      const url = oxy.getFileDownloadUrl('file123', 'thumb', 3600);

      expect(url.startsWith('https://api.oxy.so/assets/file123/stream?')).toBe(true);
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('expiresIn')).toBe('3600');
      expect(params.get('variant')).toBe('thumb');
      expect(params.get('fallback')).toBe('placeholderVisible');
      expect(params.get('token')).toBeNull();
      expect(url).not.toContain('cloud.oxy.so');
    });
  });
});
