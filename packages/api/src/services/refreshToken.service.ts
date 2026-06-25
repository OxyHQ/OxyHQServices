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
 *      is never readable from JavaScript (XSS-proof). Scoping to `/auth` lets
 *      the browser replay the indexed cookie to `/auth/session`,
 *      `/auth/refresh`, and `/auth/logout`.
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
import Session from '../models/Session';
import sessionService from './session.service';
import { logger } from '../utils/logger';
import { getEnvVar, isProduction } from '../config/env';
import { sha256Hex, base64UrlEncode } from './oauthCode.service';

/** Number of random bytes in a raw refresh token (256-bit). */
export const REFRESH_TOKEN_BYTES = 32;
/** Sliding lifetime of a refresh token / its cookie (30 days). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Prefix of first-party httpOnly refresh-token cookies. */
export const REFRESH_COOKIE_NAME = 'oxy_rt';
/**
 * Indexed multi-account cookie names: `oxy_rt_${authuser}` where `authuser` is
 * a non-negative integer device-local index (Google-style multi-account).
 * The regex anchors both ends and only matches DIGIT sequences, so suffixes
 * like `oxy_rt_foo` or `oxy_rt_-1` are explicitly rejected.
 */
export const REFRESH_COOKIE_NAME_RE = /^oxy_rt_(\d+)$/;
/**
 * Hard upper bound on simultaneously-signed-in accounts per device. Matches
 * Google's own 10-account device limit. The 11th sign-in evicts the
 * least-recently-used existing account (see issueAndSetRefreshCookie).
 */
export const MAX_DEVICE_ACCOUNTS = 10;
/**
 * Path the cookie is scoped to. Scoped to the `/auth` mount so the browser sends
 * `oxy_rt_${authuser}` to all of the first-party session routes — `/auth/session`
 * (establish the cookie right after login), `/auth/refresh` (rotate it), and `/auth/logout`
 * (revoke it) — while still keeping it off every other route.
 */
export const REFRESH_COOKIE_PATH = '/auth';

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

export type CandidateClassification =
  | { kind: 'valid'; rawToken: string }
  | { kind: 'used'; family: string; sessionId: string }
  | { kind: 'none' };

/**
 * Classify a list of presented raw refresh-token candidates WITHOUT consuming
 * any of them (purely a lookup — no `usedAt` mutation, no rotation).
 *
 * SECURITY RATIONALE (load-bearing — do not weaken): a browser only ever sends
 * its OWN httpOnly cookies, so multiple candidates for one indexed slot can
 * only be that device's own duplicate values. Picking the VALID sibling and
 * ignoring a USED sibling is safe — it is the same user's slot, one already
 * rotated.
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
 * Build the cookie name for a given device-local `authuser` index.
 *
 * Returns `oxy_rt_${authuser}` when `authuser` is a non-negative integer
 * within the device's account budget. Throws `RangeError` for anything else —
 * we never want to silently coerce a bogus index to a different account or
 * widen the per-device cap by minting `oxy_rt_999`.
 */
export function refreshCookieName(authuser: number): string {
  if (!Number.isInteger(authuser) || authuser < 0 || authuser >= MAX_DEVICE_ACCOUNTS) {
    throw new RangeError(
      `authuser must be an integer in [0, ${MAX_DEVICE_ACCOUNTS}); received ${String(authuser)}`
    );
  }
  return `oxy_rt_${authuser}`;
}

/**
 * Key used by the multi-account parser. Only indexed slots are valid.
 */
export type RefreshCookieIndex = number;

/**
 * Parse EVERY indexed refresh-token cookie out of a raw `Cookie` header, grouped
 * by device-local `authuser` index.
 *
 * We split on `;`, split each part on the FIRST `=` only (cookie values may
 * contain `=`), trim the name, and keep the RAW (non-URL-decoded) value because
 * our tokens are URL-safe base64url. The Cookie header can carry MULTIPLE values for the same
 * name, so each bucket is an array. We deliberately IGNORE:
 *   - Any cookie name that doesn't match `^oxy_rt_(\d+)$`
 *     (so `oxy_rt_foo`, `oxy_rt_-1`, `oxy_rt_garbage` never enter the result).
 *   - Indexed cookies whose authuser is `>= MAX_DEVICE_ACCOUNTS` (defence
 *     against an attacker stuffing `oxy_rt_999` into a cookie header).
 *   - Empty values.
 */
