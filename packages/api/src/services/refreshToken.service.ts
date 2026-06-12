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
 *      token is dropped into an httpOnly + Secure cookie scoped to `/auth` — it
 *      is never readable from JavaScript (XSS-proof). Scoping to `/auth` (rather
 *      than just `/auth/refresh`) lets the browser also replay the cookie to
 *      `/auth/session` and `/auth/logout`, the other first-party session routes.
 *      This is backward-compatible: a cookie previously stored with
 *      `Path=/auth/refresh` keeps being sent to `/auth/refresh` (the only place
 *      the old client posts), while newly issued/rotated cookies use `Path=/auth`
 *      and reach all of `/auth/session`, `/auth/refresh`, and `/auth/logout`.
 *      No existing user is logged out by broadening the path.
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
 * Path the cookie is scoped to. Scoped to the `/auth` mount so the browser sends
 * `oxy_rt` to all of the first-party session routes — `/auth/session` (establish
 * the cookie right after login), `/auth/refresh` (rotate it), and `/auth/logout`
 * (revoke it) — while still keeping it off every other route.
 *
 * Backward-compatible: a cookie previously issued with `Path=/auth/refresh` keeps
 * being sent to `/auth/refresh` (the only route the old client posts to), so no
 * existing user is logged out by broadening the path; newly issued/rotated
 * cookies use `Path=/auth` and additionally reach `/auth/session` + `/auth/logout`.
 */
export const REFRESH_COOKIE_PATH = '/auth';
/**
 * The OLD path the cookie used before Phase 1 widened it to `/auth`. We never
 * issue at this path any more, but a mid-migration browser can still hold a
 * stale `oxy_rt` cookie scoped here. We emit an explicit deletion for this path
 * on every set/clear so the browser drops the legacy duplicate — see
 * `appendLegacyRefreshCookieDeletion`. NOTE: this is intentionally a hardcoded
 * literal, NOT `REFRESH_COOKIE_PATH` (which is now `/auth`).
 */
export const LEGACY_REFRESH_COOKIE_PATH = '/auth/refresh';

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
 * Revoke the rotation family for a presented RAW refresh token (logout via the
 * httpOnly cookie). Hashes the raw token, looks up the stored row by its
 * `tokenHash`, and — if found — revokes the whole family AND deactivates the
 * underlying session (both handled by `revokeFamily`).
 *
 * Best-effort and idempotent: an unknown/garbage token is a no-op (logout must
 * always succeed and clear the cookie regardless of what the client presents).
 * This NEVER mints, rotates, or consumes a token — it only revokes.
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

/**
 * Parse EVERY `oxy_rt` value out of a raw `Cookie` request header.
 *
 * WHY this exists: Phase 1 widened the `oxy_rt` cookie Path from `/auth/refresh`
 * to `/auth`. A mid-migration browser can therefore hold TWO `oxy_rt` cookies at
 * once — a legacy one at `Path=/auth/refresh` and a new one at `Path=/auth` —
 * and send BOTH to `/auth/refresh`. `cookie-parser` collapses duplicates and
 * exposes only the FIRST value via `req.cookies.oxy_rt`, which (per RFC 6265,
 * longer-path-first) is the legacy one — even when it is the stale/used token.
 * Reading just that one value silently logs the real user out. This helper
 * returns ALL presented values so the caller can pick the valid sibling.
 *
 * Parsing is deliberately tolerant: we split on `;`, split each part on the
 * FIRST `=` only (cookie values may legitimately contain `=`), trim the name,
 * and keep the RAW (non-URL-decoded) value. Our tokens are URL-safe base64url
 * (`[A-Za-z0-9_-]`), so decode/encode is identity and the raw value matches what
 * we hashed at issue time. Empty values are skipped; duplicates are de-duped
 * preserving first-seen order.
 */
export function parseRefreshTokenCandidates(cookieHeader: string | undefined): string[] {
  if (!cookieHeader) {
    return [];
  }

  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    if (name !== REFRESH_COOKIE_NAME) {
      continue;
    }
    const value = part.slice(eqIndex + 1).trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    candidates.push(value);
  }

  return candidates;
}

export type CandidateClassification =
  | { kind: 'valid'; rawToken: string }
  | { kind: 'used'; family: string; sessionId: string }
  | { kind: 'none' };

