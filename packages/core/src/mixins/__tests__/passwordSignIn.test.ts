/**
 * Device-first password sign-in (`passwordSignIn` + `completeTwoFactorSignIn`).
 * Stubs `makeRequest` and asserts the login-result contract handling: the 2FA
 * arm passes through un-planted, the session arm plants its access token, the
 * deviceToken is threaded into the request, and a 2FA arm from verify-login is
 * a protocol error.
 */
import type { LoginResult } from '@oxyhq/contracts';
import { OxyServices } from '../../OxyServices';

const SESSION_ARM: LoginResult = {
  sessionId: 'sess-1',
  deviceId: 'dev-1',
  expiresAt: '2030-01-01T00:00:00.000Z',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: { id: 'user-1', username: 'u' },
};

const TWO_FACTOR_ARM: LoginResult = { twoFactorRequired: true, loginToken: 'login-token-1' };

describe('passwordSignIn', () => {
  let oxy: OxyServices;
  let makeRequest: jest.SpyInstance;
  let setTokens: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequest = jest.spyOn(oxy, 'makeRequest');
    setTokens = jest.spyOn(oxy, 'setTokens').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the 2FA arm without planting a token', async () => {
    makeRequest.mockResolvedValueOnce(TWO_FACTOR_ARM);
    const result = await oxy.passwordSignIn('alice', 'pw');
    expect(result).toEqual(TWO_FACTOR_ARM);
    expect(setTokens).not.toHaveBeenCalled();
  });

  it('plants the access token on the session arm and threads the deviceToken', async () => {
    makeRequest.mockResolvedValueOnce(SESSION_ARM);
    const result = await oxy.passwordSignIn('alice', 'pw', { deviceToken: 'dt-1', deviceName: 'Phone' });
    expect(result).toEqual(SESSION_ARM);
    expect(setTokens).toHaveBeenCalledWith('access-1');
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/login',
      { identifier: 'alice', password: 'pw', deviceName: 'Phone', deviceFingerprint: undefined, deviceToken: 'dt-1' },
      { cache: false },
    );
  });

  it('throws on an unexpected response shape', async () => {
    makeRequest.mockResolvedValueOnce({ nope: true });
    await expect(oxy.passwordSignIn('alice', 'pw')).rejects.toThrow();
  });
});

describe('completeTwoFactorSignIn', () => {
  let oxy: OxyServices;
  let makeRequest: jest.SpyInstance;
  let setTokens: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequest = jest.spyOn(oxy, 'makeRequest');
    setTokens = jest.spyOn(oxy, 'setTokens').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('verifies the login token, plants the session, and POSTs to /security/2fa/verify-login', async () => {
    makeRequest.mockResolvedValueOnce(SESSION_ARM);
    const result = await oxy.completeTwoFactorSignIn({ loginToken: 'lt', token: '123456', deviceToken: 'dt-1' });
    expect(result).toEqual(SESSION_ARM);
    expect(setTokens).toHaveBeenCalledWith('access-1');
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/security/2fa/verify-login',
      { loginToken: 'lt', token: '123456', backupCode: undefined, deviceToken: 'dt-1', deviceName: undefined },
      { cache: false },
    );
  });

  it('throws when verify-login unexpectedly returns another 2FA challenge', async () => {
    makeRequest.mockResolvedValueOnce(TWO_FACTOR_ARM);
    await expect(oxy.completeTwoFactorSignIn({ loginToken: 'lt', token: '123456' })).rejects.toThrow();
  });
});
