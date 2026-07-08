/**
 * OAuth 2.0 Authorization Code + PKCE helpers for "Sign in with Oxy" third-party
 * sign-in.
 *
 * Third-party Relying Parties (SPAs, static sites, and native apps that are NOT
 * Oxy first-party) authenticate through the standard OAuth flow against
 * `auth.oxy.so/authorize` — never FedCM, SSO bounces, or Oxy session cookies.
 * Public clients (no secret) prove possession of the authorization code with
 * PKCE (RFC 7636, S256): the RP generates a random `code_verifier`, sends its
 * `code_challenge = BASE64URL(SHA-256(code_verifier))` on the authorize
 * redirect, and later replays the raw verifier on the token exchange.
 *
 * All cross-platform crypto (random bytes, SHA-256) is delegated to the shared
 * `@oxyhq/protocol` platform loaders — the exact primitives the rest of core's
 * crypto already uses — so these helpers run identically on web, Node, and
 * React Native. No `require()`, so the ESM build stays bundler-clean.
 */

import { isNodeJS, isReactNative, loadExpoCrypto, loadNodeCrypto, sha256 } from '@oxyhq/protocol';
import { logger } from './loggerUtils';

/** The central Oxy IdP authorization endpoint used by default. */
export const OXY_AUTHORIZE_URL = 'https://auth.oxy.so/authorize';

/** Default OAuth scope requested for a "Sign in with Oxy" third-party flow. */
export const DEFAULT_OAUTH_SCOPE = 'openid profile';

/**
 * Number of random bytes behind a PKCE `code_verifier`. 64 bytes → 86 base64url
 * characters, comfortably inside RFC 7636 §4.1's required 43–128 range.
 */
const PKCE_VERIFIER_BYTES = 64;

/** Number of random bytes behind an OAuth `state` (CSRF) token. */
const OAUTH_STATE_BYTES = 32;

/** RFC 4648 §5 base64url alphabet (URL- and filename-safe, no padding). */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A generated PKCE verifier/challenge pair. */
export interface PkcePair {
  /** The high-entropy secret replayed on the token exchange (kept client-side). */
  codeVerifier: string;
  /** `BASE64URL(SHA-256(codeVerifier))` — sent on the authorize redirect. */
  codeChallenge: string;
  /** The PKCE transformation method. Always `S256`. */
  method: 'S256';
}

/** Parameters for {@link buildOAuthAuthorizeUrl}. */
export interface BuildOAuthAuthorizeUrlParams {
  /** Authorize endpoint; defaults to {@link OXY_AUTHORIZE_URL}. */
  authorizeBaseUrl?: string;
  /** The registered `ApplicationCredential` public key (`oxy_dk_…`). */
  clientId: string;
  /** Exact registered redirect URI to return the authorization code to. */
  redirectUri: string;
  /** Requested scope; defaults to {@link DEFAULT_OAUTH_SCOPE}. */
  scope?: string;
  /** Opaque CSRF token from {@link generateOAuthState}. */
  state: string;
  /** The PKCE `codeChallenge` from {@link generatePkcePair}. */
  codeChallenge: string;
}

/**
 * Cryptographically-secure random bytes, cross-platform.
 *
 * Mirrors the platform gating the rest of core's crypto already uses:
 * `expo-crypto` on React Native, Node's built-in `crypto` on the server, and
 * the Web Crypto API in the browser (also the fallback if Node's `crypto`
 * fails to load in an unusual bundled-Node environment).
 */
async function getSecureRandomBytes(byteLength: number): Promise<Uint8Array> {
  if (isReactNative()) {
    const crypto = await loadExpoCrypto();
    return Uint8Array.from(await crypto.getRandomBytesAsync(byteLength));
  }

  if (isNodeJS()) {
    try {
      const nodeCrypto = await loadNodeCrypto();
      return Uint8Array.from(nodeCrypto.randomBytes(byteLength));
    } catch (error) {
      logger.warn(
        '[oxy.oauth] Node crypto unavailable for PKCE random bytes, falling back to Web Crypto',
        { component: 'oauthPkce' },
        error,
      );
    }
  }

  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Encode raw bytes as unpadded base64url (RFC 4648 §5). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const byte0 = bytes[i];
    const hasByte1 = i + 1 < bytes.length;
    const hasByte2 = i + 2 < bytes.length;
    const byte1 = hasByte1 ? bytes[i + 1] : 0;
    const byte2 = hasByte2 ? bytes[i + 2] : 0;

    output += BASE64URL_ALPHABET[byte0 >> 2];
    output += BASE64URL_ALPHABET[((byte0 & 0x03) << 4) | (byte1 >> 4)];
    if (hasByte1) {
      output += BASE64URL_ALPHABET[((byte1 & 0x0f) << 2) | (byte2 >> 6)];
    }
    if (hasByte2) {
      output += BASE64URL_ALPHABET[byte2 & 0x3f];
    }
  }
  return output;
}

