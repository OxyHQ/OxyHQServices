/**
 * Central SSO code controller (Phase A — true cross-domain SSO).
 *
 * Two endpoints back the IdP-centric SSO handoff:
 *
 *   POST /sso/code     — server-to-server, called ONLY by the auth.oxy.so
 *                        worker. Gated by an internal shared secret. Wraps a
 *                        worker-minted session in a single-use opaque code.
 *
 *   POST /sso/exchange — called by the RP browser (cross-origin). Burns the
 *                        code single-use and returns the real session.
 *
 * No new crypto or token format is introduced: the session payload is exactly
 * what the existing FedCM `/fedcm/exchange` / `mintSessionForClient` pipeline
 * produces. This layer only adds an opaque, origin-bound, ≤30s delivery code so
 * a token never travels in a URL.
 */

import * as crypto from 'crypto';
import { Request, Response } from 'express';
import fedcmService from '../services/fedcm.service';
import { mintSsoCode, redeemSsoCode, SsoSessionPayload } from '../services/ssoCode.service';
import { logger } from '../utils/logger';
import { normaliseOrigin } from '../utils/origin';

/** Constant-time string equality (length-tolerant; no early-exit leak). */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against self to keep the comparison cost data-independent, then
    // return false. Length is not itself a secret here.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Validate the internal shared-secret header. Returns true only when
 * `SSO_INTERNAL_SECRET` is configured AND the `X-Oxy-Internal` header matches it
 * in constant time. When the env var is unset we fail closed (the route is
 * effectively disabled) — we never accept an empty/absent secret.
 */
function hasValidInternalSecret(req: Request): boolean {
  const expected = process.env.SSO_INTERNAL_SECRET;
  if (typeof expected !== 'string' || expected.length === 0) {
    logger.error('POST /sso/code called but SSO_INTERNAL_SECRET is not configured');
    return false;
  }
  const provided = req.headers['x-oxy-internal'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  return timingSafeStringEqual(provided, expected);
}

/**
 * Type guard for the worker-supplied session payload. Mirrors the FedCM
 * exchange output shape. Rejects anything missing the load-bearing fields so a
 * malformed body never produces a code that resolves to a half-built session.
 */
function parseSessionPayload(value: unknown): SsoSessionPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  const { sessionId, accessToken, user, expiresAt, authuser } = record;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
  if (typeof user !== 'object' || user === null) return null;

  const userRecord = user as Record<string, unknown>;
  if (typeof userRecord.id !== 'string' || userRecord.id.length === 0) return null;

  // `name` MUST be the structured UserNameResponse with a non-empty
  // `displayName` — the contract the SDK's `userResponseSchema` enforces on
  // redemption. Fail closed: a string `name`, a missing `name`, or an object
  // without a usable `displayName` rejects the whole payload so a session code
  // is never minted without a valid display name (which would log every RP out).
  const nameRecord = userRecord.name;
  if (typeof nameRecord !== 'object' || nameRecord === null || Array.isArray(nameRecord)) {
    return null;
  }
  const displayName = (nameRecord as Record<string, unknown>).displayName;
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return null;
  }

  const normalisedUser: SsoSessionPayload['user'] = {
    id: userRecord.id,
    name: nameRecord as SsoSessionPayload['user']['name'],
  };
  if (typeof userRecord.username === 'string') normalisedUser.username = userRecord.username;
  if (typeof userRecord.email === 'string') normalisedUser.email = userRecord.email;
  if (typeof userRecord.avatar === 'string') normalisedUser.avatar = userRecord.avatar;

  const payload: SsoSessionPayload = {
    sessionId,
    accessToken,
    user: normalisedUser,
  };
  if (typeof expiresAt === 'string') payload.expiresAt = expiresAt;
  if (typeof authuser === 'number' && Number.isFinite(authuser)) payload.authuser = authuser;

  return payload;
}

/**
 * POST /sso/code — mint a single-use SSO code (internal, server-to-server).
 *
 * Auth: the `X-Oxy-Internal` header must equal `SSO_INTERNAL_SECRET`. On any
 * mismatch/absence we return 404 (not 401) so the route's existence is not
 * revealed to the public.
 *
 * Body: `{ session: { sessionId, accessToken, user, expiresAt?, authuser? }, clientOrigin }`.
 * `clientOrigin` is validated against the authoritative FedCM approved-clients
 * allow-list (fail closed → 400) and stored normalised so redemption binds to
 * the same origin.
 */
