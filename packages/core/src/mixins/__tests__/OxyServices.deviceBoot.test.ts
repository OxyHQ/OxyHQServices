/**
 * Device-boot mixin tests. Stubs `makeRequest` so the tests run with no network
 * and asserts `mintFromDeviceSecret`'s route/shape, contract validation, and the
 * `skipAuth` flag on the bearer-less mint call.
 */
import type { DeviceTokenMintResponse } from '@oxyhq/contracts';
import { OxyServices } from '../../OxyServices';

describe('OxyServices.deviceBoot', () => {
  let oxy: OxyServices;
  let makeRequest: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequest = jest.spyOn(oxy, 'makeRequest');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('mintFromDeviceSecret', () => {
    const MINT: DeviceTokenMintResponse = {
      accessToken: 'access-minted',
      expiresAt: '2030-01-01T00:00:00.000Z',
      nextDeviceSecret: 'ds-next-secret',
      state: {
        deviceId: 'dev-1',
        accounts: [{ accountId: 'user-1', sessionId: 'sess-1', authuser: 0 }],
        activeAccountId: 'user-1',
        revision: 3,
        updatedAt: 1_700_000_000_000,
      },
    };

    it('POSTs deviceId + deviceSecret with skipAuth + retry:false (no bearer, no cache, single attempt) and returns the validated mint', async () => {
      makeRequest.mockResolvedValueOnce(MINT);
      const result = await oxy.mintFromDeviceSecret('dev-1', 'ds-current-secret');
      expect(result).toEqual(MINT);
      // `retry: false` — the scheduler/401 lane own backoff; HttpService's inner
      // retry here would only multiply cold-boot latency on a slow network.
      expect(makeRequest).toHaveBeenCalledWith(
        'POST',
        '/session/device/token',
        { deviceId: 'dev-1', deviceSecret: 'ds-current-secret' },
        { cache: false, skipAuth: true, retry: false },
      );
    });

    it('throws on an unexpected response shape (missing state / nextDeviceSecret)', async () => {
      makeRequest.mockResolvedValueOnce({ accessToken: 'a', expiresAt: 'b' });
      await expect(oxy.mintFromDeviceSecret('dev-1', 'ds')).rejects.toThrow();
    });

    it('propagates a rejected request (e.g. 401 invalid_device_secret)', async () => {
      const err = Object.assign(new Error('invalid_device_secret'), { status: 401 });
      makeRequest.mockRejectedValueOnce(err);
      await expect(oxy.mintFromDeviceSecret('dev-1', 'ds')).rejects.toThrow('invalid_device_secret');
    });

    it('propagates a 401 no_active_session so the caller can resolve signed-out', async () => {
      const err = Object.assign(new Error('no_active_session'), { status: 401 });
      makeRequest.mockRejectedValueOnce(err);
      await expect(oxy.mintFromDeviceSecret('dev-1', 'ds')).rejects.toThrow('no_active_session');
    });
  });
});
