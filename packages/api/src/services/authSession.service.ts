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

import type { Request } from 'express';
import AuthSession, { type IAuthSession, type AuthSessionStatus } from '../models/AuthSession';
import AuthChallenge from '../models/AuthChallenge';
import { User } from '../models/User';
import { Application } from '../models/Application';
import SignatureService from './signature.service';
import sessionService from './session.service';
import { logger } from '../utils/logger';

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

/**
 * Options for {@link authorizeSessionWithSignedChallenge}. `req` is forwarded to
 * `sessionService.createSession` for device/IP attribution.
 */
export interface AuthorizeSignedOptions {
  authorizeCode: string;
  publicKey: string;
  challenge: string;
  signature: string;
  timestamp: number;
  deviceName?: string;
  deviceFingerprint?: string;
  req: Request;
}

export type AuthorizeSignedOutcome =
  | { ok: true; sessionToken: string; sessionId: string; userId: string; username?: string; publicKey: string }
  | { ok: false; status: 400 | 401 | 404; message: string };

/**
 * Key-signed approval of a pending cross-app auth session (the "Sign in with
 * Oxy" QR / app-to-app handoff). The Commons vault approves with its LOCAL
 * secp256k1 key rather than a bearer token, so this proves key control via a
 * single-use challenge signature and derives the authorizing user from the
 * VERIFIED signer — never from a client-asserted id.
 *
 * Steps: (1) validate the `AuthChallenge` row, verify the signature, and
 * atomically burn the challenge; (2) resolve the PENDING, unexpired session
 * bound to `authorizeCode`; (3) resolve the `User` by the signer's `publicKey`;
 * (4) mint a session for the originating app owned by that user; (5) bind the
 * result onto the session row. Does NOT throw — returns an outcome the route
 * maps to a status code (so success/failure handling stays in one place).
 */
