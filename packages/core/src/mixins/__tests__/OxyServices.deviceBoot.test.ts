/**
 * Device-boot mixin tests. Stubs `makeRequest` so the tests run with no network
 * and asserts each method's route/shape, contract validation, and the
 * `skipAuth` flag on the refresh call.
 */
import type { AuthTokenBundle, TokenRefreshResponse, WebSessionResult } from '@oxyhq/contracts';
import { OxyServices } from '../../OxyServices';

const BUNDLE: AuthTokenBundle = {
  sessionId: 'sess-1',
  accessToken: 'access-1',
  refreshToken: 'refresh-abcdefghijkl',
  expiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: 'user-1', name: {} } as AuthTokenBundle['user'],
};

const ROTATED: TokenRefreshResponse = {
  accessToken: 'access-2',
  refreshToken: 'refresh-mnopqrstuvwx',
  expiresAt: '2030-01-01T00:00:00.000Z',
  sessionId: 'sess-1',
};

describe('OxyServices.deviceBoot', () => {
  let oxy: OxyServices;
  let makeRequest: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequest = jest.spyOn(oxy, 'makeRequest');
  });

  afterEach(() => jest.restoreAllMocks());

  describe('exchangeBootCode', () => {
    it('POSTs the code and returns the validated bundle', async () => {
      makeRequest.mockResolvedValueOnce(BUNDLE);
      const result = await oxy.exchangeBootCode('code-123');
      expect(result).toEqual(BUNDLE);
      expect(makeRequest).toHaveBeenCalledWith('POST', '/auth/device/exchange', { code: 'code-123' }, { cache: false });
    });

    it('throws on an unexpected response shape', async () => {
      makeRequest.mockResolvedValueOnce({ nope: true });
      await expect(oxy.exchangeBootCode('code-123')).rejects.toThrow();
    });
  });

  describe('requestWebSession', () => {
    it('returns the session arm (bundle nested under `session` + deviceToken)', async () => {
      const sessionArm: WebSessionResult = { reason: 'session', session: BUNDLE, deviceToken: 'device-abcdefghij' };
      makeRequest.mockResolvedValueOnce(sessionArm);
      const result = await oxy.requestWebSession();
      expect(result).toEqual(sessionArm);
      expect(makeRequest).toHaveBeenCalledWith('POST', '/auth/device/web-session', undefined, { cache: false });
    });

    it('returns the no-session arm', async () => {
      const noSession: WebSessionResult = { reason: 'no_session', deviceToken: 'device-abcdefghij' };
      makeRequest.mockResolvedValueOnce(noSession);
      const result = await oxy.requestWebSession();
      expect(result.reason).toBe('no_session');
      expect(result).toEqual(noSession);
    });

    it('throws on the OLD bare-bundle shape (regression: server now wraps in a reason envelope)', async () => {
      makeRequest.mockResolvedValueOnce(BUNDLE);
      await expect(oxy.requestWebSession()).rejects.toThrow();
    });

    it('throws when the response matches neither arm', async () => {
      makeRequest.mockResolvedValueOnce({ reason: 'weird' });
      await expect(oxy.requestWebSession()).rejects.toThrow();
    });
  });

  describe('refreshWithToken', () => {
    it('POSTs with skipAuth and returns the rotated pair', async () => {
      makeRequest.mockResolvedValueOnce(ROTATED);
      const result = await oxy.refreshWithToken('refresh-abcdefghijkl');
      expect(result).toEqual(ROTATED);
      expect(makeRequest).toHaveBeenCalledWith(
        'POST',
        '/auth/refresh-token',
        { refreshToken: 'refresh-abcdefghijkl' },
        { cache: false, skipAuth: true },
      );
    });
  });

  describe('issueNativeDeviceToken', () => {
    it('POSTs and returns just the token string', async () => {
      makeRequest.mockResolvedValueOnce({ deviceToken: 'native-dt' });
      expect(await oxy.issueNativeDeviceToken()).toBe('native-dt');
      expect(makeRequest).toHaveBeenCalledWith('POST', '/auth/device/token', undefined, { cache: false });
    });
  });

  describe('buildBootstrapUrl', () => {
    it('builds the bootstrap URL with encoded params', () => {
      const url = oxy.buildBootstrapUrl('https://accounts.oxy.so/home', 'st-1');
      expect(url).toContain('http://test.invalid/auth/device/bootstrap?');
      expect(url).toContain('return_to=https%3A%2F%2Faccounts.oxy.so%2Fhome');
      expect(url).toContain('state=st-1');
    });
  });
});
