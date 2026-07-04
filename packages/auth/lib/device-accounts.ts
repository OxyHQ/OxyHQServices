/**
 * The IdP's device-account chooser feed — shared, framework-free handler logic.
 *
 * Reads the first-party `oxy_device` cookie and forwards its raw value to the
 * API's internal `POST /auth/device/resolve` under the `X-Oxy-Internal` secret,
 * returning the resolved account set. Fail-closed to an empty list on: no
 * cookie, no configured secret, a non-2xx resolve, or a malformed body. The
 * internal secret travels ONLY in the outbound request header (never echoed);
 * the cookie value is never logged.
 *
 * Uses only web-standard `Request`/`Response`/`fetch`, so it runs identically in
 * a Cloudflare Pages Function (`functions/api/device-accounts.ts`) and in unit
 * tests — no Hono, no runtime-specific bindings.
 */

/** Env bindings this handler reads (CF Pages `ctx.env`, or test-injected). */
export interface DeviceAccountsEnv {
  OXY_API_URL?: string;
  SSO_INTERNAL_SECRET?: string;
}

const DEVICE_COOKIE_NAME = 'oxy_device';
const EMPTY = { activeAccountId: null, accounts: [] as unknown[] };

/** Extract a single cookie value from a `Cookie` header, or `null`. */
function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

export async function deviceAccountsResponse(request: Request, env: DeviceAccountsEnv): Promise<Response> {
  const apiBaseUrl = (env.OXY_API_URL || 'https://api.oxy.so').replace(/\/+$/, '');
  const ssoInternalSecret = env.SSO_INTERNAL_SECRET || '';

  const deviceKey = readCookie(request.headers.get('cookie'), DEVICE_COOKIE_NAME);
  if (!deviceKey || !ssoInternalSecret) {
    return Response.json(EMPTY);
  }

  try {
    const res = await fetch(`${apiBaseUrl}/auth/device/resolve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json',
        'X-Oxy-Internal': ssoInternalSecret,
      },
      body: JSON.stringify({ deviceKey }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return Response.json(EMPTY);
    const data = (await res.json()) as { activeAccountId?: unknown; accounts?: unknown };
    if (!data || !Array.isArray(data.accounts)) {
      return Response.json(EMPTY);
    }
    const activeAccountId = typeof data.activeAccountId === 'string' ? data.activeAccountId : null;
    // Forward the resolved shape as-is (the client strictly validates it against
    // `deviceResolveResponseSchema`).
    return Response.json({ activeAccountId, accounts: data.accounts });
  } catch {
    return Response.json(EMPTY);
  }
}
