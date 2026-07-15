/**
 * WebAuthn / passkey ceremony routes (Fase B/b1).
 *
 * Four endpoints implement the two WebAuthn ceremonies:
 *   POST /webauthn/register/options   — begin registration (link OR signup)
 *   POST /webauthn/register/verify    — finish registration
 *   POST /webauthn/login/options      — begin authentication
 *   POST /webauthn/login/verify       — finish authentication
 *
 * All four read an OPTIONAL bearer (like `sessionDevice.ts`'s
 * `resolveCallerDeviceId`) rather than mounting `authMiddleware`: a bearer means
 * "link a passkey to THIS signed-in account", its absence means "prospective
 * signup / usernameless login".
 *
 * CORE PRINCIPLE — reuse the session mint. The verify handlers do ONLY: verify
 * the assertion via `@simplewebauthn/server` → resolve the userId → run the exact
 * same finalisation the password/2FA paths run (`sessionService.createSession` →
 * `buildSessionAuthResponse` → `finalizeDeviceLogin`) → return the same
 * `AuthSuccess` shape as `POST /auth/verify`. No session/device-secret minting is
 * reinvented here.
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { decodeClientDataJSON, isoUint8Array } from '@simplewebauthn/server/helpers';
import {
  webauthnRegisterOptionsRequestSchema,
  webauthnLoginOptionsRequestSchema,
  webauthnRegisterVerifyRequestSchema,
  webauthnLoginVerifyRequestSchema,
} from '@oxyhq/contracts';
import { User, buildAuthMethod } from '../models/User';
import WebauthnCredential from '../models/WebauthnCredential';
import WebauthnChallenge from '../models/WebauthnChallenge';
import Notification from '../models/Notification';
import { extractTokenFromRequest, decodeToken } from '../middleware/authUtils';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, ConflictError, UnauthorizedError, InternalServerError } from '../utils/error';
import { logger } from '../utils/logger';
import userCache from '../utils/userCache';
import { isOxyApexOrigin } from '../utils/origin';
import { getWebauthnRpId } from '../config/env';
import { normalizeUsername, USERNAME_PATTERN, INVALID_USERNAME_MESSAGE } from '../utils/username';
import { exactCaseInsensitiveUsernameRegex } from '../utils/resolveUserIdentifier';
import { buildSessionAuthResponse, sessionCreateOptionsFromBody } from '../controllers/session.controller';
import sessionService from '../services/session.service';
import { finalizeDeviceLogin } from '../services/deviceLogin.service';
import securityActivityService from '../services/securityActivityService';
import type { SessionAuthResponse } from '../types/session';
import type { UserLike } from '../utils/userTransform';

const router = Router();

const RP_NAME = 'Oxy';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CREDENTIAL_NAME = 'Passkey';

const registerOptionsLimiter = rateLimit({ prefix: 'rl:webauthn:register-options:', windowMs: 60_000, max: 20 });
const registerVerifyLimiter = rateLimit({ prefix: 'rl:webauthn:register-verify:', windowMs: 60_000, max: 10 });
const loginOptionsLimiter = rateLimit({ prefix: 'rl:webauthn:login-options:', windowMs: 60_000, max: 30 });
const loginVerifyLimiter = rateLimit({ prefix: 'rl:webauthn:login-verify:', windowMs: 60_000, max: 10 });

/** The device-session options every first-party sign-in body carries. */
interface DeviceEnvelope {
  deviceName?: string;
  deviceFingerprint?: string;
  deviceId?: string;
}

/**
 * Resolve the authenticated userId from an OPTIONAL bearer, mirroring
 * `sessionDevice.ts`'s `resolveCallerDeviceId`: decode the access JWT and read
 * its `userId` claim. Returns null when there is no valid `access` bearer — the
 * caller then treats the request as unauthenticated (signup / usernameless).
 */
function resolveOptionalBearerUserId(req: Request): string | null {
  const token = extractTokenFromRequest(req);
  const decoded = token ? decodeToken(token) : null;
  if (!decoded || decoded.type !== 'access') {
    return null;
  }
  return typeof decoded.userId === 'string' && decoded.userId.length > 0 ? decoded.userId : null;
}

/**
 * Pull the browser ceremony response out of the raw request body. The outer Oxy
 * envelope is validated by Zod separately; the `response` object is validated by
 * `@simplewebauthn/server`, so here we only assert it is present and object-shaped.
 */
function readCeremonyResponse<T>(body: unknown): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('WebAuthn ceremony response is required');
  }
  const response = (body as Record<string, unknown>).response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new BadRequestError('WebAuthn ceremony response is required');
  }
  return response as T;
}

