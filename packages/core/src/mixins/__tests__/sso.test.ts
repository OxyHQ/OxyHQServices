/**
 * `OxyServices.exchangeSsoCode` / `generateSsoState` — central SSO client.
 *
 * `exchangeSsoCode(code)` POSTs the opaque single-use code to the session base
 * URL (`getSessionBaseUrl()` — i.e. `api.oxy.so` by default) at `/sso/exchange`
 * with NO credentials, then plants the returned access token via
 * `httpService.setTokens(...)` — mirroring `exchangeIdTokenForSession` /
 * `verifyChallenge`. NO token/JWT ever travels in the URL; the real token only
 * arrives in this exchange response body.
 */

import { OxyServices } from '../../OxyServices';
import { generateSsoState } from '../OxyServices.sso';
import { ssoStateKey } from '../../utils/ssoBounce';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetchOnce(body: unknown, ok = true, status = 200): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  return { calls };
}

const VALID_BODY = {
  accessToken: 'access_sso',
  sessionId: 'sess_sso',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  authuser: 0,
  user: {
    id: 'user_sso',
    username: 'ssouser',
    name: { displayName: 'SSO User', first: 'SSO', last: 'User', full: 'SSO User' },
    avatar: 'file_1',
  },
};

describe('OxyServices.exchangeSsoCode', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs the code to the API base /sso/exchange with no credentials', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const { calls } = mockFetchOnce(VALID_BODY);

    await oxy.exchangeSsoCode('opaque-code-123');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.oxy.so/sso/exchange');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('omit');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ code: 'opaque-code-123' });
  });

  it('targets the configured sessionBaseUrl when set', async () => {
    const oxy = new OxyServices({
      baseURL: 'https://api.oxy.so',
      sessionBaseUrl: 'https://api.mention.earth',
    });
    const { calls } = mockFetchOnce(VALID_BODY);

    await oxy.exchangeSsoCode('opaque-code-123');

    expect(calls[0].url).toBe('https://api.mention.earth/sso/exchange');
  });

  it('plants the access token via setTokens and returns the session', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    expect(oxy.hasValidToken()).toBe(false);
    mockFetchOnce(VALID_BODY);

    const session = await oxy.exchangeSsoCode('opaque-code-123');

    expect(oxy.hasValidToken()).toBe(true);
    expect(oxy.getAccessToken()).toBe('access_sso');
    expect(session.sessionId).toBe('sess_sso');
    expect(session.accessToken).toBe('access_sso');
    expect(session.user).toEqual({
      id: 'user_sso',
      username: 'ssouser',
      name: { displayName: 'SSO User', first: 'SSO', last: 'User', full: 'SSO User' },
      avatar: 'file_1',
    });
    expect(session.expiresAt).toBe(VALID_BODY.expiresAt);
  });

  it('maps a user delivered as _id', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    mockFetchOnce({
      accessToken: 'access_sso',
      sessionId: 'sess_sso',
      user: { _id: 'mongo_id', username: 'ssouser', name: { displayName: 'SSO User' } },
    });

    const session = await oxy.exchangeSsoCode('opaque-code-123');

    expect(session.user.id).toBe('mongo_id');
  });

  it('rejects an empty code without calling fetch', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const { calls } = mockFetchOnce(VALID_BODY);

    await expect(oxy.exchangeSsoCode('')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects a browser SSO exchange when stored state is not echoed', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const { calls } = mockFetchOnce(VALID_BODY);
    const storage = new Map([[ssoStateKey('https://rp.example'), 'expected-state']]);
    const previousWindow = (globalThis as unknown as { window?: unknown }).window;

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { origin: 'https://rp.example' },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
        },
      },
    });

    try {
      await expect(oxy.exchangeSsoCode('opaque-code-123', 'attacker-state')).rejects.toThrow(
        'SSO exchange state mismatch',
      );
      expect(calls).toHaveLength(0);
      expect(oxy.hasValidToken()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  });

  it('throws and does not plant a token on a non-2xx response', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    mockFetchOnce({ error: 'invalid_code' }, false, 400);

    await expect(oxy.exchangeSsoCode('bad-code')).rejects.toThrow();
    expect(oxy.hasValidToken()).toBe(false);
  });

  it('throws when the response carries no access token', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    mockFetchOnce({ sessionId: 'sess_sso', user: { id: 'u', username: 'x' } });

    await expect(oxy.exchangeSsoCode('opaque-code-123')).rejects.toThrow();
    expect(oxy.hasValidToken()).toBe(false);
  });
});

describe('OxyServices.requestSsoEstablishUrl', () => {
  const ESTABLISH_URL =
    'https://auth.oxy.so/sso/establish?et=jwt&return_to=https%3A%2F%2Faccounts.oxy.so%2F__oxy%2Fsso-callback&state=s';

  it('POSTs origin + state to /sso/establish-token (bearer, cache-free) and returns the URL', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const spy = jest
      .spyOn(oxy, 'makeRequest')
      .mockResolvedValue({ establishUrl: ESTABLISH_URL } as never);

    const result = await oxy.requestSsoEstablishUrl('https://accounts.oxy.so', 's');

    expect(result).toEqual({ establishUrl: ESTABLISH_URL });
    expect(spy).toHaveBeenCalledWith(
      'POST',
      '/sso/establish-token',
      { origin: 'https://accounts.oxy.so', state: 's' },
      { cache: false },
    );
    spy.mockRestore();
  });

  it('rejects an empty origin or state without calling the API', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const spy = jest.spyOn(oxy, 'makeRequest');

    await expect(oxy.requestSsoEstablishUrl('', 's')).rejects.toThrow();
    await expect(oxy.requestSsoEstablishUrl('https://accounts.oxy.so', '')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('throws when the server returns no establishUrl', async () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
    const spy = jest.spyOn(oxy, 'makeRequest').mockResolvedValue({} as never);

    await expect(oxy.requestSsoEstablishUrl('https://accounts.oxy.so', 's')).rejects.toThrow();
    spy.mockRestore();
  });
});

describe('generateSsoState', () => {
  it('returns a non-empty unique string (module-level helper)', () => {
    const a = generateSsoState();
    const b = generateSsoState();

    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('is also reachable as an instance method delegating to generateState', () => {
    const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

    const state = oxy.generateSsoState();

    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(0);
  });
});
