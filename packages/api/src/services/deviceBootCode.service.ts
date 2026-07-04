/**
 * Device-first bootstrap code store.
 *
 * Clones the security PATTERN of `ssoCode.service.ts` (opaque single-use code,
 * sha256-hashed key, atomic GETDEL burn, fail-closed on Redis absence) for the
 * device-first bootstrap hop. `GET /auth/device/bootstrap` resolves the active
 * session from the `oxy_device` cookie and mints one of these codes; the raw
 * code travels in the top-level `#oxy_boot=…` fragment, and the RP browser
 * exchanges it at `POST /auth/device/exchange` for real tokens.
 *
 * DISTINCT from the SSO code store: a DIFFERENT Valkey key prefix
 * (`device:boot:`), and the stored record carries NO tokens — only the
 * `sessionId`/`userId`/`clientOrigin` needed to mint a fresh token bundle at
 * exchange time. A leaked fragment therefore never exposes a token, only a
 * single-use, origin-bound, ≤60s handle.
 *
 * Security properties:
 *  - 256-bit CSPRNG opaque code; we persist `sha256(code)`, never the raw value.
 *  - Redemption is single-use via atomic `GETDEL`.
 *  - Bound to `clientOrigin`; exchange is only honoured when the RP's `Origin`
 *    matches.
 *  - 60s TTL — one top-level redirect round-trip.
 *  - Fails closed: mint throws / redeem returns null when Redis is unavailable,
 *    so the flow degrades safely instead of minting un-burnable codes.
 */

import * as crypto from 'crypto';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

/** Opaque-code entropy in bytes (256 bits). */
const CODE_BYTES = 32;

/** Time-to-live of a minted boot code, in seconds. */
export const DEVICE_BOOT_CODE_TTL_SECONDS = 60;

/** Valkey key namespace for device boot codes (distinct from `sso:code:`). */
const KEY_PREFIX = 'device:boot:';

/** What is persisted under `device:boot:<sha256(code)>` — NEVER any token. */
export interface DeviceBootCodePayload {
  sessionId: string;
  userId: string;
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
 * Mint a single-use device boot code wrapping `{ sessionId, userId,
 * clientOrigin }`. Returns the RAW opaque code for the fragment.
 *
 * Fails closed: throws if the Valkey client is unavailable so the caller never
 * hands back a code that cannot later be burned.
 */
export async function mintBootCode(input: {
  sessionId: string;
  userId: string;
  clientOrigin: string;
}): Promise<{ code: string; expiresInSeconds: number }> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Device boot code store unavailable: Redis/Valkey is not configured');
  }

  const code = crypto.randomBytes(CODE_BYTES).toString('base64url');
  const record: DeviceBootCodePayload = {
    sessionId: input.sessionId,
    userId: input.userId,
    clientOrigin: input.clientOrigin,
    createdAt: Date.now(),
  };

  await redis.set(keyFor(code), JSON.stringify(record), 'EX', DEVICE_BOOT_CODE_TTL_SECONDS);

  return { code, expiresInSeconds: DEVICE_BOOT_CODE_TTL_SECONDS };
}

/**
 * Atomically redeem (single-use burn) a device boot code via `GETDEL`. Returns
 * `null` when the code is missing, already redeemed, or expired (the caller maps
 * this to `410 Gone`), or on a Valkey outage (fail closed).
 */
export async function redeemBootCode(code: string): Promise<DeviceBootCodePayload | null> {
  const redis = getRedisClient();
  if (!redis) {
    logger.error('Device boot code redemption attempted with no Redis/Valkey client');
    return null;
  }

  let raw: string | null;
  try {
    raw = await redis.getdel(keyFor(code));
  } catch (error) {
    logger.error(
      'Device boot code GETDEL failed',
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }

  if (raw === null) {
    return null;
  }

  let parsed: DeviceBootCodePayload;
  try {
    parsed = JSON.parse(raw) as DeviceBootCodePayload;
  } catch (error) {
    logger.error(
      'Device boot code store contained unparseable record',
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }

  if (
    !parsed ||
    typeof parsed.sessionId !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.clientOrigin !== 'string'
  ) {
    logger.error('Device boot code store contained malformed record');
    return null;
  }

  return parsed;
}