/**
 * Decode the ceremony's `clientDataJSON` and return the origin (validated to be
 * an Oxy apex origin) plus the challenge the authenticator signed. The origin
 * gate is the WebAuthn `expectedOrigin` allow-set: `@simplewebauthn/server`'s
 * `expectedOrigin` only accepts a concrete string/array, not a predicate, so we
 * validate the reported origin against `isOxyApexOrigin` here and then pass that
 * exact origin back in — the security boundary is this gate.
 */
function decodeAndGuardClientData(clientDataJSON: string): { origin: string; challenge: string } {
  let clientData: { origin: string; challenge: string };
  try {
    clientData = decodeClientDataJSON(clientDataJSON);
  } catch {
    throw new BadRequestError('Malformed WebAuthn clientDataJSON');
  }
  if (!isOxyApexOrigin(clientData.origin)) {
    throw new BadRequestError('WebAuthn ceremony origin is not allowed');
  }
  return { origin: clientData.origin, challenge: clientData.challenge };
}

/**
 * Atomically burn the ceremony's stored challenge. A single `findOneAndUpdate`
 * flips `used` only if the row is still unused and unexpired — a burned/expired/
 * unknown challenge returns null so the ceremony is rejected (no replay). `match`
 * additionally binds the challenge to its intended flow (a linking challenge to
 * its user, a signup challenge to no user) so one flow's challenge cannot be
 * redirected into another.
 */
async function burnChallenge(
  challenge: string,
  type: 'registration' | 'authentication',
  match: Record<string, unknown>,
): Promise<boolean> {
  const burned = await WebauthnChallenge.findOneAndUpdate(
    { challenge, type, used: false, expiresAt: { $gt: new Date() }, ...match },
    { $set: { used: true } },
    { new: false },
  ).lean();
  return burned !== null;
}

/**
 * The shared session-mint finalisation. Identical to the `/auth/signup` /
 * `/auth/verify` tail: create the session, format the standard auth response,
 * register the session into its device set + mint the rotating `deviceSecret`,
 * and best-effort log the sign-in. Produces the SAME `AuthSuccess` shape as
 * `POST /auth/verify`.
 */
async function mintWebauthnSession(
  req: Request,
  res: Response,
  user: UserLike & { _id: { toString(): string } },
  envelope: DeviceEnvelope,
): Promise<void> {
  const userId = user._id.toString();
  const session = await sessionService.createSession(
    userId,
    req,
    sessionCreateOptionsFromBody(envelope),
  );

  const baseResponse = buildSessionAuthResponse(session, user);
  if (!baseResponse) {
    throw new InternalServerError('Failed to format user data');
  }
  const response: SessionAuthResponse & { deviceSecret?: string } = baseResponse;

  const deviceExtras = await finalizeDeviceLogin({ session, userId });
  if (deviceExtras.deviceSecret) {
    response.deviceSecret = deviceExtras.deviceSecret;
  }

  try {
    await securityActivityService.logSignIn(userId, req, session.deviceId, {
      deviceName: envelope.deviceName || session.deviceInfo?.deviceName,
      deviceType: session.deviceInfo?.deviceType,
      platform: session.deviceInfo?.platform,
    });
  } catch (error) {
    logger.error(
      'Failed to log security event for webauthn sign-in',
      error instanceof Error ? error : new Error(String(error)),
      { component: 'webauthn', method: 'mintWebauthnSession', userId },
    );
  }

  res.json(response);
}

/**
 * POST /webauthn/register/options
 *
 * Bearer → link a passkey to the signed-in account (excludes existing passkeys).
 * No bearer → prospective signup: validate the requested username is available
 * WITHOUT creating the user yet (a throwaway userID handle is used for the
 * ceremony). Either way the returned `challenge` is persisted as a
 * `registration` challenge and burned exactly once at verify time.
 */
router.post(
  '/register/options',
  registerOptionsLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = webauthnRegisterOptionsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const rpID = getWebauthnRpId();
    const bearerUserId = resolveOptionalBearerUserId(req);

    let userName: string;
    let userHandle: string;
    let challengeUserId: string | undefined;
    let excludeCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];

    if (bearerUserId) {
      // Linking branch: the signed-in account adds another passkey.
      const user = await User.findById(bearerUserId).select('username').lean();
      if (!user) {
        throw new UnauthorizedError('User not found');
      }
      userName = user.username || bearerUserId;
      userHandle = bearerUserId;
      challengeUserId = bearerUserId;

      const existing = await WebauthnCredential.find({ userId: bearerUserId })
        .select('credentialID transports')
        .lean();
      excludeCredentials = existing.map((cred) => ({
        id: cred.credentialID,
        transports: cred.transports as AuthenticatorTransportFuture[] | undefined,
      }));
    } else {
      // Signup branch: validate username availability but DON'T create the user.
      const requestedUsername = parsed.data.username;
      if (!requestedUsername) {
        throw new BadRequestError('username is required to register a new account');
      }
      const normalizedUsername = normalizeUsername(requestedUsername);
      if (!USERNAME_PATTERN.test(normalizedUsername)) {
        throw new BadRequestError(INVALID_USERNAME_MESSAGE);
      }
      const taken = await User.findOne({ username: exactCaseInsensitiveUsernameRegex(normalizedUsername) })
        .select('_id')
        .lean();
      if (taken) {
        throw new ConflictError('Username already taken');
      }
      userName = normalizedUsername;
      // Throwaway per-ceremony handle: the real account id does not exist yet and
      // the credential is resolved by its own id at login, so this is opaque.
      userHandle = crypto.randomUUID();
      challengeUserId = undefined;
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName,
      userID: isoUint8Array.fromUTF8String(userHandle),
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    await WebauthnChallenge.create({
      challenge: options.challenge,
      type: 'registration',
      ...(challengeUserId ? { userId: challengeUserId } : {}),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      used: false,
    });

    res.json(options);
  }),
);

