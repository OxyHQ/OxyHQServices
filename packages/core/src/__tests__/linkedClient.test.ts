import { OxyServices } from '../OxyServices';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function createServices(): OxyServices {
  return new OxyServices({ baseURL: 'https://api.oxy.so' });
}

function createJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function readHeaders(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers;
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}

describe('OxyServices.createLinkedClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('mirrors token changes from the session owner', () => {
    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    expect(linked.client.getAccessToken()).toBeNull();

    oxy.setTokens('access_1');
    expect(linked.client.getAccessToken()).toBe('access_1');

    oxy.setTokens('access_2');
    expect(linked.client.getAccessToken()).toBe('access_2');

    oxy.clearTokens();
    expect(linked.client.getAccessToken()).toBeNull();

    linked.dispose();
  });

  it('copies the current token when created after sign-in', () => {
    const oxy = createServices();
    oxy.setTokens('existing_access');

    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    expect(linked.client.getAccessToken()).toBe('existing_access');

    linked.dispose();
  });

  it('delegates token refresh to the session owner', async () => {
    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    oxy.getClient().setAuthRefreshHandler(async () => 'refreshed_access');

    const refreshed = await linked.client.refreshAccessToken('preflight');

    expect(refreshed).toBe('refreshed_access');
    expect(oxy.getAccessToken()).toBe('refreshed_access');
    expect(linked.client.getAccessToken()).toBe('refreshed_access');

    linked.dispose();
  });

  it('keeps the session owner intact when a linked response 401 cannot refresh', async () => {
    const oxy = createServices();
    oxy.setTokens('stale_access');
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    const refreshed = await linked.client.refreshAccessToken('response-401');

    expect(refreshed).toBeNull();
    expect(oxy.getAccessToken()).toBe('stale_access');
    expect(linked.client.getAccessToken()).toBe('stale_access');

    linked.dispose();
  });

  it('resynchronizes from the session owner after a linked app 401 clears the local token', async () => {
    const calls: FetchCall[] = [];
    let queueWriteAttempts = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.endsWith('/csrf-token')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/api/queue/current')) {
        queueWriteAttempts += 1;
        if (queueWriteAttempts === 1) {
          return new Response(JSON.stringify({ error: 'MISSING_TOKEN' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'content-type': 'application/json' },
          });
        }
      }

      return jsonResponse({ ok: true });
    };

    const oxy = createServices();
    const accessToken = createJwt({
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    oxy.setTokens(accessToken);
    oxy.getClient().setAuthRefreshHandler(async () => null);
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    await expect(linked.client.put('/api/queue/current', { trackId: 'track_1' }, { retry: false })).rejects.toMatchObject({
      message: 'MISSING_TOKEN',
      status: 401,
    });

    expect(oxy.getAccessToken()).toBe(accessToken);
    expect(linked.client.getAccessToken()).toBeNull();

    await linked.client.put('/api/queue/current', { trackId: 'track_2' });

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.oxy.so/api/queue/current',
      'https://api.oxy.so/api/queue/current',
    ]);
    expect(linked.client.getAccessToken()).toBe(accessToken);

    const firstHeaders = readHeaders(calls[0]?.init);
    expect(firstHeaders.Authorization).toBe(`Bearer ${accessToken}`);
    expect(firstHeaders['X-CSRF-Token']).toBeUndefined();

    const secondHeaders = readHeaders(calls[1]?.init);
    expect(secondHeaders.Authorization).toBe(`Bearer ${accessToken}`);
    expect(secondHeaders['X-CSRF-Token']).toBeUndefined();

    linked.dispose();
  });

  it('keeps the session owner intact when linked preflight refresh cannot refresh', async () => {
    const oxy = createServices();
    oxy.setTokens('existing_access');
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    const refreshed = await linked.client.refreshAccessToken('preflight');

    expect(refreshed).toBeNull();
    expect(oxy.getAccessToken()).toBe('existing_access');
    expect(linked.client.getAccessToken()).toBe('existing_access');

    linked.dispose();
  });

  it('stops mirroring after dispose', () => {
    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.oxy.so' });

    oxy.setTokens('before_dispose');
    expect(linked.client.getAccessToken()).toBe('before_dispose');

    linked.dispose();
    oxy.setTokens('after_dispose');

    expect(linked.client.getAccessToken()).toBeNull();
  });

  it('does not send Oxy bearer tokens to a different linked origin', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const oxy = createServices();
    oxy.setTokens(createJwt({
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }));

    const linked = oxy.createLinkedClient({ baseURL: 'https://api.syra.fm' });

    expect(linked.client.getAccessToken()).toBeNull();

    await linked.client.get('/private');

    const headers = readHeaders(fetchMock.mock.calls[0]?.[1]);
    expect(headers.Authorization).toBeUndefined();

    oxy.setTokens('later_access');
    expect(linked.client.getAccessToken()).toBeNull();

    linked.dispose();
  });

  it('joins linked base URLs with relative paths that omit the leading slash', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const oxy = createServices();
    const linked = oxy.createLinkedClient({ baseURL: 'https://api.mention.earth' });

    await linked.client.get('profile/settings/me');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.mention.earth/profile/settings/me');

    linked.dispose();
  });
});
