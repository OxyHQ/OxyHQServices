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
import jwt from 'jsonwebtoken';
import { registrableApex, SSO_CALLBACK_PATH } from '@oxyhq/core/server';
import fedcmService from '../services/fedcm.service';
import { mintSsoCode, redeemSsoCode, SsoSessionPayload } from '../services/ssoCode.service';
import type { AuthRequest } from '../middleware/auth';
import { ssoEstablishTokenSchema } from '../schemas/sso.schemas';
import { logger } from '../utils/logger';
import { normaliseOrigin } from '../utils/origin';

/**
 * Establish-token claim contract — MUST match the IdP `/sso/establish` verifier
 * (`packages/auth/server/index.ts`: `ESTABLISH_TOKEN_PURPOSE` /
 * `ESTABLISH_TOKEN_LIFETIME`). The IdP re-verifies the HS256 signature (same
 * `FEDCM_TOKEN_SECRET`), that `purpose` is exactly this value, that it has not
 * expired, and that the bound `host` equals the serving host. Never widen the
 * lifetime or weaken these claims.
 */
const ESTABLISH_TOKEN_PURPOSE = 'sso-establish';
const ESTABLISH_TOKEN_LIFETIME_SECONDS = 60;

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

  // `name` MUST be the structured UserNameResponse object — the contract the
  // SDK's `userResponseSchema` enforces on redemption. Fail closed on a string
  // or missing `name` (which would silently drop the structured shape the RP
  // parses). `name.displayName` is OPTIONAL (contracts 0.6.0): present only when
  // the user has a real name and absent for username-only accounts; RP clients
  // fall back to the handle, so we do NOT require it here. A present
  // `displayName` must still be a string.
  const nameRecord = userRecord.name;
  if (typeof nameRecord !== 'object' || nameRecord === null || Array.isArray(nameRecord)) {
    return null;
  }
  const displayName = (nameRecord as Record<string, unknown>).displayName;
  if (typeof displayName !== 'undefined' && typeof displayName !== 'string') {
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

/**
 * POST /sso/establish-token — mint a fully-formed `/sso/establish` URL for the
 * caller's OWN session, bound to an approved RP origin.
 *
 * Bearer-authenticated (mounted behind `authMiddleware`). Closes the last
 * durable-session gap on web: a device-flow ("Sign in with Oxy" QR) claim plants
 * only in-memory tokens — no `fedcm_session` cookie is ever planted at the IdP,
 * so a reload cannot re-mint a token. After such a claim the RP calls this to get
 * a short-lived, host+audience-bound establish-token wrapped in the existing
 * `/sso/establish` URL; navigating to it plants the durable first-party cookie.
 *
 * Security (fails CLOSED at every step):
 *  - The session id ALWAYS comes from the caller's bearer (`sessionId` claim) —
 *    NEVER from the body. A client can only establish for its own session.
 *  - `origin` MUST be an approved client origin (same authoritative source as
 *    `/fedcm/clients/approved`, cache-respecting) AND, when the request carries
 *    an `Origin` header (it always does from a browser CORS call), MUST equal it.
 *  - `apexAuthHost` is derived server-side from the origin's registrable apex
 *    (`auth.<apex>`, `oxy.so` family → `auth.oxy.so`) — never taken from input.
 *  - The FedCM grant for `(user, origin)` is recorded BEFORE responding: the
 *    device-flow is an active sign-in to this RP, and `/sso/establish` re-checks
 *    the per-user grant before planting the durable cookie. Without this the hop
 *    would bounce `none` and never plant the cookie.
 *  - When `FEDCM_TOKEN_SECRET` is unset the feature is disabled (501).
 */
export async function issueEstablishToken(req: AuthRequest, res: Response) {
  const secret = process.env.FEDCM_TOKEN_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    logger.error('POST /sso/establish-token called but FEDCM_TOKEN_SECRET is not configured');
    return res.status(501).json({ message: 'Not implemented' });
  }

  try {
    // 1. Caller identity — user from the validated session, session id from the
    //    bearer's `sessionId` claim. NEVER from the body. `authMiddleware` has
    //    already verified the token (signature + live session) upstream, so we
    //    decode the trusted bearer here only to read its `sessionId` claim.
    const userId = req.user?.id;
    if (typeof userId !== 'string' || userId.length === 0) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const decoded = token ? jwt.decode(token) : null;
    const sessionId =
      decoded && typeof decoded === 'object'
        ? (decoded as { sessionId?: unknown }).sessionId
        : undefined;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return res.status(401).json({ message: 'Session-based token required' });
    }

    // 2. Validate the body (origin + opaque, length-capped state).
    const parsed = ssoEstablishTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'origin and state are required' });
    }
    const normalisedOrigin = normaliseOrigin(parsed.data.origin);
    if (!normalisedOrigin) {
      return res.status(400).json({ message: 'origin is not a valid origin' });
    }

    // 3. When present (always, for a browser CORS call) the Origin header MUST
    //    match the target origin — a page can only establish for itself.
    const originHeader = req.headers.origin;
    if (typeof originHeader === 'string' && originHeader.length > 0) {
      const normalisedHeader = normaliseOrigin(originHeader);
      if (!normalisedHeader || normalisedHeader !== normalisedOrigin) {
        logger.warn('SSO establish-token Origin header does not match target origin', {
          originHeader,
          target: normalisedOrigin,
        });
        return res.status(403).json({ message: 'Origin mismatch' });
      }
    }

    // 4. Authoritative approved-clients allow-list (cache-respecting — same
    //    source `/fedcm/clients/approved` serves). Fail closed → 403.
    const approvedOrigins = await fedcmService.getApprovedClientOrigins();
    const approvedSet = new Set(
      approvedOrigins
        .map((origin) => normaliseOrigin(origin))
        .filter((origin): origin is string => origin !== null),
    );
    if (!approvedSet.has(normalisedOrigin)) {
      logger.warn('SSO establish-token requested for unapproved origin', { origin: normalisedOrigin });
      return res.status(403).json({ message: 'origin is not an approved client' });
    }

    // 5. Derive the per-apex IdP host server-side. Unlike the central `/sso`
    //    hop (which skips this for `oxy.so` because auth.oxy.so already carries a
    //    central cookie), a device-flow claim has NO cookie ANYWHERE — so even
    //    `oxy.so` clients need the hop to `auth.oxy.so` to plant `fedcm_session`.
    let hostname: string;
    try {
      hostname = new URL(normalisedOrigin).hostname.toLowerCase();
    } catch {
      return res.status(400).json({ message: 'origin is not a valid origin' });
    }
    const apex = registrableApex(hostname);
    if (!apex) {
      return res.status(400).json({ message: 'origin has no registrable apex' });
    }
    const apexAuthHost = `auth.${apex}`;

    // 6. Record the FedCM grant for (user, origin) BEFORE responding: the
    //    device-flow is an active sign-in to this approved RP, and
    //    `/sso/establish` re-checks this grant before planting the durable
    //    cookie. Awaited (not best-effort) so the grant is durable before the
    //    client navigates to `/sso/establish`.
    await fedcmService.recordGrant(userId, normalisedOrigin);

    // 7. Mint the HS256 establish-token with the EXACT claim shape the IdP
    //    verifies, exp = now + 60s. `jwt.sign` adds `iat` + `exp`.
    const establishToken = jwt.sign(
      {
        sub: sessionId,
        aud: normalisedOrigin,
        host: apexAuthHost,
        purpose: ESTABLISH_TOKEN_PURPOSE,
      },
      secret,
      { algorithm: 'HS256', expiresIn: ESTABLISH_TOKEN_LIFETIME_SECONDS },
    );

    // 8. Build the fully-formed establish URL the client navigates to.
    const establishUrl = new URL(`https://${apexAuthHost}/sso/establish`);
    establishUrl.searchParams.set('et', establishToken);
    establishUrl.searchParams.set('return_to', `${normalisedOrigin}${SSO_CALLBACK_PATH}`);
    establishUrl.searchParams.set('state', parsed.data.state);

    return res.json({ establishUrl: establishUrl.toString() });
  } catch (error) {
    logger.error('SSO establish-token error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ message: 'Internal server error' });
  }
}
