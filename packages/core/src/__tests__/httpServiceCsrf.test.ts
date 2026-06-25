import { HttpService } from '../HttpService';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
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

describe('HttpService CSRF behavior', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('does not fetch csrf-token before bearer-authenticated writes', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return jsonResponse({ ok: true });
    };

    const http = new HttpService({ baseURL: 'https://api.mention.earth', enableRetry: false });
    const accessToken = createJwt({
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    http.setTokens(accessToken);

    await http.post('/posts', { text: 'hello' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.mention.earth/posts');
    const headers = readHeaders(calls[0].init);
    expect(headers.Authorization).toBe(`Bearer ${accessToken}`);
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('keeps a valid near-expiry bearer token when preflight refresh cannot refresh', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return jsonResponse({ ok: true });
    };

    const http = new HttpService({ baseURL: 'https://api.mention.earth', enableRetry: false });
    const accessToken = createJwt({
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) + 30,
    });
    let refreshAttempts = 0;
    http.setTokens(accessToken);
    http.setAuthRefreshHandler(async () => {
      refreshAttempts += 1;
      return null;
    });

    await http.post('/posts', { text: 'hello' });

    expect(refreshAttempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.mention.earth/posts');
    const headers = readHeaders(calls[0].init);
    expect(headers.Authorization).toBe(`Bearer ${accessToken}`);
    expect(headers['X-CSRF-Token']).toBeUndefined();
  });

  it('does not use an expired bearer token when preflight refresh cannot refresh', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/csrf-token')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse({ ok: true });
    };

    const http = new HttpService({ baseURL: 'https://api.mention.earth', enableRetry: false });
    const accessToken = createJwt({
      userId: 'user_1',
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    let refreshAttempts = 0;
    http.setTokens(accessToken);
    http.setAuthRefreshHandler(async () => {
      refreshAttempts += 1;
      return null;
    });

    await http.post('/posts', { text: 'hello' });

    expect(refreshAttempts).toBe(1);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.mention.earth/csrf-token',
      'https://api.mention.earth/posts',
    ]);
    const headers = readHeaders(calls[1].init);
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-CSRF-Token']).toBe('csrf_1');
  });

  it('still fetches csrf-token for cookie-authenticated writes without bearer', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/csrf-token')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse({ ok: true });
    };

    const http = new HttpService({ baseURL: 'https://api.mention.earth', enableRetry: false });

    await http.post('/posts', { text: 'hello' });

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.mention.earth/csrf-token',
      'https://api.mention.earth/posts',
    ]);
    const headers = readHeaders(calls[1].init);
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-CSRF-Token']).toBe('csrf_1');
  });

  it('does not log raw csrf-token response values when debug logging is enabled', async () => {
    const csrfToken = 'csrf_secret_value_that_must_not_be_logged';
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/csrf-token')) {
        return new Response(JSON.stringify({ csrfToken }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse({ ok: true });
    };
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const http = new HttpService({
      baseURL: 'https://api.mention.earth',
      enableRetry: false,
      enableLogging: true,
      logLevel: 'debug',
    });

    await http.post('/posts', { text: 'hello' });

    const logs = consoleLogSpy.mock.calls
      .map((call) =>
        call.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')
      )
      .join('\n');
    expect(logs).not.toContain(csrfToken);
    expect(logs).toContain('hasCsrfToken');
    expect(logs).toContain(String(csrfToken.length));
  });

});
