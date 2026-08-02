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

  it('webauthnRegisterOptions skips auth preflight on signup (username provided)', async () => {
    await oxy.webauthnRegisterOptions('alice');
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/webauthn/register/options',
      { username: 'alice' },
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('webauthnRegisterVerify skips auth preflight on signup (username in envelope)', async () => {
    makeRequest.mockResolvedValueOnce({
      sessionId: 's1',
      deviceId: 'd1',
      accessToken: 'tok',
      expiresAt: '2030-01-01T00:00:00.000Z',
      deviceSecret: 'ds',
      user: { id: 'u1', username: 'alice' },
    });
    await oxy.webauthnRegisterVerify({ id: 'cred' }, { username: 'alice' });
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/webauthn/register/verify',
      expect.objectContaining({ username: 'alice' }),
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('getServiceToken skips auth preflight', async () => {
    makeRequest.mockResolvedValueOnce({ token: 'svc-tok', expiresIn: 3600 });
    await oxy.getServiceToken('oxy_dk_svc', 'secret-value');
    expect(makeRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/service-token',
      { apiKey: 'oxy_dk_svc', apiSecret: 'secret-value' },
      expect.objectContaining({ skipAuth: true, cache: false, retry: false }),
    );
  });

  it('exchangeOAuthCode skips auth preflight and sends an RFC 6749 form request', async () => {
    makeRequest.mockResolvedValueOnce({
      access_token: 'tok',
      token_type: 'Bearer',
      expires_in: 900,
      session_id: 's1',
      deviceId: 'd1',
      deviceSecret: 'ds_secret',
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
      expect.any(URLSearchParams),
      expect.objectContaining({ skipAuth: true }),
    );
    // The body is the standard §4.1.3 request: snake_case names, an explicit
    // grant type, and nothing camelCase that only Oxy's old endpoint understood.
    const body = makeRequest.mock.calls[0][2] as URLSearchParams;
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://app.example/callback',
      client_id: 'oxy_dk_test',
      code_verifier: 'verifier',
    });
  });

  it('exchangeOAuthCode rejects a response without deviceSecret', async () => {
    makeRequest.mockResolvedValueOnce({
      access_token: 'tok',
      token_type: 'Bearer',
      expires_in: 900,
      session_id: 's1',
      deviceId: 'd1',
      user: { id: 'u1' },
    });
    await expect(
      oxy.exchangeOAuthCode({
        code: 'code-1',
        clientId: 'oxy_dk_test',
        redirectUri: 'https://app.example/callback',
        codeVerifier: 'verifier',
      }),
    ).rejects.toThrow(/incomplete session payload/i);
  });

  it('exchangeOAuthCode reads the FLAT RFC 6749 §5.1 response', async () => {
    makeRequest.mockResolvedValueOnce({
      access_token: 'tok',
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'profile:read',
      session_id: 's1',
      deviceId: 'd1',
      deviceSecret: 'ds_secret',
      user: { id: 'u1', username: 'alice', avatar: 'file-1' },
    });

    const result = await oxy.exchangeOAuthCode({
      code: 'code-1',
      clientId: 'oxy_dk_test',
      redirectUri: 'https://app.example/callback',
      codeVerifier: 'verifier',
    });

    expect(result).toMatchObject({
      sessionId: 's1',
      deviceId: 'd1',
      deviceSecret: 'ds_secret',
      accessToken: 'tok',
      user: { id: 'u1', username: 'alice', avatar: 'file-1' },
    });
  });
});
