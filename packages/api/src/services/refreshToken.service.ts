/**
 * Refresh Token Service — rotating single-use refresh-token FAMILIES.
 *
 * The persisted-refresh lane for the device-first auth surface: a login / device
 * exchange mints a rotating refresh token whose raw value the client stores
 * (web localStorage / native SecureStore) and rotates via `POST /auth/refresh-token`
 * (see `deviceAuth.ts`). Only the SHA-256 hash of the token is stored, bound to a
 * session + user + rotation `family`.
 *
 * Lifecycle:
 *   1. `issueRefreshToken(...)` mints a 256-bit CSPRNG token (independent of the
 *      sessionId), stores its hash, and returns the raw token.
 *   2. `rotateRefreshToken(...)` consumes the presented token (atomic
 *      `{ usedAt: null } -> set`) and issues a NEW token in the SAME family with a
 *      fresh sliding expiry.
 *   3. Sign-out / signout-cascade revokes the family
 *      (`revokeFamily*` / `revokeAllFamiliesBySession` / `revokeAllUserFamilies`).
 *
 * Reuse-detection = theft signal: a token presented after it was already consumed
 * (`usedAt` set) or already revoked means the token leaked — we revoke the ENTIRE
 * family and deactivate the underlying session (OWASP refresh-token-rotation
 * defense).
 *
 * The raw token is a bearer credential — it is NEVER logged.
 *
 * NOTE: the legacy first-party `oxy_rt_${authuser}` cookie machinery (indexed
 * multi-account cookies, slot allocation, `issueAndSetRefreshCookie`, etc.) was
 * removed with the `/auth/refresh` + `/auth/refresh-all` + `/auth/session`
 * endpoints. This file is now ONLY the storage-backed rotating family.
 */

import * as crypto from 'crypto';
import { Types } from 'mongoose';
import RefreshToken from '../models/RefreshToken';
import sessionService from './session.service';
import { logger } from '../utils/logger';
import { sha256Hex, base64UrlEncode } from './oauthCode.service';

/** Number of random bytes in a raw refresh token (256-bit). */
export const REFRESH_TOKEN_BYTES = 32;
/** Sliding lifetime of a refresh token (30 days). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssueRefreshTokenOptions {
  sessionId: string;
  userId: Types.ObjectId | string;
  /** Reuse an existing rotation family (on rotation). New family if omitted. */
  family?: string;
  ttlMs?: number;
}

export interface IssueRefreshTokenResult {
  /** The raw token. Returned to the caller only — never persisted, never logged. */
  token: string;
  family: string;
  expiresAt: Date;
}

/**
 * Mint a new refresh token. The raw token is independent random bytes — it is
 * NOT derived from the sessionId, so possession of a sessionId never lets an
 * attacker forge a refresh token.
 */
export async function issueRefreshToken(
  options: IssueRefreshTokenOptions
): Promise<IssueRefreshTokenResult> {
  const ttlMs = options.ttlMs ?? REFRESH_TOKEN_TTL_MS;
  const rawToken = base64UrlEncode(crypto.randomBytes(REFRESH_TOKEN_BYTES));
  const tokenHash = sha256Hex(rawToken);
  const family = options.family ?? base64UrlEncode(crypto.randomBytes(16));
  const expiresAt = new Date(Date.now() + ttlMs);

  await RefreshToken.create({
    tokenHash,
    sessionId: options.sessionId,
    userId: options.userId,
    family,
    expiresAt,
  });

  return { token: rawToken, family, expiresAt };
}

export type RotateOutcome =
  | { ok: true; token: string; family: string; expiresAt: Date; sessionId: string; userId: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'reuse_detected' };

/**
 * Revoke every token in a rotation family and deactivate the underlying session.
 *
 * Called from logout (with the known sessionId) and from reuse-detection (with
 * the stored token's sessionId). A deactivate failure must never propagate out of
 * the revoke, so we log and continue.
 */
