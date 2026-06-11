/**
 * Refresh Token Service
 *
 * Pure logic for the first-party httpOnly refresh-token cookie that powers
 * secure cold-boot session persistence. Mirrors the security primitives of
 * `oauthCode.service.ts` (sha256 hash-only storage, atomic single-use claim)
 * and adds refresh-token rotation with reuse-detection.
 *
 * Lifecycle:
 *   1. `issueRefreshToken(...)` mints a cryptographically random 256-bit token
 *      (independent of the sessionId), stores ONLY its SHA-256 hash bound to a
 *      session + user + rotation `family`, and returns the raw token. The raw
 *      token is dropped into an httpOnly + Secure cookie scoped to
 *      `/auth/refresh` — it is never readable from JavaScript (XSS-proof).
 *   2. On cold boot the browser replays the cookie to `POST /auth/refresh`.
 *      `rotateRefreshToken(...)` consumes the presented token (atomic
 *      `{ usedAt: null } -> set`) and issues a NEW token in the SAME family
 *      with a fresh sliding expiry. The caller then mints a fresh access token.
 *   3. Sign-out (`revokeFamilyBySession` / `revokeAllUserFamilies`) revokes the
 *      family and clears the cookie.
 *
 * Reuse-detection = theft signal: a token presented after it was already
 * consumed (`usedAt` set), or already revoked, means the token leaked and both
 * the legitimate client and an attacker hold copies. We revoke the ENTIRE family
 * and deactivate the underlying session, forcing a fresh interactive sign-in.
 * This is the OWASP-recommended refresh-token-rotation defense.
 *
 * The raw token is a bearer credential — it is NEVER logged.
 */

import * as crypto from 'crypto';
import { Types } from 'mongoose';
import type { Response } from 'express';
import RefreshToken from '../models/RefreshToken';
import sessionService from './session.service';
import { logger } from '../utils/logger';
import { getEnvVar, isProduction } from '../config/env';
import { sha256Hex, base64UrlEncode } from './oauthCode.service';

/** Number of random bytes in a raw refresh token (256-bit). */
export const REFRESH_TOKEN_BYTES = 32;
/** Sliding lifetime of a refresh token / its cookie (30 days). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Name of the first-party httpOnly refresh-token cookie. */
export const REFRESH_COOKIE_NAME = 'oxy_rt';
/**
 * Path the cookie is scoped to. The browser only sends `oxy_rt` to
 * `POST /auth/refresh`, minimising its exposure surface. MUST match the
 * mounted route path (`/auth` mount + `/refresh` route = `/auth/refresh`).
 */
export const REFRESH_COOKIE_PATH = '/auth/refresh';

export interface IssueRefreshTokenOptions {
  sessionId: string;
  userId: Types.ObjectId | string;
  /** Reuse an existing rotation family (on rotation). New family if omitted. */
  family?: string;
  ttlMs?: number;
}

export interface IssueRefreshTokenResult {
  /** The raw token. Goes into the cookie ONLY — never persisted, never logged. */
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
 * the stored token's sessionId). Deactivating the session never throws —
 * `deactivateSession` returns a boolean and swallows its own errors — and a
 * deactivate failure must never propagate out of the revoke, so we log and
 * continue. The session may already be inactive (logout) which is fine.
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

export interface RefreshCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  domain: string;
  path: string;
  maxAge: number;
}

/**
 * Build the cookie attributes for `oxy_rt`.
 *
 * - `httpOnly: true` — unreadable from JavaScript, so an XSS payload cannot
 *   exfiltrate the refresh token.
 * - `secure: isProduction()` — always Secure in prod (HTTPS-only); relaxed in
 *   local http dev so the flow is testable without TLS.
 * - `sameSite: 'lax'` — sent on top-level navigations (cold boot) yet not on
 *   cross-site sub-requests, blunting CSRF while preserving cold-boot replay.
 * - `domain` — defaults to `oxy.so` (configurable via REFRESH_COOKIE_DOMAIN) so
 *   the cookie is shared across `*.oxy.so` subdomains.
 * - `path: /auth/refresh` — the browser only ever sends it to the refresh route.
 * - `maxAge` — express `res.cookie` takes maxAge in MILLISECONDS and converts to
 *   the `Max-Age` header (seconds) itself, so we pass the 30-day TTL in ms.
 */
export function buildRefreshCookieOptions(): RefreshCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    domain: getEnvVar('REFRESH_COOKIE_DOMAIN', 'oxy.so'),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}

/** Set the refresh-token cookie on the response. */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, buildRefreshCookieOptions());
}

/**
 * Clear the refresh-token cookie. We emit an explicit `Max-Age=0` cookie with
 * the exact same domain/path attributes so the browser reliably drops it (a
 * mismatched domain/path on a clear is silently ignored by the browser).
 */
export function clearRefreshCookie(res: Response): void {
  res.cookie(REFRESH_COOKIE_NAME, '', { ...buildRefreshCookieOptions(), maxAge: 0 });
}

/**
 * Convenience: mint a refresh token and set it as the cookie in one step. Used
 * at every session-creation site (signup / signin / fedcm). Callers wrap this in
 * a try/catch so a refresh-token failure can never break the login itself.
 */
export async function issueAndSetRefreshCookie(
  res: Response,
  sessionId: string,
  userId: Types.ObjectId | string
): Promise<void> {
  const { token } = await issueRefreshToken({ sessionId, userId });
  setRefreshCookie(res, token);
}