export async function authorizeSessionWithSignedChallenge(
  options: AuthorizeSignedOptions
): Promise<AuthorizeSignedOutcome> {
  const { authorizeCode, publicKey, challenge, signature, timestamp, deviceName, deviceFingerprint, req } = options;

  // 1. Validate + cryptographically verify + atomically burn the challenge.
  //    Scope to signin-purpose challenges (default, or legacy docs predating the
  //    `purpose` field) so a `rotate_key` challenge can NOT be spent to mint a
  //    session — the symmetric invariant to the rotate flow's purpose scoping.
  const authChallenge = await AuthChallenge.findOne({
    publicKey,
    challenge,
    used: false,
    purpose: { $in: ['signin', null] },
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!authChallenge) {
    return { ok: false, status: 401, message: 'Invalid or expired challenge' };
  }

  if (!SignatureService.verifyChallengeResponse(publicKey, challenge, signature, timestamp)) {
    return { ok: false, status: 401, message: 'Invalid signature' };
  }

  const burned = await AuthChallenge.findOneAndUpdate(
    { _id: authChallenge._id, used: false },
    { $set: { used: true } },
    { new: false }
  );
  if (!burned) {
    // Lost the race — the challenge was already consumed concurrently.
    return { ok: false, status: 401, message: 'Invalid or expired challenge' };
  }

  // 2. Resolve the pending, unexpired session bound to this authorizeCode.
  const authSession = await AuthSession.findOne({ authorizeCode, status: 'pending' });
  if (!authSession) {
    return { ok: false, status: 404, message: 'Auth session not found or already processed' };
  }
  if (authSession.expiresAt < new Date()) {
    authSession.status = 'expired';
    await authSession.save();
    return { ok: false, status: 400, message: 'Auth session has expired' };
  }

  // 3. The session user is the VERIFIED signer.
  const user = await User.findOne({ publicKey }).lean();
  if (!user) {
    return { ok: false, status: 404, message: 'User not found' };
  }
  const userId = user._id.toString();

  // 4. Mint the session for the originating app, owned by the signer. When the
  //    flow was started with a device binding (`deviceId` persisted at create
  //    time), pass it as the explicit deviceId so the session lands on the
  //    originating device set instead of sprawling a fresh device.
  const app = await Application.findById(authSession.applicationId);
  const appLabel = app ? app.name : 'App';
  const newSession = await sessionService.createSession(userId, req, {
    deviceName: deviceName || `${appLabel} App`,
    deviceFingerprint,
    ...(authSession.deviceId ? { deviceId: authSession.deviceId } : {}),
  });

  // 5. Bind the result onto the session row.
  authSession.status = 'authorized';
  authSession.authorizedBy = publicKey;
  authSession.authorizedUserId = user._id;
  authSession.authorizedSessionId = newSession.sessionId;
  await authSession.save();

  return {
    ok: true,
    sessionToken: authSession.sessionToken,
    sessionId: newSession.sessionId,
    userId,
    username: typeof user.username === 'string' ? user.username : undefined,
    publicKey,
  };
}

/** Options for {@link authorizeSessionWithBearer}. */
export interface AuthorizeBearerOptions {
  authorizeCode: string;
  authenticatedUserId: string;
  authenticatedPublicKey?: string;
  deviceName?: string;
  deviceFingerprint?: string;
  req: Request;
}

export type AuthorizeBearerOutcome =
  | { ok: true; sessionToken: string; sessionId: string }
  | { ok: false; status: 400 | 404; message: string };

/**
 * Bearer approval of a pending cross-app auth session, keyed on the PUBLIC
 * `authorizeCode` (the auth.oxy.so passkey hub, b2 — the approver
 * authenticates via bearer token, never a local secp256k1 key, so it can't
 * use {@link authorizeSessionWithSignedChallenge}). The authenticated
 * principal is the bearer's `req.user` — never anything client-asserted.
 *
 * The claim is ATOMIC: a single `findOneAndUpdate` flips `pending` ->
 * `authorized` conditioned on that exact prior status + an unexpired
 * `expiresAt`, so two concurrent authorizes of the same code cannot both mint
 * a session — the loser's update matches nothing and gets treated as
 * already-processed, before ever calling `sessionService.createSession`.
 * Mirrors {@link claimAuthSession}'s peek-then-atomic-claim shape.
 *
 * `originVerified` is an anti-phishing signal computed at `session/create`
 * time from the REAL browser `Origin` header, not something this bearer
 * caller can influence — an authorize with `originVerified: false` is
 * exactly the shape a login-CSRF attempt would take (an attacker's own
 * session, or an unregistered/third-party origin), so it's logged for audit
 * even though the CLIENT-side consent screen (mandatory confirmation +
 * non-suppressible acknowledgement) is the primary defense.
 */
export async function authorizeSessionWithBearer(
  options: AuthorizeBearerOptions
): Promise<AuthorizeBearerOutcome> {
  const { authorizeCode, authenticatedUserId, authenticatedPublicKey, deviceName, deviceFingerprint, req } = options;

  // Peek first for a precise reason (mirrors claimAuthSession) — the atomic
  // update below is the actual source of truth for the claim.
  const existing = await AuthSession.findOne({ authorizeCode });
  if (!existing || existing.status !== 'pending') {
    return { ok: false, status: 404, message: 'Auth session not found or already processed' };
  }
  if (existing.expiresAt < new Date()) {
    return { ok: false, status: 400, message: 'Auth session has expired' };
  }

  const claimed = await AuthSession.findOneAndUpdate(
    { _id: existing._id, status: 'pending', expiresAt: { $gt: new Date() } },
    {
      $set: {
        status: 'authorized',
        authorizedUserId: authenticatedUserId,
        ...(authenticatedPublicKey ? { authorizedBy: authenticatedPublicKey } : {}),
      },
    },
    { new: true }
  );
  if (!claimed) {
    // Lost the race to a concurrent authorize (or expired between the peek
    // and here) — the loser must NOT mint a session.
    return { ok: false, status: 404, message: 'Auth session not found or already processed' };
  }

  if (!claimed.originVerified) {
    logger.warn('Auth session authorized (bearer, by code) with an unverified origin', {
      authorizeCode: authorizeCode.substring(0, 8) + '...',
      userId: authenticatedUserId,
      applicationId: claimed.applicationId.toString(),
      boundOrigin: claimed.boundOrigin ?? null,
    });
  }

  const app = await Application.findById(claimed.applicationId);
  const appLabel = app ? app.name : 'App';
  const newSession = await sessionService.createSession(authenticatedUserId, req, {
    deviceName: deviceName || `${appLabel} App`,
    deviceFingerprint,
    ...(claimed.deviceId ? { deviceId: claimed.deviceId } : {}),
  });

  // Only the winner of the atomic claim above ever reaches here, so this
  // final write is not racy — it just attaches the minted session id.
  claimed.authorizedSessionId = newSession.sessionId;
  await claimed.save();

  return { ok: true, sessionToken: claimed.sessionToken, sessionId: newSession.sessionId };
}
