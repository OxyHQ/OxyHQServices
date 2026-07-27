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
import mongoose from 'mongoose';
import AuthSession, {
  type IAuthSession,
  type AuthSessionStatus,
  type IAuthSessionOAuthContext,
} from '../models/AuthSession';
import AuthChallenge from '../models/AuthChallenge';
import { User } from '../models/User';
import { Application } from '../models/Application';
import { AppGrant } from '../models/AppGrant';
import SignatureService from './signature.service';
import sessionService from './session.service';
import { issueAuthCode, AUTH_CODE_TTL_MS } from './oauthCode.service';
import { isAllowedRedirectUri } from '../utils/oauthRedirect';
import { isTrustedApplication } from '../utils/trustedApplication';
import { isValidObjectId } from '../utils/validation';
import type { AccountRole } from '../utils/accountRoles';
import { logger } from '../utils/logger';

export interface ClaimAuthSessionOptions {
  sessionToken: string;
}

export type ClaimAuthSessionOutcome =
  | { ok: true; authSession: IAuthSession }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'cancelled' | 'pending' | 'already_consumed' | 'wrong_purpose';
    };

/**
 * The OAuth request binding of an OAuth-bound session, or null when the session
 * is an ordinary device sign-in (or a row whose binding is incomplete — treated
 * as absent, never as partially usable).
 */
export function resolveOAuthContext(
  authSession: Pick<IAuthSession, 'purpose' | 'oauth'>
): IAuthSessionOAuthContext | null {
  if (authSession.purpose !== 'oauth_authorization') {
    return null;
  }
  const oauth = authSession.oauth;
  if (!oauth || typeof oauth.redirectUri !== 'string' || typeof oauth.codeChallenge !== 'string') {
    return null;
  }
  if (oauth.codeChallengeMethod !== 'S256') {
    return null;
  }
  return oauth;
}

/** Why a delegated subject was refused. Logged; never surfaced to the client. */
export type DelegatedSubjectRejection =
  | 'invalid_subject'
  | 'not_found'
  | 'personal_account'
  | 'forbidden';

export type DelegatedSubjectOutcome =
  | { ok: true; role: AccountRole }
  | { ok: false; reason: DelegatedSubjectRejection };

/**
 * Authorise an IDENTITY to approve an app acting AS another account.
 *
 * Identity and account are different concepts: the human never becomes the
 * organisation, they authorise an application to act as it. The gate is the
 * EXISTING act-as mechanism — `accountService.verifyActingAs` (effective
 * membership, inherited through the account tree, carrying `account:act_as`) —
 * the same predicate `POST /accounts/:id/switch` and the managed-session
 * re-check use. No parallel permission system.
 *
 * Personal accounts are refused as subjects: assuming a human login would be
 * impersonation, exactly as on the account-switch path.
 *
 * `account.service` is imported LAZILY (mirroring `session.service`) so this
 * module's graph does not statically load the Account* models.
 */
export async function verifyDelegatedSubject(
  identityUserId: string,
  subjectAccountId: string
): Promise<DelegatedSubjectOutcome> {
  if (!isValidObjectId(subjectAccountId)) {
    return { ok: false, reason: 'invalid_subject' };
  }

  const account = await User.findById(subjectAccountId)
    .select('kind accountStatus')
    .lean<{ kind?: string; accountStatus?: string } | null>();
  if (!account || account.accountStatus === 'archived') {
    return { ok: false, reason: 'not_found' };
  }
  if (!account.kind || account.kind === 'personal') {
    return { ok: false, reason: 'personal_account' };
  }

  const { accountService } = await import('./account.service.js');
  const role = await accountService.verifyActingAs(identityUserId, subjectAccountId);
  if (!role) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: true, role };
}

/**
 * Gate an approval against the session's OPTIONAL delegated subject. Sessions
 * with no delegated subject pass straight through, so every approval path can
 * call this unconditionally.
 */
async function gateApprovalDelegation(
  authSession: Pick<IAuthSession, 'purpose' | 'oauth'>,
  approvingUserId: string
): Promise<{ ok: true } | { ok: false; reason: DelegatedSubjectRejection }> {
  const subjectAccountId = resolveOAuthContext(authSession)?.subjectAccountId;
  if (!subjectAccountId) {
    return { ok: true };
  }
  const outcome = await verifyDelegatedSubject(approvingUserId, subjectAccountId.toString());
  if (outcome.ok) {
    return { ok: true };
  }
  return { ok: false, reason: outcome.reason };
}

/**
 * An OAuth-bound session NEVER mints a session on approval: its result is an
 * authorization code redeemed by the relying party at `POST /auth/oauth/token`.
 * Minting one anyway would leave a live, unclaimable session for the approving
 * identity on the RP's device, and would let the surface that only needs a code
 * pick up an access token instead.
 */