export function parseAllRefreshCookies(
  cookieHeader: string | undefined
): Map<RefreshCookieIndex, string[]> {
  const buckets = new Map<RefreshCookieIndex, string[]>();
  if (!cookieHeader) {
    return buckets;
  }

  const seenPerKey = new Map<RefreshCookieIndex, Set<string>>();

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (value.length === 0) {
      continue;
    }

    let key: RefreshCookieIndex | null = null;
    const match = REFRESH_COOKIE_NAME_RE.exec(name);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed < MAX_DEVICE_ACCOUNTS) {
        key = parsed;
      }
    }

    if (key === null) {
      continue;
    }

    let seen = seenPerKey.get(key);
    if (!seen) {
      seen = new Set();
      seenPerKey.set(key, seen);
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(value);
  }

  return buckets;
}

/**
 * Resolve a single `authuser` bucket of candidates to either the valid raw
 * token to rotate, or a theft signal. Wraps `classifyRefreshCandidates` so the
 * caller does not have to know the raw-token lookup details: valid wins;
 * otherwise a lone used/revoked candidate
 * fires reuse-detection.
 */
export async function selectActiveCandidate(
  rawList: string[]
): Promise<CandidateClassification> {
  return classifyRefreshCandidates(rawList);
}

/**
 * Build the cookie attributes for indexed refresh-token cookies.
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
 * Set a refresh-token cookie on the response.
 *
 * Writes the indexed `oxy_rt_${authuser}` cookie at `Path=/auth` with HttpOnly,
 * Secure, SameSite=Lax, Domain, and Max-Age.
 *
 * `authuser` is validated by `refreshCookieName`, which throws `RangeError`
 * for anything outside `[0, MAX_DEVICE_ACCOUNTS)`.
 */
export function setRefreshCookie(
  res: Response,
  token: string,
  opts: { authuser: number }
): void {
  const name = refreshCookieName(opts.authuser);
  res.cookie(name, token, buildRefreshCookieOptions());
}

/**
 * Clear ONE refresh-token cookie.
 *
 * Clears only `oxy_rt_${authuser}` at `Path=/auth`. Sibling indexed cookies
 * (other signed-in accounts) are untouched.
 */
export function clearRefreshCookie(
  res: Response,
  opts: { authuser: number }
): void {
  const name = refreshCookieName(opts.authuser);
  res.cookie(name, '', { ...buildRefreshCookieOptions(), maxAge: 0 });
}

/**
 * Clear EVERY refresh-token cookie currently presented in `cookieHeader`.
 *
 * Used by the broad `/auth/logout` path (no `?authuser=` specified) so that a
 * device with multiple signed-in accounts ends up with zero accounts. Each
 * presented cookie name gets its own explicit `Max-Age=0` Set-Cookie header so
 * the browser reliably drops it.
 *
 * No-op when no recognised refresh cookies were presented; the caller is still
 * expected to return a 200 (logout is idempotent).
 */
export function clearAllRefreshCookies(
  res: Response,
  cookieHeader: string | undefined
): void {
  const buckets = parseAllRefreshCookies(cookieHeader);
  if (buckets.size === 0) {
    return;
  }

  const opts = { ...buildRefreshCookieOptions(), maxAge: 0 };

  for (const key of buckets.keys()) {
    res.cookie(refreshCookieName(key), '', opts);
  }
}

/**
 * Result of minting + setting a refresh cookie. `authuser` is the integer
 * device-local slot we wrote into.
 */
export interface IssueAndSetRefreshCookieResult {
  accessToken: string;
  expiresAt: Date;
  authuser: number;
}

