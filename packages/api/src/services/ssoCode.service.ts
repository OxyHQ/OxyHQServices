/**
 * Central SSO code store (Phase A — true cross-domain SSO).
 *
 * The IdP worker (auth.oxy.so) mints a real Oxy session via the existing,
 * audited `mintSessionForClient` pipeline, then hands the resulting session
 * payload to `POST /sso/code` on api.oxy.so. We wrap that payload in a single-
 * use, ≤30s OPAQUE code (NEVER a token/JWT) and store ONLY the SHA-256 hash of
 * the code in Valkey/Redis. The worker puts the raw code in the top-level
 * redirect fragment; the RP browser exchanges it at `POST /sso/exchange` for the
 * real session.
 *
 * Security properties:
 *  - The code is 256 bits of CSPRNG entropy (`crypto.randomBytes(32)`),
 *    base64url-encoded. It is opaque and carries no session material.
 *  - We persist `sha256(code)`, never the raw code, so a Valkey snapshot leak
 *    cannot be replayed.
 *  - Redemption is single-use via an ATOMIC `GETDEL` (the same single-use burn
 *    guarantee the FedCM nonce store provides) — a code never returns twice.
 *  - The stored record is bound to the approved `clientOrigin`; redemption is
 *    only honoured when the RP's HTTP `Origin` matches it.
 *  - TTL is 30s — long enough for a top-level redirect round-trip, short enough
 *    to bound the window if a fragment is shoulder-surfed before the RP reads
 *    it.
 *
 * Backing store: Valkey/Redis (shared ioredis client). A sub-minute TTL with an
 * atomic single-use burn is exactly what Valkey is for; we do NOT use MongoDB
 * for this hot, ephemeral path. If Redis is unavailable the store fails closed
 * (mint throws, exchange returns null) so SSO degrades safely instead of
 * silently minting un-burnable codes.
 */

import * as crypto from 'crypto';
import type { UserNameResponse } from '@oxyhq/contracts';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

/** Opaque-code entropy in bytes (256 bits). */
const CODE_BYTES = 32;

/** Time-to-live of a minted code, in seconds. */
export const SSO_CODE_TTL_SECONDS = 30;

/** Valkey key namespace for SSO codes. */
const KEY_PREFIX = 'sso:code:';

/**
 * The session material the IdP worker hands us and that the RP receives back on
 * redemption. Mirrors the `mintSessionForClient` / FedCM `/fedcm/exchange`
 * output — no new token format is introduced here.
 */
export interface SsoSessionPayload {
  sessionId: string;
  accessToken: string;
  /**
   * `user.name` is the structured {@link UserNameResponse} (required
   * `displayName`), NOT a bare string — this is the canonical contract the SDK's
   * `userResponseSchema` enforces on redemption. A string name would make
   * `exchangeSsoCode` throw and every RP show logged-out.
   */
  user: { id: string; username?: string; email?: string; avatar?: string; name: UserNameResponse };
  expiresAt?: string;
  /** Optional Google-style multi-account device slot from the FedCM exchange. */
  authuser?: number;
}

/** What is persisted in Valkey under `sso:code:<sha256(code)>`. */
interface StoredCodeRecord {
  sessionPayload: SsoSessionPayload;
  clientOrigin: string;
  createdAt: number;
}

/** SHA-256 hex digest — never persist or look up by the raw code. */
function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function keyFor(code: string): string {
  return `${KEY_PREFIX}${sha256Hex(code)}`;
}

/**
 * Mint a single-use SSO code for an already-validated approved `clientOrigin`,
 * wrapping the worker-supplied `sessionPayload`. Returns the RAW opaque code
 * (the only place it ever exists in plaintext) for the worker to place in the
 * redirect fragment.
 *
 * Fails closed: throws if the Valkey client is unavailable so the worker never
 * receives a code that cannot later be burned.
 */
export async function mintSsoCode(
  sessionPayload: SsoSessionPayload,
  clientOrigin: string
): Promise<{ code: string; expiresInSeconds: number }> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('SSO code store unavailable: Redis/Valkey is not configured');
  }

  const code = crypto.randomBytes(CODE_BYTES).toString('base64url');
  const record: StoredCodeRecord = {
    sessionPayload,
    clientOrigin,
    createdAt: Date.now(),
  };

  // SET <key> <json> EX <ttl>. We store the HASH of the code as the key; the
  // raw code is returned to the caller and never persisted.
  await redis.set(keyFor(code), JSON.stringify(record), 'EX', SSO_CODE_TTL_SECONDS);

  return { code, expiresInSeconds: SSO_CODE_TTL_SECONDS };
}

/**
 * Atomically redeem (single-use burn) an SSO code. Uses `GETDEL` so the value
 * is read and deleted in one round-trip — two concurrent redemptions can never
 * both succeed, and a replay always misses.
 *
 * Returns `null` when the code is missing, already redeemed, or expired (the
 * caller maps this to `410 Gone`). On a Valkey outage, falls back to a
 * non-atomic GET+DEL only when `GETDEL` is unsupported by the server; if the
 * client itself is unavailable, returns null (fail closed).
 */
export async function redeemSsoCode(code: string): Promise<{
  sessionPayload: SsoSessionPayload;
  clientOrigin: string;
} | null> {
  const redis = getRedisClient();
  if (!redis) {
    logger.error('SSO code redemption attempted with no Redis/Valkey client');
    return null;
  }

  const key = keyFor(code);
  let raw: string | null;
  try {
    // `getdel` lands as a single atomic command. ioredis exposes it directly on
    // Valkey/Redis ≥ 6.2 (our managed Valkey is 7.x).
    raw = await redis.getdel(key);
  } catch (error) {
    logger.error('SSO code GETDEL failed', error instanceof Error ? error : new Error(String(error)));
    return null;
  }

  if (raw === null) {
    return null;
  }

  let parsed: StoredCodeRecord;
  try {
    parsed = JSON.parse(raw) as StoredCodeRecord;
  } catch (error) {
    logger.error('SSO code store contained unparseable record', error instanceof Error ? error : new Error(String(error)));
    return null;
  }

  if (
    !parsed ||
    typeof parsed.clientOrigin !== 'string' ||
    typeof parsed.sessionPayload !== 'object' ||
    parsed.sessionPayload === null
  ) {
    logger.error('SSO code store contained malformed record');
    return null;
  }

  return { sessionPayload: parsed.sessionPayload, clientOrigin: parsed.clientOrigin };
}