export async function issueSsoCode(req: Request, res: Response) {
  // Gate FIRST — never leak validation behaviour to an unauthenticated caller.
  if (!hasValidInternalSecret(req)) {
    return res.status(404).json({ message: 'Not found' });
  }

  try {
    const body = req.body as { session?: unknown; clientOrigin?: unknown };

    const sessionPayload = parseSessionPayload(body.session);
    if (!sessionPayload) {
      return res.status(400).json({ message: 'A valid session payload is required' });
    }

    if (typeof body.clientOrigin !== 'string' || body.clientOrigin.length === 0) {
      return res.status(400).json({ message: 'clientOrigin is required' });
    }

    const normalisedOrigin = normaliseOrigin(body.clientOrigin);
    if (!normalisedOrigin) {
      return res.status(400).json({ message: 'clientOrigin is not a valid origin' });
    }

    // Authoritative allow-list check — same source of truth FedCM exchange uses.
    const approved = await fedcmService.isClientApproved(normalisedOrigin);
    if (!approved) {
      logger.warn('SSO code requested for unapproved clientOrigin', { clientOrigin: normalisedOrigin });
      return res.status(400).json({ message: 'clientOrigin is not approved' });
    }

    const { code, expiresInSeconds } = await mintSsoCode(sessionPayload, normalisedOrigin);
    return res.json({ code, expiresInSeconds });
  } catch (error) {
    logger.error('SSO code mint error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * POST /sso/exchange — redeem an SSO code for the real session (RP browser,
 * cross-origin).
 *
 * Burns the code single-use (atomic GETDEL). A missing/expired/already-redeemed
 * code → 410 Gone. The requesting `Origin` MUST match the stored, approved
 * `clientOrigin` → otherwise 403. On success returns the wrapped session.
 *
 * CORS for this route is owned by `ssoExchangeCors` (mounted before the global
 * CORS middleware): it echoes the validated approved origin with
 * `Access-Control-Allow-Credentials: false` (the token rides in the body, never
 * a cookie).
 */
export async function exchangeSsoCode(req: Request, res: Response) {
  try {
    const body = req.body as { code?: unknown };
    if (typeof body.code !== 'string' || body.code.length === 0) {
      return res.status(400).json({ message: 'code is required' });
    }

    // Atomic single-use burn. Missing/expired/replayed → null → 410.
    const redeemed = await redeemSsoCode(body.code);
    if (!redeemed) {
      return res.status(410).json({ message: 'Code is invalid, expired, or already used' });
    }

    // Bind redemption to the requesting RP: the HTTP Origin must match the
    // origin the code was minted for. A missing Origin (non-browser caller) is
    // hostile for a CORS-only endpoint.
    const requestOriginRaw = req.headers.origin;
    if (typeof requestOriginRaw !== 'string' || requestOriginRaw.length === 0) {
      logger.warn('SSO exchange missing Origin header');
      return res.status(403).json({ message: 'Origin mismatch' });
    }
    const requestOrigin = normaliseOrigin(requestOriginRaw);
    if (!requestOrigin || !timingSafeStringEqual(requestOrigin, redeemed.clientOrigin)) {
      logger.warn('SSO exchange Origin does not match code clientOrigin', {
        requestOrigin: requestOrigin ?? requestOriginRaw,
        clientOrigin: redeemed.clientOrigin,
      });
      return res.status(403).json({ message: 'Origin mismatch' });
    }

    const { sessionPayload } = redeemed;
    const response: SsoSessionPayload = {
      accessToken: sessionPayload.accessToken,
      sessionId: sessionPayload.sessionId,
      user: sessionPayload.user,
    };
    if (sessionPayload.expiresAt !== undefined) response.expiresAt = sessionPayload.expiresAt;
    if (sessionPayload.authuser !== undefined) response.authuser = sessionPayload.authuser;

    return res.json(response);
  } catch (error) {
    logger.error('SSO code exchange error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ message: 'Internal server error' });
  }
}
