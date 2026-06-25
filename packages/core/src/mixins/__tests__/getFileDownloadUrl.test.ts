/**
 * `OxyServices.getFileDownloadUrl()` resolution tests.
 *
 * This is the single chokepoint every Oxy app uses to turn a stored asset id
 * into a `<img src>`-ready URL. Because a bare id does not carry visibility
 * metadata, the synchronous helper must use the API stream endpoint. That route
 * can serve direct-link `unlisted` assets and can redirect public CDN-backed
 * assets to the CDN after the server has checked the file record.
 */

import { OxyServices } from '../../OxyServices';

describe('OxyServices.getFileDownloadUrl', () => {
  describe('asset stream URL generation', () => {
    it('returns the API stream endpoint for a bare file id', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      expect(oxy.getFileDownloadUrl('file123')).toBe(
        'https://api.oxy.so/assets/file123/stream?fallback=placeholderVisible',
      );
    });

    it('appends a variant query param for thumbnails', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      expect(oxy.getFileDownloadUrl('file123', 'thumb')).toBe(
        'https://api.oxy.so/assets/file123/stream?variant=thumb&fallback=placeholderVisible',
      );
    });

    it('does not use cloudURL because visibility is unknown to the sync helper', () => {
      const oxy = new OxyServices({
        baseURL: 'https://api.oxy.so',
        cloudURL: 'https://cdn.example.test',
      });

      expect(oxy.getFileDownloadUrl('file123', 'thumb')).toBe(
        'https://api.oxy.so/assets/file123/stream?variant=thumb&fallback=placeholderVisible',
      );
    });

    it('URL-encodes the file id and the variant', () => {
      const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

      expect(oxy.getFileDownloadUrl('a/b c', 'large size')).toBe(
        'https://api.oxy.so/assets/a%2Fb%20c/stream?variant=large+size&fallback=placeholderVisible',
      );
    });
  });

  describe('signed / expiring assets', () => {
    it('includes the token when an access token is present', () => {
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

    it('includes expiresIn when requested even without a token', () => {
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