/**
 * Options for `issueAndSetRefreshCookie`.
 *
 * - `authuser`: force-write this exact slot (the caller already knows the
 *   index, e.g. after `/auth/refresh-all` rebuilt the device's view).
 * - `cookieHeader`: when present and `authuser` is omitted, the helper inspects
 *   the device's currently-presented cookies, maps each occupied slot to its
 *   `userId`, and reuses an existing slot for the same user OR picks the next
 *   free integer in `[0, MAX_DEVICE_ACCOUNTS)`. If all slots are occupied by
 *   OTHER users, the LEAST-RECENTLY-USED slot is evicted (its family revoked)
 *   and reused — same shape as Google's 10-account cap.
 * - `userIdToAuthuser`: optional pre-computed `userId -> authuser` map (lets
 *   tests skip the DB roundtrip).
 */
export interface IssueAndSetRefreshCookieOptions {
  authuser?: number;
  cookieHeader?: string;
  userIdToAuthuser?: Map<string, number>;
}

/**
 * Resolve every `userId` that already owns a slot in the device's presented
 * cookies. For each occupied slot we pick the FIRST stored candidate (regardless
 * of usedAt/revokedAt — we only need the userId binding, never to consume the
 * token). Used to detect "this account already has a slot, reuse it".
 */
async function buildUserIdToAuthuserMap(
  cookieHeader: string | undefined
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!cookieHeader) {
    return result;
  }

  const buckets = parseAllRefreshCookies(cookieHeader);
  for (const [key, rawList] of buckets.entries()) {
    if (rawList.length === 0) {
      continue;
    }

    let matchedUserId: string | undefined;
    for (const raw of rawList) {
      const tokenHash = sha256Hex(raw);
      const row = await RefreshToken.findOne({ tokenHash });
      if (row && row.userId) {
        matchedUserId = row.userId.toString();
        break;
      }
    }
    if (matchedUserId && !result.has(matchedUserId)) {
      result.set(matchedUserId, key);
    }
  }
  return result;
}

/**
 * Resolve the least-recently-used occupied `authuser` slot among the device's
 * presented cookies by looking up each slot's bound Session and comparing
 * `deviceInfo.lastActive`. Returns `null` when no slot could be resolved.
 *
 * Slots whose sessionId cannot be resolved (deleted Session, no surviving
 * RefreshToken row) are preferred for eviction — they are already orphaned.
 */
async function pickLruAuthuser(
  cookieHeader: string | undefined
): Promise<{ authuser: number; family: string; sessionId: string } | null> {
  if (!cookieHeader) {
    return null;
  }
  const buckets = parseAllRefreshCookies(cookieHeader);

  let worst: { authuser: number; family: string; sessionId: string; lastActive: number } | null = null;
  let orphan: { authuser: number; family: string; sessionId: string } | null = null;

  for (const [key, rawList] of buckets.entries()) {
    if (rawList.length === 0) {
      continue;
    }

    let row: { family: string; sessionId: string } | null = null;
    for (const raw of rawList) {
      const tokenHash = sha256Hex(raw);
      const found = await RefreshToken.findOne({ tokenHash });
      if (found) {
        row = { family: found.family, sessionId: found.sessionId };
        break;
      }
    }

    if (!row) {
      if (!orphan) {
        orphan = { authuser: key, family: '', sessionId: '' };
      }
      continue;
    }

    const session = await Session.findOne({ sessionId: row.sessionId })
      .select('deviceInfo.lastActive createdAt')
      .lean<{ deviceInfo?: { lastActive?: Date }; createdAt?: Date }>();
    const lastActiveDate = session?.deviceInfo?.lastActive ?? session?.createdAt;
    const lastActive = lastActiveDate ? new Date(lastActiveDate).getTime() : 0;

    if (worst === null || lastActive < worst.lastActive) {
      worst = { authuser: key, family: row.family, sessionId: row.sessionId, lastActive };
    }
  }

  if (orphan) {
    return { authuser: orphan.authuser, family: orphan.family, sessionId: orphan.sessionId };
  }
  if (worst) {
    return { authuser: worst.authuser, family: worst.family, sessionId: worst.sessionId };
  }
  return null;
}

