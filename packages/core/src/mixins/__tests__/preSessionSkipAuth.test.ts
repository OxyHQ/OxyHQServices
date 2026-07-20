/**
 * Regression: every purely pre-session public SDK endpoint must pass `skipAuth`
 * so a pending refresh handler cannot self-await (see httpServiceAuthSelfAwait).
 */
import { OxyServices } from '../../OxyServices';
import { SignatureService } from '../../crypto/signatureService';

describe('pre-session public endpoints use skipAuth', () => {
  let oxy: OxyServices;
  let makeRequest: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequest = jest.spyOn(oxy, 'makeRequest').mockResolvedValue({} as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lookupUsername skips auth preflight', async () => {
    await oxy.lookupUsername('alice');
    expect(makeRequest).toHaveBeenCalledWith(
      'GET',
      '/auth/lookup/alice',
      undefined,
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('getPublicApplication skips auth preflight', async () => {
    makeRequest.mockResolvedValueOnce({ application: { id: 'app-1', name: 'App' } });
    await oxy.getPublicApplication('oxy_dk_test');
    expect(makeRequest).toHaveBeenCalledWith(
      'GET',
      '/auth/oauth/client/oxy_dk_test',
      undefined,
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('claimSessionByToken skips auth preflight', async () => {
    makeRequest.mockResolvedValueOnce({
      accessToken: 'tok',
      sessionId: 's1',
      deviceId: 'd1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      user: { id: 'u1', username: 'u' },
    });
    await oxy.claimSessionByToken('secret-session-token');
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/session/claim',
      { sessionToken: 'secret-session-token' },
      expect.objectContaining({ skipAuth: true, retry: false }),
    );
  });

  it('startCommonsSignIn skips auth preflight', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const generateChallenge = jest
      .spyOn(SignatureService, 'generateChallenge')
      .mockResolvedValue('secret-session-token');
    makeRequest.mockResolvedValueOnce({
      authorizeCode: 'code-1',
      qrPayload: 'oxycommons://approve?v=1&code=code-1',
      status: 'pending',
    });
    await oxy.startCommonsSignIn({ clientId: 'oxy_dk_test' });
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/session/create',
      expect.objectContaining({ sessionToken: 'secret-session-token', clientId: 'oxy_dk_test' }),
      expect.objectContaining({ cache: false, skipAuth: true }),
    );
    generateChallenge.mockRestore();
  });

  it('getUserByPublicKey skips auth preflight', async () => {
    makeRequest.mockResolvedValueOnce({ id: 'u1', username: 'alice' });
    await oxy.getUserByPublicKey('abc123');
    expect(makeRequest).toHaveBeenCalledWith(
      'GET',
      '/auth/user/abc123',
      undefined,
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('exchangeOAuthCode skips auth preflight', async () => {
    makeRequest.mockResolvedValueOnce({
      sessionId: 's1',
      deviceId: 'd1',
      accessToken: 'tok',
      user: { id: 'u1' },
    });
    await oxy.exchangeOAuthCode({
      code: 'code-1',
      clientId: 'oxy_dk_test',
      redirectUri: 'https://app.example/callback',
      codeVerifier: 'verifier',
    });
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/oauth/token',
      {
        code: 'code-1',
        clientId: 'oxy_dk_test',
        redirectUri: 'https://app.example/callback',
        codeVerifier: 'verifier',
      },
      expect.objectContaining({ skipAuth: true }),
    );
  });
});