/**
 * POST /webauthn/register/verify
 *
 * Verifies the attestation, atomically burns the matching `registration`
 * challenge, then either LINKS the passkey to the bearer's account (returns
 * `{ success: true }`) or, for a signup, CREATES the account + credential and
 * runs the shared session mint (returns the `/auth/verify` `AuthSuccess` shape).
 */
router.post(
  '/register/verify',
  registerVerifyLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedEnvelope = webauthnRegisterVerifyRequestSchema.safeParse(req.body);
    if (!parsedEnvelope.success) {
      throw new BadRequestError('Invalid request body');
    }
    const envelope = parsedEnvelope.data;
    const response = readCeremonyResponse<RegistrationResponseJSON>(req.body);

    const rpID = getWebauthnRpId();
    const bearerUserId = resolveOptionalBearerUserId(req);

    const { origin, challenge } = decodeAndGuardClientData(response.response.clientDataJSON);

    // Bind the challenge to its flow: a linking challenge to its user, a signup
    // challenge to no user (`{ userId: null }` also matches a missing field).
    const burned = await burnChallenge(challenge, 'registration', {
      userId: bearerUserId ?? null,
    });
    if (!burned) {
      throw new UnauthorizedError('Invalid or expired registration challenge');
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      logger.warn('webauthn register verification threw', {
        component: 'webauthn',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestError('Passkey registration could not be verified');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestError('Passkey registration could not be verified');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const credentialName = envelope.deviceName?.trim() || DEFAULT_CREDENTIAL_NAME;

    if (bearerUserId) {
      // ---- Linking branch --------------------------------------------------
      const user = await User.findById(bearerUserId);
      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      try {
        await WebauthnCredential.create({
          userId: user._id,
          credentialID: credential.id,
          credentialPublicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          name: credentialName,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictError('This passkey is already registered');
        }
        throw error;
      }

      if (!user.authMethods) {
        user.authMethods = [];
      }
      user.authMethods.push(buildAuthMethod('webauthn', { credentialID: credential.id, name: credentialName }));
      await user.save();
      userCache.invalidate(user._id.toString());

      res.json({ success: true, message: 'Passkey registered successfully' });
      return;
    }

    // ---- Signup branch -----------------------------------------------------
    const requestedUsername = envelope.username;
    if (!requestedUsername) {
      throw new BadRequestError('username is required to register a new account');
    }
    const normalizedUsername = normalizeUsername(requestedUsername);
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      throw new BadRequestError(INVALID_USERNAME_MESSAGE);
    }
    const taken = await User.findOne({ username: exactCaseInsensitiveUsernameRegex(normalizedUsername) })
      .select('_id')
      .lean();
    if (taken) {
      throw new ConflictError('Username already taken');
    }

    const user = new User({
      username: normalizedUsername,
      authMethods: [buildAuthMethod('webauthn', { credentialID: credential.id, name: credentialName })],
    });
    try {
      await user.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictError('Username already taken');
      }
      throw error;
    }

    try {
      await WebauthnCredential.create({
        userId: user._id,
        credentialID: credential.id,
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: credentialName,
      });
    } catch (error) {
      // Roll back the just-created account so a failed credential insert never
      // orphans a username with no usable auth method.
      try {
        await User.findByIdAndDelete(user._id);
      } catch (cleanupError) {
        logger.error(
          'Failed to roll back user after webauthn credential insert failure',
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          { component: 'webauthn', method: 'register/verify', userId: user._id.toString() },
        );
      }
      if (isDuplicateKeyError(error)) {
        throw new ConflictError('This passkey is already registered');
      }
      throw error;
    }

    // Welcome notification — best-effort, mirrors SessionController.signUp.
    try {
      await new Notification({
        recipientId: user._id,
        actorId: user._id,
        type: 'welcome',
        entityId: user._id,
        entityType: 'profile',
        read: false,
      }).save();
    } catch (notificationError) {
      logger.error(
        'Failed to create welcome notification during webauthn signup',
        notificationError instanceof Error ? notificationError : new Error(String(notificationError)),
        { component: 'webauthn', method: 'register/verify', userId: user._id.toString() },
      );
    }

    await mintWebauthnSession(req, res, user, envelope);
  }),
);

