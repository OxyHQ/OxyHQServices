/**
 * `deviceAccountsResponse` — the shared handler behind the `/api/device-accounts`
 * Pages Function.
 *
 * Reads the `oxy_device` cookie and forwards it to the API's cookie-less
 * `POST /auth/device/resolve` under the shared `X-Oxy-Internal` secret. Pins:
 *   - no cookie → empty list, and the resolve endpoint is NOT called;
 *   - cookie present → the outbound call carries `{ deviceKey }` + the internal
 *     secret header, and the resolved accounts are returned;
 *   - a non-2xx resolve / a malformed body → fail-closed empty list;
 *   - the internal secret is never echoed back to the client.
 *
 * Run with `bun test`. The upstream API is stubbed via a global `fetch` mock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { deviceAccountsResponse } from '@/lib/device-accounts';

const API_BASE = 'https://api.oxy.so';
const INTERNAL_SECRET = 'test-sso-internal-secret-32-chars-long!!';
const env = { OXY_API_URL: API_BASE, SSO_INTERNAL_SECRET: INTERNAL_SECRET };

const realFetch = globalThis.fetch;

interface CapturedResolve {
  called: boolean;
  internalSecret: string | null;
  body: unknown;
}

let captured: CapturedResolve;
let resolveStatus = 200;
let resolveBody: unknown = { activeAccountId: null, accounts: [] };

function installStub(): void {
  captured = { called: false, internalSecret: null, body: undefined };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/auth/device/resolve')) {
      captured.called = true;
      const headers = new Headers(init?.headers);
      captured.internalSecret = headers.get('X-Oxy-Internal');
      captured.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify(resolveBody), {
        status: resolveStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

const SAMPLE = {
  activeAccountId: 'u1',
  accounts: [
    { user: { id: 'u1' }, sessionId: 's1', accessToken: 'at1', expiresAt: '2999-01-01T00:00:00.000Z' },
    { user: { id: 'u2' }, sessionId: 's2', accessToken: 'at2', expiresAt: '2999-01-01T00:00:00.000Z' },
  ],
};

function request(cookie?: string): Request {
  return new Request('https://auth.oxy.so/api/device-accounts', {
    headers: cookie ? { cookie } : {},
  });
}

describe('deviceAccountsResponse', () => {
  beforeEach(() => {
    resolveStatus = 200;
    resolveBody = { activeAccountId: null, accounts: [] };
    installStub();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns an empty list and does NOT call resolve when there is no oxy_device cookie', async () => {
    const res = await deviceAccountsResponse(request(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
    expect(captured.called).toBe(false);
  });

  it('fails closed when the internal secret is not configured', async () => {
    const res = await deviceAccountsResponse(request('oxy_device=raw-secret-1234567890'), { OXY_API_URL: API_BASE });
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
    expect(captured.called).toBe(false);
  });

  it('forwards the cookie value as {deviceKey} with the X-Oxy-Internal secret and returns the accounts', async () => {
    resolveBody = SAMPLE;
    const res = await deviceAccountsResponse(request('a=1; oxy_device=raw-secret-1234567890; b=2'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeAccountId).toBe('u1');
    expect(body.accounts).toHaveLength(2);
    expect(captured.called).toBe(true);
    expect(captured.internalSecret).toBe(INTERNAL_SECRET);
    expect(captured.body).toEqual({ deviceKey: 'raw-secret-1234567890' });
  });

  it('strips RFC 6265 wrapping double-quotes from the cookie value before forwarding', async () => {
    resolveBody = SAMPLE;
    const res = await deviceAccountsResponse(request('oxy_device="raw-secret-1234567890"'), env);
    expect(res.status).toBe(200);
    expect(captured.called).toBe(true);
    expect(captured.body).toEqual({ deviceKey: 'raw-secret-1234567890' });
  });

  it('percent-decodes a URL-encoded cookie value before forwarding', async () => {
    resolveBody = SAMPLE;
    const res = await deviceAccountsResponse(request('oxy_device=raw%2Fsecret%3D1234'), env);
    expect(res.status).toBe(200);
    expect(captured.body).toEqual({ deviceKey: 'raw/secret=1234' });
  });

  it('fails closed when env is undefined (no configured secret)', async () => {
    const res = await deviceAccountsResponse(request('oxy_device=raw-secret-1234567890'), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
    expect(captured.called).toBe(false);
  });

  it('fails closed to an empty list when resolve returns a non-2xx', async () => {
    resolveStatus = 500;
    resolveBody = { message: 'boom' };
    const res = await deviceAccountsResponse(request('oxy_device=raw-secret-1234567890'), env);
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
    expect(captured.called).toBe(true);
  });

  it('fails closed when the resolve body is malformed (accounts is not an array)', async () => {
    resolveBody = { activeAccountId: 'u1', accounts: 'nope' };
    const res = await deviceAccountsResponse(request('oxy_device=raw-secret-1234567890'), env);
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
  });

  it('never echoes the internal secret back to the client', async () => {
    resolveBody = SAMPLE;
    const res = await deviceAccountsResponse(request('oxy_device=raw-secret-1234567890'), env);
    const text = await res.text();
    expect(text.includes(INTERNAL_SECRET)).toBe(false);
  });
});
