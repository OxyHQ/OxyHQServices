/**
 * OAuth2 Authorization Code Service
 *
 * Pure logic for minting and exchanging OAuth2 authorization codes with
 * PKCE — extracted from the route handler so it can be tested in isolation
 * without spinning up Express.
 *
 * Lifecycle of a code:
 *   1. `issueCode(...)` mints a random 256-bit code, stores its SHA-256
 *      hash (never the raw value) bound to user / app / redirectUri and
 *      optional PKCE challenge.
 *   2. `exchangeCode(...)` looks the code up by hash, verifies all
 *      bindings, claims the code single-use via atomic findOneAndUpdate
 *      ({ usedAt: null } -> set), and returns the resolved user id.
 *
 * All credential equality checks use `crypto.timingSafeEqual` to
 * eliminate timing leaks on code-binding mismatches.
 */

import * as crypto from 'crypto';
import { Types } from 'mongoose';
import AuthCode, { IAuthCode } from '../models/AuthCode';

export const AUTH_CODE_TTL_MS = 60 * 1000;
export const AUTH_CODE_BYTES = 32;

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** Collapse `https://app.example/` → `https://app.example` for OAuth binding. */
export function canonicalizeOAuthRedirectUri(redirectUri: string): string {
  try {
    const parsed = new URL(redirectUri);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return redirectUri;
    }
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return parsed.origin;
    }
    return redirectUri;
  } catch {
    return redirectUri;
  }
}

export interface IssueCodeOptions {
  userId: Types.ObjectId | string;
  appId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  scopes?: string[];
  ttlMs?: number;
}

export interface IssueCodeResult {
  code: string;
  expiresAt: Date;
}

export async function issueAuthCode(options: IssueCodeOptions): Promise<IssueCodeResult> {
  const ttlMs = options.ttlMs ?? AUTH_CODE_TTL_MS;
  const rawCode = base64UrlEncode(crypto.randomBytes(AUTH_CODE_BYTES));
  const codeHash = sha256Hex(rawCode);
  const expiresAt = new Date(Date.now() + ttlMs);

  await AuthCode.create({
    codeHash,
    userId: options.userId,
    appId: options.appId,
    redirectUri: canonicalizeOAuthRedirectUri(options.redirectUri),
    codeChallenge: options.codeChallenge ?? null,
    codeChallengeMethod: options.codeChallenge ? 'S256' : null,
    scopes: options.scopes ?? [],
    expiresAt,
  });

  return { code: rawCode, expiresAt };
}

export type ExchangeOutcome =
  | { ok: true; code: IAuthCode }
  | { ok: false; reason: 'invalid_grant' | 'invalid_client' };

export interface ExchangeCodeOptions {
  rawCode: string;
  appId: string;
  redirectUri: string;
  /** Confidential clients pass `clientSecret`. Verified outside this fn. */
  clientSecretProvided?: boolean;
  /** Public clients pass `codeVerifier`. */
  codeVerifier?: string;
}

/**
 * Verify a redeemed code against its issuance bindings. Single-use is
 * enforced via the atomic `findOneAndUpdate({usedAt: null})` claim — two
 * concurrent exchanges cannot both succeed.
 *
 * This function does NOT check the client secret itself (that's the
 * caller's responsibility — they have the `app.apiSecret` in scope). It
 * only verifies that EITHER a secret was supplied (confidential client)
 * OR the PKCE verifier matches the stored challenge.
 */
export async function exchangeAuthCode(options: ExchangeCodeOptions): Promise<ExchangeOutcome> {
  const codeHash = sha256Hex(options.rawCode);
  const stored = await AuthCode.findOne({ codeHash });

  if (!stored) {
    return { ok: false, reason: 'invalid_grant' };
  }

  if (stored.usedAt) {
    // Replay of an already-redeemed code. RFC 6749 §10.5 RECOMMENDS the
    // server revoke any tokens previously issued from this code; that
    // responsibility lives with the route handler since it has access
    // to the session it minted.
    return { ok: false, reason: 'invalid_grant' };
  }

  if (stored.expiresAt < new Date()) {
    return { ok: false, reason: 'invalid_grant' };
  }

  if (stored.appId !== options.appId) {
    return { ok: false, reason: 'invalid_grant' };
  }

  if (
    !timingSafeStringEqual(
      canonicalizeOAuthRedirectUri(stored.redirectUri),
      canonicalizeOAuthRedirectUri(options.redirectUri),
    )
  ) {
    return { ok: false, reason: 'invalid_grant' };
  }

  if (stored.codeChallenge) {
    if (!options.codeVerifier) {
      return { ok: false, reason: 'invalid_grant' };
    }
    const computed = base64UrlEncode(
      crypto.createHash('sha256').update(options.codeVerifier).digest()
    );
    if (!timingSafeStringEqual(stored.codeChallenge, computed)) {
      return { ok: false, reason: 'invalid_grant' };
    }
  } else if (!options.clientSecretProvided) {
    // No PKCE was bound at issuance time AND the caller didn't present a
    // confidential client secret — refuse the exchange.
    return { ok: false, reason: 'invalid_client' };
  }

  // Atomic single-use claim — if a concurrent request races us, only the
  // first transitions usedAt from null and the loser sees `null` back.
  const now = new Date();
  const claimed = await AuthCode.findOneAndUpdate(
    { _id: stored._id, usedAt: null },
    { $set: { usedAt: now } },
    { new: true }
  );
  if (!claimed) {
    return { ok: false, reason: 'invalid_grant' };
  }

  return { ok: true, code: claimed };
}