/**
 * Classify a list of presented raw refresh-token candidates WITHOUT consuming
 * any of them (purely a lookup — no `usedAt` mutation, no rotation).
 *
 * SECURITY RATIONALE (load-bearing — do not weaken): a browser only ever sends
 * its OWN httpOnly cookies, so multiple candidates can ONLY be the legitimate
 * user's own migration duplicates (legacy `Path=/auth/refresh` + new
 * `Path=/auth`). Picking the VALID sibling and ignoring a USED sibling is
 * therefore safe — it is the same user's two cookies, one already rotated.
 *
 * A genuine theft replay is a LONE used token with NO valid sibling among the
 * candidates: that still classifies as `'used'`, so the caller fires
 * reuse-detection (revoke family + deactivate session). We never weaken that —
 * if ANY candidate is valid `'valid'` wins first, but with no valid sibling a
 * used/revoked token is treated exactly as before: theft.
 *
 * Order of resolution:
 *   1. First VALID candidate wins → `{ kind: 'valid' }` (returned immediately).
 *   2. Else, first candidate whose stored row is used OR revoked →
 *      `{ kind: 'used' }` (revoked is bucketed with used because it means the
 *      family was already nuked, and we want reuse-detection to re-assert it).
 *   3. Else → `{ kind: 'none' }` (unknown/expired/garbage only).
 */
export async function classifyRefreshCandidates(
  rawCandidates: string[]
): Promise<CandidateClassification> {
  const now = new Date();
  let firstUsed: { family: string; sessionId: string } | null = null;

  for (const rawToken of rawCandidates) {
    const tokenHash = sha256Hex(rawToken);
    const stored = await RefreshToken.findOne({ tokenHash });
    if (!stored) {
      continue;
    }

    const isValid =
      stored.usedAt == null && stored.revokedAt == null && stored.expiresAt > now;
    if (isValid) {
      return { kind: 'valid', rawToken };
    }

    // A used OR revoked row with no valid sibling is the reuse-detection signal.
    // Remember the FIRST such row so the caller revokes the correct family.
    if (firstUsed === null && (stored.usedAt != null || stored.revokedAt != null)) {
      firstUsed = { family: stored.family, sessionId: stored.sessionId };
    }
  }

  if (firstUsed !== null) {
    return { kind: 'used', family: firstUsed.family, sessionId: firstUsed.sessionId };
  }

  return { kind: 'none' };
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
 * - `path: /auth` — the browser sends it to the first-party session routes
 *   (`/auth/session`, `/auth/refresh`, `/auth/logout`) and nowhere else.
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

/**
 * Append a deletion for the LEGACY `Path=/auth/refresh` cookie as a SECOND
 * `Set-Cookie` header so a mid-migration browser drops its stale duplicate.
 *
 * We must use `res.append` (not a second `res.cookie`) because Express keys
 * outgoing cookies by name and a second `res.cookie(oxy_rt, ...)` would
 * OVERWRITE the real `Path=/auth` cookie instead of adding a sibling header.
 * The deletion mirrors `buildRefreshCookieOptions()` exactly for domain/secure
 * (a mismatched domain/secure on a clear is silently ignored by the browser);
 * the Path is the OLD `/auth/refresh` so it targets the legacy cookie only and
 * leaves the real `/auth` cookie untouched. `Secure;` is emitted only in
 * production, matching the real cookie in local http dev.
 */
function appendLegacyRefreshCookieDeletion(res: Response): void {
  const { domain } = buildRefreshCookieOptions();
  const securePart = isProduction() ? 'Secure; ' : '';
  const legacyDelete =
    `${REFRESH_COOKIE_NAME}=; Domain=${domain}; Path=${LEGACY_REFRESH_COOKIE_PATH}; ` +
    `Max-Age=0; HttpOnly; ${securePart}SameSite=Lax`;
  res.append('Set-Cookie', legacyDelete);
}

/**
 * Set the refresh-token cookie on the response (real cookie at `Path=/auth`) and
 * ALSO append a deletion of the legacy `Path=/auth/refresh` duplicate so a
 * mid-migration browser stops sending two `oxy_rt` cookies.
 */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, buildRefreshCookieOptions());
  appendLegacyRefreshCookieDeletion(res);
}

/**
 * Clear the refresh-token cookie on BOTH paths. We emit an explicit `Max-Age=0`
 * cookie with the exact same domain/path attributes so the browser reliably
 * drops it (a mismatched domain/path on a clear is silently ignored by the
 * browser): one for the real `Path=/auth` cookie and a second, appended header
 * for the legacy `Path=/auth/refresh` duplicate.
 */
export function clearRefreshCookie(res: Response): void {
  res.cookie(REFRESH_COOKIE_NAME, '', { ...buildRefreshCookieOptions(), maxAge: 0 });
  appendLegacyRefreshCookieDeletion(res);
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