function approvalMintsSession(authSession: Pick<IAuthSession, 'purpose'>): boolean {
  return authSession.purpose !== 'oauth_authorization';
}

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

  // An OAuth authorization request is finalized into an authorization code via
  // `POST /auth/session/finalize/:sessionToken`; it must never hand its holder
  // an access token instead. Legacy rows carry no `purpose` and read as device
  // sign-ins, so this changes nothing for them.
  if (existing.purpose === 'oauth_authorization') {
    return { ok: false, reason: 'wrong_purpose' };
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
  | {
      ok: true;
      sessionToken: string;
      /** Absent for an OAuth authorization request — those mint no session. */
      sessionId?: string;
      userId: string;
      username?: string;
      publicKey: string;
    }
  | { ok: false; status: 400 | 401 | 403 | 404; message: string };

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

  // 4. Delegated subject gate: when the request asks the identity to authorise
  //    the app acting AS another account, the VERIFIED signer must actually hold
  //    `account:act_as` over it. Refused before anything is bound.
  const delegation = await gateApprovalDelegation(authSession, userId);
  if (!delegation.ok) {
    logger.warn('[AuthSession] Delegated subject refused on signed approval', {
      authorizeCode: authorizeCode.substring(0, 8) + '...',
      identityUserId: userId,
      reason: delegation.reason,
    });
    return { ok: false, status: 403, message: 'Not authorized to act as the requested account' };
  }

  // 5. Mint the session for the originating app, owned by the signer. When the
  //    flow was started with a device binding (`deviceId` persisted at create
  //    time), pass it as the explicit deviceId so the session lands on the
  //    originating device set instead of sprawling a fresh device. An OAuth
  //    authorization request mints nothing here — see `approvalMintsSession`.
  let sessionId: string | undefined;
  if (approvalMintsSession(authSession)) {
    const app = await Application.findById(authSession.applicationId);
    const appLabel = app ? app.name : 'App';
    const newSession = await sessionService.createSession(userId, req, {
      deviceName: deviceName || `${appLabel} App`,
      deviceFingerprint,
      ...(authSession.deviceId ? { deviceId: authSession.deviceId } : {}),
    });
    sessionId = newSession.sessionId;
  }

  // 6. Bind the result onto the session row — including WHICH identity approved.
  authSession.status = 'authorized';
  authSession.authorizedBy = publicKey;
  authSession.authorizedUserId = user._id;
  if (sessionId) {
    authSession.authorizedSessionId = sessionId;
  }
  await authSession.save();

  return {
    ok: true,
    sessionToken: authSession.sessionToken,
    ...(sessionId ? { sessionId } : {}),
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
  | {
      ok: true;
      sessionToken: string;
      /** Absent for an OAuth authorization request — those mint no session. */
      sessionId?: string;
    }
  | { ok: false; status: 400 | 403 | 404; message: string };

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

  // Delegated subject gate — the authenticated approver must hold
  // `account:act_as` over the account the app would act as. Checked BEFORE the
  // atomic claim so a refusal leaves the request approvable by someone who does.
  const delegation = await gateApprovalDelegation(existing, authenticatedUserId);
  if (!delegation.ok) {
    logger.warn('[AuthSession] Delegated subject refused on bearer approval', {
      authorizeCode: authorizeCode.substring(0, 8) + '...',
      identityUserId: authenticatedUserId,
      reason: delegation.reason,
    });
    return { ok: false, status: 403, message: 'Not authorized to act as the requested account' };
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

  // An OAuth authorization request mints nothing here — its result is the
  // authorization code produced by finalization.
  if (!approvalMintsSession(claimed)) {
    return { ok: true, sessionToken: claimed.sessionToken };
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

/** Options for {@link finalizeOAuthAuthorization}. */
export interface FinalizeOAuthAuthorizationOptions {
  /** The SECRET credential held only by the originating client. */
  sessionToken: string;
}

/**
 * Why a finalization was refused. Logged server-side ONLY — every failure is
 * collapsed to one generic client error so nothing enumerates which precondition
 * failed (RFC 6749 §5.2).
 */
export type FinalizeOAuthRejection =
  | 'not_found'
  | 'wrong_purpose'
  | 'not_authorized'
  | 'expired'
  | 'already_finalized'
  | 'application_unavailable'
  | 'redirect_uri_unregistered'
  | 'delegation_denied'
  | 'issue_failed';

export type FinalizeOAuthOutcome =
  | { ok: true; code: string; redirectUri: string; expiresIn: number }
  | { ok: false; reason: FinalizeOAuthRejection };

/**
 * Turn an APPROVED OAuth-bound `AuthSession` into the standard OAuth result: one
 * short-lived, single-use `AuthCode`. This is where every delivery surface
 * (popup, push, QR, verified app link) converges — there is no second code
 * minter, and no access token is ever handed out to finalize a request.
 *
 * Single-use is structural, not advisory: the code's `_id` is RESERVED by the
 * same atomic `findOneAndUpdate` that spends the session
 * (`finalizedAuthCodeId: null` -> the reserved id, `authorized` -> `consumed`).
 * Two concurrent finalizations cannot both match that filter, so exactly one
 * ever reaches `issueAuthCode`. If minting then fails, the request stays spent
 * and the user restarts — the correct fail-closed direction.
 *
 * Bindings are RE-verified at finalization, never assumed from bind time: the
 * application must still be active, the redirect URI must still be registered,
 * and a delegated subject's `account:act_as` permission must still hold.
 */
export async function finalizeOAuthAuthorization(
  options: FinalizeOAuthAuthorizationOptions
): Promise<FinalizeOAuthOutcome> {
  const { sessionToken } = options;

  const existing = await AuthSession.findOne({ sessionToken });
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  const oauth = resolveOAuthContext(existing);
  if (!oauth) {
    return { ok: false, reason: 'wrong_purpose' };
  }
  if (existing.finalizedAuthCodeId) {
    return { ok: false, reason: 'already_finalized' };
  }
  if (existing.status !== 'authorized') {
    return { ok: false, reason: 'not_authorized' };
  }
  if (existing.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  // WHICH identity approved — recorded at approval time, never client-asserted.
  const identityUserId = existing.authorizedUserId ? existing.authorizedUserId.toString() : '';
  if (!identityUserId) {
    return { ok: false, reason: 'not_authorized' };
  }

  const app = await Application.findOne({ _id: existing.applicationId, status: 'active' });
  if (!app) {
    return { ok: false, reason: 'application_unavailable' };
  }
  if (!isAllowedRedirectUri(app, oauth.redirectUri)) {
    return { ok: false, reason: 'redirect_uri_unregistered' };
  }

  // The code is issued FOR the delegated subject when there is one; the
  // approving identity is recorded alongside it, never merged into it.
  const subjectAccountId = oauth.subjectAccountId ? oauth.subjectAccountId.toString() : '';
  if (subjectAccountId) {
    const delegation = await verifyDelegatedSubject(identityUserId, subjectAccountId);
    if (!delegation.ok) {
      logger.warn('[AuthSession] Delegated subject refused on finalize', {
        identityUserId,
        reason: delegation.reason,
      });
      return { ok: false, reason: 'delegation_denied' };
    }
  }

  // ATOMIC single-use claim: reserve the code id AND spend the request in one
  // update. The loser of a concurrent race matches nothing and mints nothing.
  const codeId = new mongoose.Types.ObjectId();
  const now = new Date();
  const claimed = await AuthSession.findOneAndUpdate(
    {
      _id: existing._id,
      purpose: 'oauth_authorization',
      status: 'authorized',
      finalizedAuthCodeId: null,
    },
    { $set: { finalizedAuthCodeId: codeId, status: 'consumed', consumedAt: now } },
    { new: true }
  );
  if (!claimed) {
    return { ok: false, reason: 'already_finalized' };
  }

  const grantUserId = subjectAccountId || identityUserId;

  try {
    const { code } = await issueAuthCode({
      codeId,
      userId: grantUserId,
      appId: app._id.toString(),
      redirectUri: oauth.redirectUri,
      codeChallenge: oauth.codeChallenge,
      codeChallengeMethod: 'S256',
      scopes: oauth.scopes ?? [],
      ...(subjectAccountId ? { operatedByUserId: identityUserId } : {}),
      // Thread the originating RP device so the token exchange lands on the same
      // DeviceSession the flow started from instead of sprawling a new device.
      ...(existing.deviceId ? { deviceId: existing.deviceId } : {}),
    });

    // Same returning-user consent bookkeeping as `POST /auth/oauth/authorize`:
    // only third-party grants are revocable "Connected apps" entries; trusted
    // apps are auto-approved and never recorded. Best-effort — a bookkeeping
    // failure must never invalidate an already-issued code.
    if (!isTrustedApplication(app)) {
      try {
        await AppGrant.findOneAndUpdate(
          { userId: grantUserId, applicationId: app._id },
          {
            $set: { lastUsedAt: now },
            $addToSet: { scopes: { $each: oauth.scopes ?? [] } },
            $setOnInsert: { firstGrantedAt: now },
          },
          { upsert: true, new: true }
        );
      } catch (error) {
        logger.warn('[AuthSession] Failed to record AppGrant on finalize', {
          applicationId: app._id.toString(),
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('[AuthSession] OAuth authorization finalized', {
      sessionToken: sessionToken.substring(0, 8) + '...',
      applicationId: app._id.toString(),
      identityUserId,
      delegated: Boolean(subjectAccountId),
    });

    return {
      ok: true,
      code,
      redirectUri: oauth.redirectUri,
      expiresIn: Math.floor(AUTH_CODE_TTL_MS / 1000),
    };
  } catch (error) {
    // The request is already spent — fail closed and make the user restart
    // rather than leave a second minting opportunity open.
    logger.error(
      '[AuthSession] Authorization code mint failed after the request was spent',
      error instanceof Error ? error : new Error(String(error)),
      { sessionToken: sessionToken.substring(0, 8) + '...', applicationId: app._id.toString() }
    );
    return { ok: false, reason: 'issue_failed' };
  }
}
