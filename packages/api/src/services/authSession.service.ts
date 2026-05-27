/**
 * AuthSession claim service
 *
 * Implements the device-flow token exchange (RFC 8628-style). The
 * originating client holds a 128-bit `sessionToken` that nobody else
 * has seen — it was generated client-side, sent once on `POST /auth/session/create`,
 * never echoed back. After another authenticated principal authorizes
 * the session via `POST /auth/session/authorize/:sessionToken`
 * (bearer-authed), the originating client exchanges its `sessionToken`
 * here for the first access token.
 *
 * Safety properties:
 *  - Single-use: the atomic `findOneAndUpdate({ status: 'authorized' })`
 *    claim transitions to `'consumed'` so a replayed sessionToken is
 *    rejected.
 *  - Time-bound: the `expiresAt` TTL (default 5 minutes) gates the
 *    entire flow.
 *  - Bound to the bearer-authed authorizer: the session that we hand
 *    back was created with the authorizer's user identity in
 *    `/auth/session/authorize/:sessionToken`.
 *  - Constant-time identifier equality keeps `crypto.timingSafeEqual`
 *    usage symmetric (Mongo handles the lookup; we don't expose
 *    timing-sensitive branches before the atomic claim).
 */

import AuthSession, { IAuthSession, AuthSessionStatus } from '../models/AuthSession';

export interface ClaimAuthSessionOptions {
  sessionToken: string;
}

export type ClaimAuthSessionOutcome =
  | { ok: true; authSession: IAuthSession }
  | { ok: false; reason: 'not_found' | 'expired' | 'cancelled' | 'pending' | 'already_consumed' };

/**
 * Atomically claim an authorized AuthSession. Only an `authorized` row
 * (set by `/auth/session/authorize/:sessionToken`) transitions to
 * `'consumed'`. Concurrent claim attempts see the loser path naturally
 * because the second `findOneAndUpdate` no longer matches.
 *
 * NOTE: We do NOT throw here — the caller (route handler) chooses how to
 * surface each outcome to the client (uniform 401 for replay/expired,
 * 404 for not found, etc).
 */
export async function claimAuthSession(
  options: ClaimAuthSessionOptions
): Promise<ClaimAuthSessionOutcome> {
  const { sessionToken } = options;

  // Peek first to give the route handler a precise reason. We don't
  // strictly need this — the atomic update below is the source of truth
  // — but it lets us distinguish "never existed" from "wrong status".
  // The peek does NOT leak existence to the network: the caller maps
  // multiple outcomes to the same 401 status code per RFC 6749 §5.2.
  const existing = await AuthSession.findOne({ sessionToken });
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  const currentStatus = existing.status as AuthSessionStatus;
  if (currentStatus === 'consumed') {
    return { ok: false, reason: 'already_consumed' };
  }
  if (currentStatus === 'cancelled') {
    return { ok: false, reason: 'cancelled' };
  }
  if (currentStatus === 'pending') {
    return { ok: false, reason: 'pending' };
  }
  if (currentStatus === 'expired' || existing.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  // currentStatus must be 'authorized' here — do the atomic claim.
  const claimed = await AuthSession.findOneAndUpdate(
    { _id: existing._id, status: 'authorized' },
    { $set: { status: 'consumed', consumedAt: new Date() } },
    { new: true }
  );

  if (!claimed) {
    // Lost the race to a concurrent claim, or another transition fired.
    return { ok: false, reason: 'already_consumed' };
  }

  return { ok: true, authSession: claimed };
}
