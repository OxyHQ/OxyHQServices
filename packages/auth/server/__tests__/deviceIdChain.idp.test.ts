/**
 * Central deviceId propagation into minted FedCM assertions.
 *
 * `/session/validate/:id` (the API's cookie-less session resolver) can now
 * return a top-level `deviceId` alongside `{ valid, user }`. This test
 * verifies the IdP worker (`mintSessionForClient`, driven here via
 * `GET /auth/silent`) chains that `deviceId` into the `id_token` it POSTs to
 * `/fedcm/exchange` — so the API can stamp the SAME central device id onto
 * the freshly-minted cross-apex session (cross-domain device unification).
 *
 * Backward-compat: when `/session/validate` omits `deviceId` (an older API
 * deployment), the minted `id_token` must carry NO `deviceId` claim at all.
 *
 * Run with `bun test`. Mirrors the stubbing pattern in
 * `server/__tests__/fedcm.idp.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';

const RP_ORIGIN = 'https://accounts.oxy.so';
const TEST_SECRET = 'test-fedcm-secret';
const TEST_USER_ID = '507f1f77bcf86cd799439011';
const STUB_SERVER_NONCE = 'server-minted-nonce-xyz';
const STUB_ACCESS_TOKEN = 'oxy-access-token-abc';
const STUB_EXCHANGE_SESSION_ID = 'sess_exchanged_999';
const SESSION_COOKIE = 'fedcm_session=sess_abc';

// Configure env BEFORE importing the server module (it reads env at load).
process.env.FEDCM_TOKEN_SECRET = TEST_SECRET;
process.env.FEDCM_ISSUER = 'https://auth.oxy.so';
process.env.OXY_API_URL = 'https://api.oxy.so';
process.env.SSO_INTERNAL_SECRET = 'test-sso-internal-secret-32-chars-long!!';
process.env.NODE_ENV = 'test';

const realFetch = globalThis.fetch;

// Mutable so individual tests can flip whether `/session/validate` reports a
// central deviceId.
let stubbedDeviceId: string | undefined = 'dev-central-xyz';

// Captures the id_token POSTed to /fedcm/exchange so tests can decode its
// claims.
let capturedExchangeIdToken: string | undefined;

function installApiStub(): void {
  capturedExchangeIdToken = undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/session/validate/')) {
      return new Response(
        JSON.stringify({
          valid: true,
          user: { id: TEST_USER_ID, username: 'tester', email: 'tester@oxy.so', name: { full: 'Test User' } },
          ...(stubbedDeviceId ? { deviceId: stubbedDeviceId } : {}),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/fedcm/clients/approved')) {
      return new Response(
        JSON.stringify({ success: true, clients: [RP_ORIGIN] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/fedcm/grants/')) {
      return new Response(
        JSON.stringify({ origins: [RP_ORIGIN] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/fedcm/nonce')) {
      return new Response(
        JSON.stringify({ nonce: STUB_SERVER_NONCE, expiresAt: new Date(Date.now() + 60000).toISOString() }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('/fedcm/exchange')) {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      try {
        capturedExchangeIdToken = (JSON.parse(bodyText) as { id_token?: string }).id_token;
      } catch {
        capturedExchangeIdToken = undefined;
      }
      return new Response(
        JSON.stringify({
          sessionId: STUB_EXCHANGE_SESSION_ID,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          accessToken: STUB_ACCESS_TOKEN,
          user: {
            id: TEST_USER_ID,
            username: 'tester',
            email: 'tester@oxy.so',
            name: { first: 'Test', last: 'User', full: 'Test User', displayName: 'Test User' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { request: (path: string, init?: RequestInit) => Promise<Response> };

beforeAll(async () => {
  installApiStub();
  const mod = await import('../index');
  app = mod.app as typeof app;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  stubbedDeviceId = 'dev-central-xyz';
  installApiStub();
});

function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const [, payloadB64] = idToken.split('.');
  const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
}

describe('mintSessionForClient chains central deviceId (via GET /auth/silent)', () => {
  it('embeds the deviceId from /session/validate into the id_token POSTed to /fedcm/exchange', async () => {
    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-nonce-device`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);

    expect(typeof capturedExchangeIdToken).toBe('string');
    const payload = decodeIdTokenPayload(capturedExchangeIdToken as string);
    expect(payload.deviceId).toBe('dev-central-xyz');
  });

  it('omits the deviceId claim entirely when /session/validate returns no deviceId (backward-compat)', async () => {
    stubbedDeviceId = undefined;
    installApiStub();

    const res = await app.request(
      `/auth/silent?client_id=${encodeURIComponent(RP_ORIGIN)}&nonce=rp-nonce-no-device`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.status).toBe(200);

    expect(typeof capturedExchangeIdToken).toBe('string');
    const payload = decodeIdTokenPayload(capturedExchangeIdToken as string);
    expect('deviceId' in payload).toBe(false);
  });
});