export async function revokeFamily(family: string, sessionId?: string): Promise<void> {
  await RefreshToken.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  if (sessionId) {
    try {
      await sessionService.deactivateSession(sessionId);
    } catch (error) {
      logger.error(
        '[RefreshToken] Failed to deactivate session during family revoke',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'RefreshTokenService', method: 'revokeFamily' }
      );
    }
  }
}

/**
 * Revoke the rotation family associated with a session (logout of one session).
 * Finds the most recent token for the session and revokes its whole family.
 */
export async function revokeFamilyBySession(sessionId: string): Promise<void> {
  const token = await RefreshToken.findOne({ sessionId }).sort({ createdAt: -1 });
  if (token) {
    await revokeFamily(token.family, sessionId);
  }
}

/**
 * Revoke every refresh-token family belonging to a user (logout-all).
 */
export async function revokeAllUserFamilies(userId: string): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

/**
 * Revoke EVERY un-revoked refresh token bound to a session — ALL rotation
 * families, not just the latest. Used by the device signout cascade: when a
 * device signs an account out, `deactivateSession` alone leaves the persisted
 * rotating refresh family live, so a stored token could still mint fresh access
 * tokens. This closes that gap. Does NOT deactivate the session (the caller
 * already did) and never mints/rotates — pure revoke, idempotent.
 */
export async function revokeAllFamiliesBySession(sessionId: string): Promise<void> {
  await RefreshToken.updateMany(
    { sessionId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

/**
 * Revoke the rotation family for a presented RAW refresh token (logout). Hashes
 * the raw token, looks up the stored row, and — if found — revokes the whole
 * family AND deactivates the underlying session (both via `revokeFamily`).
 *
 * Best-effort and idempotent: an unknown/garbage token is a no-op (logout must
 * always succeed). NEVER mints/rotates/consumes — only revokes.
 */
export async function revokeFamilyByRawToken(rawToken: string): Promise<void> {
  const tokenHash = sha256Hex(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash });
  if (stored) {
    await revokeFamily(stored.family, stored.sessionId);
  }
}

/**
 * Rotate a presented refresh token.
 *
 * Single-use + reuse-detection: the atomic `findOneAndUpdate({ usedAt: null,
 * revokedAt: null })` claim guarantees only one caller can consume a given
 * token. A presented token whose `usedAt` is already set — or whose claim loses
 * the race — is treated as theft: the entire family is revoked and the session
 * is deactivated.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateOutcome> {
  const tokenHash = sha256Hex(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored) {
    return { ok: false, reason: 'not_found' };
  }

  // Already revoked → the family was nuked (prior theft or logout). Re-assert
  // the revoke (idempotent) and refuse.
  if (stored.revokedAt) {
    await revokeFamily(stored.family, stored.sessionId);
    return { ok: false, reason: 'revoked' };
  }

  // Already consumed → REUSE DETECTED. This token was rotated away earlier and
  // is being replayed: a theft signal. Burn the whole family + session.
  if (stored.usedAt) {
    await revokeFamily(stored.family, stored.sessionId);
    return { ok: false, reason: 'reuse_detected' };
  }

  if (stored.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  // Atomic single-use claim. If a concurrent request beats us, `claimed` is null
  // and we treat the loss as a reuse race → revoke the family.
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, usedAt: null, revokedAt: null },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    await revokeFamily(stored.family, stored.sessionId);
    return { ok: false, reason: 'reuse_detected' };
  }

  // Issue the next token in the same family with a fresh sliding expiry.
  const next = await issueRefreshToken({
    sessionId: claimed.sessionId,
    userId: claimed.userId,
    family: claimed.family,
  });

  return {
    ok: true,
    token: next.token,
    family: next.family,
    expiresAt: next.expiresAt,
    sessionId: claimed.sessionId,
    userId: claimed.userId.toString(),
  };
}