/**
 * POST /webauthn/login/options
 *
 * ALWAYS discoverable-credential (usernameless) login: the allow-list is empty
 * regardless of any supplied `username`, and no user lookup is performed. Emitting
 * a user's `credentialID`s (a non-empty allow-list) — or even branching the
 * response/timing on whether a username resolves — would leak account existence
 * and let an unauthenticated caller enumerate a user's passkeys, so neither is
 * done. The authenticator returns the credentialID at verify time, which is where
 * the user is resolved. The challenge carries no `userId` (discoverable flow).
 */
router.post(
  '/login/options',
  loginOptionsLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = webauthnLoginOptionsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const rpID = getWebauthnRpId();

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [],
      userVerification: 'required',
    });

    await WebauthnChallenge.create({
      challenge: options.challenge,
      type: 'authentication',
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      used: false,
    });

    res.json(options);
  }),
);

/**
 * POST /webauthn/login/verify
 *
 * Resolves the credential by its public id, atomically burns the matching
 * `authentication` challenge, verifies the assertion, enforces the signature
 * counter (rejecting a genuine regression), persists the new counter, and runs
 * the shared session mint — returning the SAME `AuthSuccess` shape as
 * `POST /auth/verify`.
 */
router.post(
  '/login/verify',
  loginVerifyLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsedEnvelope = webauthnLoginVerifyRequestSchema.safeParse(req.body);
    if (!parsedEnvelope.success) {
      throw new BadRequestError('Invalid request body');
    }
    const envelope = parsedEnvelope.data;
    const response = readCeremonyResponse<AuthenticationResponseJSON>(req.body);

    const rpID = getWebauthnRpId();

    // Resolve the credential by its PUBLIC base64url id (plain equality).
    const credential = await WebauthnCredential.findOne({ credentialID: response.id });
    if (!credential) {
      throw new UnauthorizedError('Unknown passkey');
    }

    const { origin, challenge } = decodeAndGuardClientData(response.response.clientDataJSON);

    // Burn the challenge. A username-first challenge carries the account id; it
    // must match the credential's owner. A discoverable challenge carries none
    // (`{ userId: null }` matches the missing field).
    const owner = credential.userId.toString();
    const usernameFirstBurned = await burnChallenge(challenge, 'authentication', { userId: owner });
    const discoverableBurned = usernameFirstBurned
      ? false
      : await burnChallenge(challenge, 'authentication', { userId: null });
    if (!usernameFirstBurned && !discoverableBurned) {
      throw new UnauthorizedError('Invalid or expired authentication challenge');
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: credential.credentialID,
          publicKey: new Uint8Array(credential.credentialPublicKey),
          counter: credential.counter,
          transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
        },
      });
    } catch (error) {
      logger.warn('webauthn authentication verification threw', {
        component: 'webauthn',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new UnauthorizedError('Passkey authentication could not be verified');
    }

    if (!verification.verified) {
      throw new UnauthorizedError('Passkey authentication could not be verified');
    }

    const { newCounter } = verification.authenticationInfo;
    // Counter regression = replay/cloned authenticator. `newCounter === 0` is NOT
    // a regression: platform authenticators keep the counter at 0 and never
    // increment, so a stored 0 and a fresh 0 are legitimate.
    if (newCounter !== 0 && newCounter <= credential.counter) {
      try {
        await securityActivityService.logSuspiciousActivity(
          owner,
          'WebAuthn signature counter regression detected — possible cloned authenticator',
          { credentialId: credential.credentialID, storedCounter: credential.counter, presentedCounter: newCounter },
          req,
        );
      } catch (error) {
        logger.error(
          'Failed to log webauthn counter-regression security event',
          error instanceof Error ? error : new Error(String(error)),
          { component: 'webauthn', method: 'login/verify', userId: owner },
        );
      }
      throw new UnauthorizedError('Passkey authentication rejected');
    }

    credential.counter = newCounter;
    credential.lastUsedAt = new Date();
    await credential.save();

    const user = await User.findById(owner);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    await mintWebauthnSession(req, res, user, envelope);
  }),
);

/**
 * Narrow a thrown value to a MongoDB duplicate-key (E11000) error without an
 * `any` cast — used to translate a unique-index collision into a 409.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export default router;