/**
 * Mint a refresh token and set the appropriate refresh cookie on the response,
 * resolving the multi-account `authuser` slot as needed.
 *
 * Resolution rules (in order):
 *   1. `opts.authuser` provided -> write that exact indexed slot.
 *   2. `opts.cookieHeader` provided or omitted -> indexed multi-account path:
 *        - If this `userId` already owns a slot -> revoke its existing family
 *          (so the old token can't be replayed) and reuse the SAME index.
 *        - Else, take the lowest free integer in `[0, MAX_DEVICE_ACCOUNTS)`.
 *        - Else (cap reached), evict the LRU slot by revoking its family and
 *          reusing its index.
 *
 * On success returns the freshly-minted access token for the bound session
 * plus the resolved `authuser` slot.
 */
export async function issueAndSetRefreshCookie(
  res: Response,
  sessionId: string,
  userId: Types.ObjectId | string,
  opts: IssueAndSetRefreshCookieOptions = {}
): Promise<IssueAndSetRefreshCookieResult> {
  // Explicit `authuser` short-circuits everything else.
  if (typeof opts.authuser === 'number') {
    const { token } = await issueRefreshToken({ sessionId, userId });
    setRefreshCookie(res, token, { authuser: opts.authuser });
    const accessTokenResult = await sessionService.getAccessToken(sessionId);
    if (!accessTokenResult) {
      throw new Error('Failed to mint access token for newly-bound session');
    }
    return {
      accessToken: accessTokenResult.accessToken,
      expiresAt: accessTokenResult.expiresAt,
      authuser: opts.authuser,
    };
  }

  const cookieHeader = typeof opts.cookieHeader === 'string' ? opts.cookieHeader : '';
  const userIdStr = typeof userId === 'string' ? userId : userId.toString();
  const userIdToAuthuser = opts.userIdToAuthuser ?? (await buildUserIdToAuthuserMap(cookieHeader));

  // Same user already has a slot -> reuse it after revoking the old family
  // (a fresh sign-in for the same account must invalidate the prior token so
  // a replay can't ride the same slot).
  const existing = userIdToAuthuser.get(userIdStr);
  if (typeof existing === 'number') {
    const buckets = parseAllRefreshCookies(cookieHeader);
    const rawList = buckets.get(existing) ?? [];
    for (const raw of rawList) {
      const tokenHash = sha256Hex(raw);
      const row = await RefreshToken.findOne({ tokenHash });
      if (row) {
        if (String(row.sessionId) === sessionId) {
          await RefreshToken.updateMany(
            { family: row.family, revokedAt: null },
            { $set: { revokedAt: new Date() } }
          );
        } else {
          await revokeFamily(row.family, row.sessionId);
        }
        break;
      }
    }
    const { token } = await issueRefreshToken({ sessionId, userId });
    setRefreshCookie(res, token, { authuser: existing });
    const accessTokenResult = await sessionService.getAccessToken(sessionId);
    if (!accessTokenResult) {
      throw new Error('Failed to mint access token for newly-bound session');
    }
    return {
      accessToken: accessTokenResult.accessToken,
      expiresAt: accessTokenResult.expiresAt,
      authuser: existing,
    };
  }

  // New user on this device -> find the lowest free integer slot.
  const occupied = new Set<number>(userIdToAuthuser.values());
  let chosen: number | null = null;
  for (let i = 0; i < MAX_DEVICE_ACCOUNTS; i += 1) {
    if (!occupied.has(i)) {
      chosen = i;
      break;
    }
  }

  // All slots occupied -> evict the LRU.
  if (chosen === null) {
    const lru = await pickLruAuthuser(cookieHeader);
    if (!lru) {
      // Defensive: every slot is occupied per the map but we couldn't resolve a
      // single one to evict. Fall back to slot 0 to keep the flow working.
      chosen = 0;
    } else {
      if (lru.family.length > 0) {
        await revokeFamily(lru.family, lru.sessionId);
      }
      chosen = lru.authuser;
    }
  }

  const { token } = await issueRefreshToken({ sessionId, userId });
  setRefreshCookie(res, token, { authuser: chosen });
  const accessTokenResult = await sessionService.getAccessToken(sessionId);
  if (!accessTokenResult) {
    throw new Error('Failed to mint access token for newly-bound session');
  }
  return {
    accessToken: accessTokenResult.accessToken,
    expiresAt: accessTokenResult.expiresAt,
    authuser: chosen,
  };
}
