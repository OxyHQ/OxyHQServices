/**
 * IdP worker (auth.oxy.so) — `GET /api/device-accounts` account-chooser feed.
 *
 * The SPA calls this same-origin endpoint on a cold visit. The worker reads the
 * first-party `oxy_device` cookie, forwards its RAW value to the API's
 * cookie-less `POST /auth/device/resolve` under the shared `X-Oxy-Internal`
 * secret, and returns the resolved device account set. These tests pin:
 *   - no cookie → empty list, and the resolve endpoint is NOT called;
 *   - cookie present → the outbound call carries `{ deviceKey }` + the internal
 *     secret header, and the resolved accounts are returned;
 *   - a non-2xx resolve → fail-closed empty list;
 *   - a malformed resolve body → fail-closed empty list;
 *   - the internal secret is never echoed back to the client.
 *
 * Run with `bun test`. The upstream API is stubbed via a global `fetch` mock.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

const API_BASE = 'https://api.oxy.so';
const INTERNAL_SECRET = 'test-sso-internal-secret-32-chars-long!!';

// Configure env BEFORE importing the server module (it reads env at load).
process.env.OXY_API_URL = API_BASE;
process.env.SSO_INTERNAL_SECRET = INTERNAL_SECRET;
process.env.FEDCM_TOKEN_SECRET = 'test-fedcm-secret';
process.env.FEDCM_ISSUER = 'https://auth.oxy.so';
process.env.NODE_ENV = 'test';

const { app } = await import('../index');

const realFetch = globalThis.fetch;

interface CapturedResolve {
  called: boolean;
  count: number;
  internalSecret: string | null;
  body: unknown;
}

let captured: CapturedResolve;
// Stub behaviour for the resolve endpoint.
let resolveStatus = 200;
let resolveBody: unknown = { activeAccountId: null, accounts: [] };

function installStub(): void {
  captured = { called: false, count: 0, internalSecret: null, body: undefined };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/auth/device/resolve')) {
      captured.called = true;
      captured.count += 1;
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

const SAMPLE_ACCOUNTS = {
  activeAccountId: 'u1',
  accounts: [
    {
      user: { id: 'u1', username: 'alice', name: { first: 'Alice', displayName: 'Alice' } },
      sessionId: 's1',
      accessToken: 'at1',
      expiresAt: '2999-01-01T00:00:00.000Z',
    },
    {
      user: { id: 'u2', username: 'bob', name: { first: 'Bob', displayName: 'Bob' } },
      sessionId: 's2',
      accessToken: 'at2',
      expiresAt: '2999-01-01T00:00:00.000Z',
    },
  ],
};

describe('GET /api/device-accounts', () => {
  beforeEach(() => {
    resolveStatus = 200;
    resolveBody = { activeAccountId: null, accounts: [] };
    installStub();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns an empty list and does NOT call resolve when there is no oxy_device cookie', async () => {
    const res = await app.request('/api/device-accounts');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ activeAccountId: null, accounts: [] });
    expect(captured.called).toBe(false);
  });

  it('forwards the cookie value as {deviceKey} with the X-Oxy-Internal secret and returns the accounts', async () => {
    resolveBody = SAMPLE_ACCOUNTS;
    const res = await app.request('/api/device-accounts', {
      headers: { cookie: 'oxy_device=raw-device-secret-value-1234567890' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeAccountId).toBe('u1');
    expect(body.accounts).toHaveLength(2);

    // The outbound resolve call carried the raw cookie value + the internal secret.
    expect(captured.called).toBe(true);
    expect(captured.internalSecret).toBe(INTERNAL_SECRET);
    expect(captured.body).toEqual({ deviceKey: 'raw-device-secret-value-1234567890' });
  });

  it('fails closed to an empty list when resolve returns a non-2xx', async () => {
    resolveStatus = 500;
    resolveBody = { message: 'boom' };
    const res = await app.request('/api/device-accounts', {
      headers: { cookie: 'oxy_device=raw-device-secret-value-1234567890' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
    expect(captured.called).toBe(true);
  });

  it('fails closed when the resolve body is malformed (accounts is not an array)', async () => {
    resolveBody = { activeAccountId: 'u1', accounts: 'nope' };
    const res = await app.request('/api/device-accounts', {
      headers: { cookie: 'oxy_device=raw-device-secret-value-1234567890' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ activeAccountId: null, accounts: [] });
  });

  it('never echoes the internal secret back to the client', async () => {
    resolveBody = SAMPLE_ACCOUNTS;
    const res = await app.request('/api/device-accounts', {
      headers: { cookie: 'oxy_device=raw-device-secret-value-1234567890' },
    });
    const text = await res.text();
    expect(text.includes(INTERNAL_SECRET)).toBe(false);
  });
});
