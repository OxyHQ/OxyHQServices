/**
 * Authorized-apps mixin tests — the "Connected apps" management pair that
 * survived the FedCM removal. Stubs `makeRequest` (no network).
 */
import type { AuthorizedApp } from '../OxyServices.authorizedApps';
import { OxyServices } from '../../OxyServices';

const APP: AuthorizedApp = {
  origin: 'https://mention.earth',
  name: 'Mention',
  firstGrantedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: '2026-06-01T00:00:00.000Z',
};

describe('OxyServices.authorizedApps', () => {
  let oxy: OxyServices;
  let makeRequest: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequest = jest.spyOn(oxy, 'makeRequest');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('listAuthorizedApps', () => {
    it('GETs the authorized-apps and returns the array', async () => {
      makeRequest.mockResolvedValueOnce({ apps: [APP] });
      expect(await oxy.listAuthorizedApps()).toEqual([APP]);
      expect(makeRequest).toHaveBeenCalledWith(
        'GET',
        '/fedcm/me/authorized-apps',
        undefined,
        expect.objectContaining({ cache: true }),
      );
    });

    it('defaults to [] when the response has no apps', async () => {
      makeRequest.mockResolvedValueOnce({});
      expect(await oxy.listAuthorizedApps()).toEqual([]);
    });

    it('defaults to [] when the response is null (no throw on null access)', async () => {
      makeRequest.mockResolvedValueOnce(null);
      expect(await oxy.listAuthorizedApps()).toEqual([]);
    });
  });

  describe('revokeAuthorizedApp', () => {
    it('DELETEs the encoded origin and sweeps the list cache', async () => {
      const clearCacheEntry = jest.spyOn(oxy, 'clearCacheEntry');
      makeRequest.mockResolvedValueOnce(undefined);
      await oxy.revokeAuthorizedApp('https://mention.earth');
      expect(makeRequest).toHaveBeenCalledWith(
        'DELETE',
        '/fedcm/me/authorized-apps/https%3A%2F%2Fmention.earth',
        undefined,
        { cache: false },
      );
      expect(clearCacheEntry).toHaveBeenCalledWith('GET:/fedcm/me/authorized-apps');
    });
  });
});
