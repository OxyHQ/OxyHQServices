/**
 * Device Token Service
 *
 * The opaque **device token** is the add-only attribution credential (see the
 * `DeviceToken` model). It lets a first-party sign-in performed over a
 * cookieless cross-site fetch land in the SAME browser/device `DeviceSession`
 * the user already has — WITHOUT ever reading state or flipping the active
 * account.
 *
 * Security primitives (mirror `refreshToken.service`):
 *  - 256-bit CSPRNG raw token, base64url; ONLY its sha256 is stored.
 *  - `issueDeviceToken` revokes the previous live token for the same
 *    `(deviceId, origin)` so a rotated-away token can never be reused.
 *  - `resolveDeviceToken` enforces the CHANNEL policy: a `web` token only
 *    resolves when the request `Origin` header EXACTLY matches the bound origin;
 *    a `native` token only resolves when the `Origin` header is ABSENT (native
 *    apps attach no browser Origin). It never throws — a null return means "no
 *    attribution", and the caller proceeds without a device binding.
 *  - Sliding 400-day expiry, bumped (`lastUsedAt` + `expiresAt`) on each resolve.
 *
 * The raw token is a bearer-equivalent — never logged.
 */

import * as crypto from 'crypto';
import type { Request } from 'express';
import DeviceToken, { DeviceTokenChannel } from '../models/DeviceToken';
import { sha256Hex, base64UrlEncode } from './oauthCode.service';
import { normaliseOrigin } from '../utils/origin';
import { logger } from '../utils/logger';

/** Raw device-token entropy in bytes (256 bits). */
const DEVICE_TOKEN_BYTES = 32;

/** Sliding lifetime of a device token (400 days). */
export const DEVICE_TOKEN_TTL_MS = 400 * 24 * 60 * 60 * 1000;

/** Literal `origin` value for the native channel (no browser origin exists). */
export const NATIVE_ORIGIN = 'native';

export interface IssueDeviceTokenInput {
  deviceId: string;
  /** An https origin for the `web` channel, or the literal `'native'`. */
  origin: string;
  channel: DeviceTokenChannel;
}

/**
 * Mint a device token bound to `(deviceId, origin, channel)`. Revokes the
 * previous live token for the same `(deviceId, origin)` first (one live token
 * per pair). Returns the RAW token — the only place it exists in plaintext.
 */
export async function issueDeviceToken(input: IssueDeviceTokenInput): Promise<string> {
  const { deviceId, channel } = input;
  // `web` tokens store the NORMALISED origin so the resolve-time comparison
  // (`normaliseOrigin(Origin) === stored.origin`) is exact. `native` keeps the
  // literal marker.
  const origin =
    channel === 'web' ? normaliseOrigin(input.origin) ?? input.origin : NATIVE_ORIGIN;

  await DeviceToken.updateMany(
    { deviceId, origin, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  const rawToken = base64UrlEncode(crypto.randomBytes(DEVICE_TOKEN_BYTES));
  const tokenHash = sha256Hex(rawToken);
  await DeviceToken.create({
    tokenHash,
    deviceId,
    origin,
    channel,
    expiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_MS),
  });

  return rawToken;
}

/**
 * Resolve a presented raw device token to its deviceId, enforcing the channel
 * policy against the request. Never throws — returns `null` for any
 * missing/expired/revoked token or channel-policy mismatch, so the caller
 * proceeds without a device binding.
 */
export async function resolveDeviceToken(
  rawToken: string,
  req: Request
): Promise<{ deviceId: string } | null> {
  try {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return null;
    }
    const tokenHash = sha256Hex(rawToken);
    const stored = await DeviceToken.findOne({ tokenHash });
    if (!stored) return null;
    if (stored.revokedAt) return null;
    if (stored.expiresAt < new Date()) return null;

    const originHeaderRaw = req.headers.origin;
    const originHeader = typeof originHeaderRaw === 'string' ? originHeaderRaw : undefined;

    if (stored.channel === 'web') {
      // A web token is bound to an exact origin — the request MUST carry that
      // Origin header. This is what keeps a stolen web token from riding a
      // different site's request.
      if (!originHeader || originHeader.length === 0) return null;
      const normalised = normaliseOrigin(originHeader);
      if (!normalised || normalised !== stored.origin) return null;
    } else {
      // A native token must NOT carry a browser Origin (native apps attach
      // none). A present Origin means the token is being replayed from a
      // browser context — refuse.
      if (originHeader && originHeader.length > 0) return null;
    }

    // Slide the expiry and record use. Best-effort — a write failure must not
    // deny an otherwise-valid attribution.
    await DeviceToken.updateOne(
      { _id: stored._id },
      { $set: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_MS) } }
    );

    return { deviceId: stored.deviceId };
  } catch (error) {
    logger.error(
      'resolveDeviceToken failed',
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}

/** Revoke every live device token for a device (signout / device removal). */
export async function revokeDeviceTokens(deviceId: string): Promise<void> {
  await DeviceToken.updateMany(
    { deviceId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}
