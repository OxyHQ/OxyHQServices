/**
 * Device-boot return-fragment consumption (web cross-apex hop).
 *
 * After the top-level `GET /auth/device/bootstrap` hop, the API 303s back to the
 * RP with a `#oxy_boot=<base64url(JSON)>` fragment. This module parses and
 * consumes it: it strips the fragment from the URL FIRST (so the opaque
 * deviceToken / code never linger in history or a `Referer`), verifies the
 * echoed CSRF `state` against the value the initiator stashed in
 * `sessionStorage`, persists the deviceToken, and — when a session resolved —
 * exchanges the single-use `code` for a token bundle.
 *
 * Pure/injectable: all DOM access (hash, `history.replaceState`,
 * `sessionStorage`) is passed in as callbacks so the logic is unit-testable
 * under the jest `node` environment and reusable by `coldBootV2`.
 *
 * ESM-safe (no `require()`).
 */
import {
  deviceBootFragmentSchema,
  resolveUserId,
  safeParseContract,
  type AuthTokenBundle,
  type DeviceBootFragment,
  type DeviceBootReason,
} from '@oxyhq/contracts';
import type { AuthStateStore, PersistedAuthState } from '../session/authStateStore';

/** The `#oxy_boot=` fragment parameter name the API appends on the return hop. */
export const BOOT_FRAGMENT_PARAM = 'oxy_boot';

/**
 * `sessionStorage` key under which the bootstrap-hop initiator stashes the
 * 128-bit CSRF `state` before navigating, and which the return step reads back
 * (single-use).
 */
export const BOOT_STATE_SESSION_KEY = 'oxy.boot.state';

/**
 * Decode a base64url string to UTF-8 text, or `null` on any malformed input.
 * Handles both web (`atob` + `TextDecoder`) and Node (`Buffer`) without a
 * `require()` — the ESM build stays clean.
 */
function base64UrlDecode(input: string): string | null {
  try {
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
      b64 += '=';
    }
    if (typeof atob === 'function') {
      const binary = atob(b64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder().decode(bytes);
      }
      return binary;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

/** True when a location hash carries the `oxy_boot` return fragment. */
export function hashHasBootFragment(hash: string): boolean {
  return new RegExp(`(^|[#&])${BOOT_FRAGMENT_PARAM}=`).test(hash);
}

/**
 * Extract + decode + validate the `oxy_boot` fragment from a location hash.
 * Returns the parsed {@link DeviceBootFragment}, or `null` when the parameter
 * is absent, not valid base64url, not JSON, or fails the contract schema.
 */
export function parseDeviceBootFragment(hash: string): DeviceBootFragment | null {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(withoutHash);
  const raw = params.get(BOOT_FRAGMENT_PARAM);
  if (!raw) {
    return null;
  }
  const json = base64UrlDecode(raw);
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return safeParseContract(deviceBootFragmentSchema, parsed);
}

/** The winning session shape a cold-boot step reports. */
export interface DeviceBootSession {
  sessionId: string;
  userId: string;
  accessToken: string;
}

/** Outcome of {@link consumeDeviceBootReturn}. */
export type DeviceBootReturnOutcome =
  | { kind: 'none' }
  | { kind: 'state-mismatch' }
  | { kind: 'session'; session: DeviceBootSession }
  | { kind: 'no-session'; reason: DeviceBootReason };

export interface ConsumeDeviceBootReturnDeps {
  /** The current location hash (e.g. `window.location.hash`). */
  hash: string;
  /** Strip the fragment from the URL (e.g. `history.replaceState`). */
  stripFragment: () => void;
  /** Read the expected CSRF state (e.g. `sessionStorage.getItem(BOOT_STATE_SESSION_KEY)`). */
  readExpectedState: () => string | null;
  /** Clear the expected CSRF state (single-use). */
  clearExpectedState: () => void;
  store: AuthStateStore;
  /** Exchange the single-use boot code for a token bundle (`oxy.exchangeBootCode`). */
  exchangeBootCode: (code: string) => Promise<AuthTokenBundle>;
  /** Plant the freshly-minted access token on the owner client (`oxy.setTokens`). */
  plantAccessToken: (accessToken: string) => void;
}

/**
 * Consume the device-boot return fragment.
 *
 * Order is load-bearing:
 *   1. If no fragment is present, return `none` (no URL mutation).
 *   2. STRIP the fragment from the URL immediately — before validation or any
 *      network — so the deviceToken/code never persist in history/referrer.
 *   3. Verify the echoed `state` against the stashed (single-use) value; a
 *      mismatch returns `state-mismatch` without persisting or exchanging.
 *   4. Persist the deviceToken (survives sign-out).
 *   5. If a session resolved (`reason:'session'` + `code`), exchange the code,
 *      persist the rotated session, plant the token, and return `session`.
 *      Otherwise return `no-session` with the reason.
 */
export async function consumeDeviceBootReturn(
  deps: ConsumeDeviceBootReturnDeps,
): Promise<DeviceBootReturnOutcome> {
  if (!hashHasBootFragment(deps.hash)) {
    return { kind: 'none' };
  }

  // Strip FIRST — even a forged/malformed fragment must not linger in the URL.
  deps.stripFragment();

  const fragment = parseDeviceBootFragment(deps.hash);
  if (!fragment) {
    return { kind: 'none' };
  }

  const expected = deps.readExpectedState();
  deps.clearExpectedState();
  if (!expected || expected !== fragment.state) {
    return { kind: 'state-mismatch' };
  }

  await deps.store.saveDeviceToken(fragment.deviceToken);

  // `code` is guaranteed present on the `session` arm (the contract's
  // discriminated union requires it; a session fragment without a code fails to
  // parse and never reaches here).
  if (fragment.reason === 'session') {
    try {
      const bundle = await deps.exchangeBootCode(fragment.code);
      const userId = resolveUserId(bundle.user);
      if (!userId) {
        return { kind: 'no-session', reason: 'no_session' };
      }
      const next: PersistedAuthState = {
        sessionId: bundle.sessionId,
        refreshToken: bundle.refreshToken,
        userId,
        deviceToken: fragment.deviceToken,
        accessToken: bundle.accessToken,
        expiresAt: bundle.expiresAt,
      };
      // Phase 2c: the cookie-bootstrap bundle may carry a rotating `deviceSecret`
      // but NOT a deviceId. Persist the secret, and carry any prior deviceId
      // forward (from a deviceId-bearing login lane) so the pair stays usable by
      // the zero-cookie mint — an overwrite here must not orphan the mint lane.
      const prior = await deps.store.load();
      if (prior?.deviceId) {
        next.deviceId = prior.deviceId;
      }
      // Prefer the bundle's secret (the server just rotated onto it); keep the
      // prior one when the bundle omits it so a cookie-lane boot can never orphan
      // a still-valid secret captured by an earlier login lane.
      const carriedSecret = bundle.deviceSecret ?? prior?.deviceSecret;
      if (carriedSecret) {
        next.deviceSecret = carriedSecret;
      }
      await deps.store.save(next);
      deps.plantAccessToken(bundle.accessToken);
      return {
        kind: 'session',
        session: { sessionId: bundle.sessionId, userId, accessToken: bundle.accessToken },
      };
    } catch {
      // The code burned/expired between hop and exchange — resolve signed-out
      // rather than throwing (the once-ever hop already fired; do not retry).
      return { kind: 'no-session', reason: 'no_session' };
    }
  }

  return { kind: 'no-session', reason: fragment.reason };
}