/** Decode a lowercase-hex string into its raw bytes. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Compute the PKCE S256 `code_challenge` for a given verifier:
 * `BASE64URL(SHA-256(ASCII(codeVerifier)))` (RFC 7636 §4.2). The verifier is
 * base64url (ASCII), so its UTF-8 and ASCII byte encodings are identical.
 *
 * Reuses `@oxyhq/protocol`'s cross-platform {@link sha256} (which returns
 * lowercase hex); the digest bytes are recovered and re-encoded as base64url.
 */
export async function computeCodeChallenge(codeVerifier: string): Promise<string> {
  const digestHex = await sha256(codeVerifier);
  return bytesToBase64Url(hexToBytes(digestHex));
}

/**
 * Generate a fresh PKCE verifier/challenge pair for an OAuth authorization-code
 * flow. The verifier is 64 random bytes as base64url (86 chars, within RFC 7636
 * §4.1's 43–128 range and drawn only from the unreserved set); the challenge is
 * its S256 transform.
 */
export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier = bytesToBase64Url(await getSecureRandomBytes(PKCE_VERIFIER_BYTES));
  const codeChallenge = await computeCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge, method: 'S256' };
}

/**
 * Generate an opaque, single-use OAuth `state` token (32 random bytes as
 * base64url) for CSRF protection across the authorize redirect.
 */
export async function generateOAuthState(): Promise<string> {
  return bytesToBase64Url(await getSecureRandomBytes(OAUTH_STATE_BYTES));
}

/**
 * Build the `auth.oxy.so/authorize` redirect URL for an OAuth authorization-code
 * + PKCE (S256) flow. Built via the WHATWG `URL` API so a custom
 * `authorizeBaseUrl` that already carries a query string keeps its existing
 * params (the OAuth params are merged in, not clobbered by a naive `?` concat).
 * All values are percent-encoded by `URL.searchParams`.
 */
export function buildOAuthAuthorizeUrl(params: BuildOAuthAuthorizeUrlParams): string {
  const {
    authorizeBaseUrl = OXY_AUTHORIZE_URL,
    clientId,
    redirectUri,
    scope = DEFAULT_OAUTH_SCOPE,
    state,
    codeChallenge,
  } = params;

  const url = new URL(authorizeBaseUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scope);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

/** `sessionStorage` key for the OAuth CSRF `state` across an authorize redirect. */
export const OXY_OAUTH_STATE_STORAGE_KEY = 'oxy_oauth_state';

/** `sessionStorage` key for the PKCE `code_verifier` across an authorize redirect. */
export const OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY = 'oxy_oauth_code_verifier';

/**
 * Normalize a redirect URI to its origin. Official Oxy apps register apex
 * origins (`https://inbox.oxy.so`) — never path-qualified URLs.
 */
export function normalizeOAuthRedirectUri(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
}

/** Persist the OAuth handshake for a full-page redirect return (web only). */
export function persistOAuthHandshake(state: string, codeVerifier: string): boolean {
  const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  try {
    if (!store) throw new Error('sessionStorage is unavailable');
    store.setItem(OXY_OAUTH_STATE_STORAGE_KEY, state);
    store.setItem(OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY, codeVerifier);
    return true;
  } catch (error) {
    logger.warn(
      'Could not persist OAuth handshake to sessionStorage',
      { component: 'oauthPkce' },
      error,
    );
    return false;
  }
}

/** Read the persisted OAuth handshake, or `null` when absent. */
export function readOAuthHandshake(): { state: string; codeVerifier: string } | null {
  const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (!store) return null;
  const state = store.getItem(OXY_OAUTH_STATE_STORAGE_KEY);
  const codeVerifier = store.getItem(OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY);
  if (!state || !codeVerifier) return null;
  return { state, codeVerifier };
}

/** Drop persisted OAuth handshake keys after a successful or aborted return. */
export function clearOAuthHandshake(): void {
  const store = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  try {
    store?.removeItem(OXY_OAUTH_STATE_STORAGE_KEY);
    store?.removeItem(OXY_OAUTH_CODE_VERIFIER_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}
