/**
 * Authorized-apps mixin tests — the "Connected apps" management pair over the
 * AppGrant endpoints (`GET`/`DELETE /apps/authorized`). Stubs `makeRequest`.
 */
import type { AuthorizedApp } from '../OxyServices.authorizedApps';
import { OxyServices } from '../../OxyServices';

const APP: AuthorizedApp = {
  clientId: 'oxy_dk_mention',
  appName: 'Mention',
  appIconUrl: 'https://cloud.oxy.so/icon123',
  grantedAt: '2026-01-01T00:00:00.000Z',
  scopes: ['profile', 'email'],
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
    it('GETs /apps/authorized and returns the apps array', async () => {
      makeRequest.mockResolvedValueOnce({ apps: [APP] });
      expect(await oxy.listAuthorizedApps()).toEqual([APP]);
      expect(makeRequest).toHaveBeenCalledWith(
        'GET',
        '/apps/authorized',
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
    it('DELETEs the encoded clientId and sweeps the list cache', async () => {
      const clearCacheEntry = jest.spyOn(oxy, 'clearCacheEntry');
      makeRequest.mockResolvedValueOnce(undefined);
      await oxy.revokeAuthorizedApp('oxy_dk_mention');
      expect(makeRequest).toHaveBeenCalledWith(
        'DELETE',
        '/apps/authorized/oxy_dk_mention',
        undefined,
        { cache: false },
      );
      expect(clearCacheEntry).toHaveBeenCalledWith('GET:/apps/authorized');
    });
  });
});
