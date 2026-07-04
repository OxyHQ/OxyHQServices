/**
 * Device-first auth surface — ADDITIVE (auth centralization, wave 1).
 *
 * A single router mounted at `/auth` BEFORE the generic `/auth` mount, housing
 * the new device-first bootstrap + persisted-refresh endpoints:
 *
 *   GET  /auth/device/bootstrap   — top-level cross-apex hop: (re-)plants the
 *                                   `oxy_device` cookie, resolves the active
 *                                   session, and hands back a single-use boot
 *                                   `code` in the `#oxy_boot=…` fragment.
 *   POST /auth/device/web-session — same-site (`*.oxy.so`) fast path: exchanges
 *                                   the `oxy_device` cookie directly for a token
 *                                   bundle, no redirect.
 *   POST /auth/device/exchange    — burn a boot code (origin-bound) for tokens.
 *   POST /auth/refresh-token      — ONE rotating refresh implementation (web +
 *                                   native).
 *   POST /auth/device/token       — issue the native-channel device token.
 *   POST /auth/device/resolve     — X-Oxy-Internal device-set feed for the IdP
 *                                   chooser.
 *
 * The legacy `/sso*`, `/fedcm/*`, `/auth/refresh`, `/auth/refresh-all`,
 * `/auth/session`, and `oxy_rt` cookie machinery are BYTE-UNTOUCHED — everything
 * here is new surface. NO token or deviceId is ever placed in a URL/query/
 * fragment/response-body of these endpoints (the cookie secret ≠ deviceId, the
 * boot code is opaque, and the deviceToken is opaque).
 */

import { Router, Request, Response } from 'express';
import type { DeviceBootFragment, DeviceBootReason } from '@oxyhq/contracts';
import { deviceBootFragmentSchema } from '@oxyhq/contracts';
import { authMiddleware } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { extractTokenFromRequest, decodeToken } from '../middleware/authUtils';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';
import { normaliseOrigin, isLoopbackOrigin } from '../utils/origin';
import { isTrustedOrigin } from '../config/dynamicOriginRegistry';
import { isSameSiteTrustedRequest } from '../utils/sameSite';
import { hasValidInternalSecret } from '../utils/internalSecret';
import { readDeviceCookie, setDeviceCookie } from '../utils/deviceCookie';
import deviceSessionService from '../services/deviceSession.service';
import sessionService from '../services/session.service';
import { issueDeviceToken, NATIVE_ORIGIN } from '../services/deviceToken.service';
import { mintBootCode, redeemBootCode } from '../services/deviceBootCode.service';
import { issueRefreshToken, rotateRefreshToken } from '../services/refreshToken.service';
import { formatUserResponse } from '../utils/userTransform';
import {
  deviceBootstrapQuerySchema,
  deviceExchangeRequestSchema,
  tokenRefreshRequestSchema,
  deviceResolveRequestSchema,
} from '../schemas/deviceAuth.schemas';

const router = Router();

/**
 * The canonical serialized user shape (`formatUserResponse` output). Used
 * locally so response objects carry a precise type without asserting against the
 * contract `UserResponse` (which the serializer's passthrough fields do not
 * cleanly satisfy at the type level); the wire shape matches the contract and is
 * validated by every SDK consumer on input.
 */
type SerializedUser = NonNullable<ReturnType<typeof formatUserResponse>>;

/**
 * The trusted CREDENTIALED lane: first-party / internal / system / official app
 * origins, plus http loopback dev origins (which `isTrustedOrigin` deliberately
 * excludes but the credentialed CORS lane always trusts). Third-party app
 * origins never pass — they can never begin a device-first bootstrap.
 */
function isTrustedLaneOrigin(origin: string): boolean {
  return isTrustedOrigin(origin) || isLoopbackOrigin(origin);
}

/** base64url-encode a JSON-serialisable value (URL-safe, no padding). */
function encodeFragment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * Validate + normalise a bootstrap `return_to`: parseable URL, https (http only
 * for loopback), no embedded credentials, and its origin on the trusted lane.
 * Returns the normalised origin, or null when the target is not eligible.
 */
function resolveReturnTo(returnTo: string): { url: URL; origin: string } | null {
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return null;
  }
  // Never honour a URL that smuggles credentials.
  if (url.username || url.password) return null;

  const loopback = url.protocol === 'http:' && isLoopbackOrigin(url.origin);
  if (url.protocol !== 'https:' && !loopback) return null;

  const origin = normaliseOrigin(url.origin);
  if (!origin) return null;
  if (!isTrustedLaneOrigin(origin)) return null;

  return { url, origin };
}

/**
 * Resolve the device's active session (validated) into `{ sessionId, userId }`,
 * or null when there is no active account or its session is dead. Shared by
 * bootstrap + web-session.
 */
async function resolveActiveSessionRef(
  state: { activeAccountId: string | null; accounts: { accountId: string; sessionId: string }[] } | null,
): Promise<{ sessionId: string; userId: string } | null> {
  if (!state || !state.activeAccountId) return null;
  const active = state.accounts.find((a) => a.accountId === state.activeAccountId);
  if (!active) return null;
  const validated = await sessionService.validateSessionById(active.sessionId, false);
  if (!validated) return null;
  return { sessionId: active.sessionId, userId: state.activeAccountId };
}

/**
 * Build the full token bundle (matches the contract `AuthTokenBundle` wire
 * shape) for a validated session: fresh access token, a NEW rotating
 * refresh-family head, expiry, and the canonical user. Returns null when the
 * session can no longer mint a token or the user is gone.
 */
async function buildTokenBundle(
  sessionId: string,
  userId: string,
): Promise<{
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: SerializedUser;
} | null> {
  const tokenResult = await sessionService.getAccessToken(sessionId);
  if (!tokenResult) return null;

  const resolved = await sessionService.validateSessionById(sessionId, true);
  const user = resolved?.user ? formatUserResponse(resolved.user) : null;
  if (!user) return null;

  const refresh = await issueRefreshToken({ sessionId, userId });

  return {
    sessionId,
    accessToken: tokenResult.accessToken,
    refreshToken: refresh.token,
    expiresAt: tokenResult.expiresAt.toISOString(),
    user,
  };
}

/* -------------------------------------------------------------------------- */
/*  GET /auth/device/bootstrap                                                */
/* -------------------------------------------------------------------------- */

const bootstrapLimiter = rateLimit({
  prefix: 'rl:auth:device:bootstrap:',
  windowMs: 15 * 60 * 1000,
  max: 30,
});

router.get(
  '/device/bootstrap',
  bootstrapLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = deviceBootstrapQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: 'return_to and state are required' });
      return;
    }
    const { return_to: returnTo, state } = parsed.data;

    const target = resolveReturnTo(returnTo);
    if (!target) {
      res.status(400).json({ message: 'return_to is not an allowed target' });
      return;
    }
    const returnToOrigin = target.origin;

    // Resolve (or mint) the device bound to the `oxy_device` cookie.
    const rawCookie = readDeviceCookie(req);
    const existingState = rawCookie ? await deviceSessionService.getStateByCookieKey(rawCookie) : null;

    let deviceId: string;
    let rawCookieKey: string;
    let freshDevice = false;
    if (existingState && rawCookie) {
      deviceId = existingState.deviceId;
      rawCookieKey = rawCookie;
    } else {
      const ensured = await deviceSessionService.ensureDeviceForCookie();
      deviceId = ensured.deviceId;
      rawCookieKey = ensured.rawCookieKey;
      freshDevice = true;
    }

    // Resolve the active session and mint a single-use, origin-bound boot code.
    const activeRef = await resolveActiveSessionRef(existingState);

    // Rotate a fresh web deviceToken on EVERY hop, bound to the return_to origin.
    const deviceToken = await issueDeviceToken({ deviceId, origin: returnToOrigin, channel: 'web' });

    // Build the fragment DISCRIMINATELY so it satisfies the contract's
    // reason-discriminated union: the `session` arm REQUIRES `code`; the
    // signed-out arms (`no_session` / `new_device`) omit the key entirely.
    let fragment: DeviceBootFragment;
    if (activeRef) {
      const minted = await mintBootCode({
        sessionId: activeRef.sessionId,
        userId: activeRef.userId,
        clientOrigin: returnToOrigin,
      });
      fragment = { v: 1, state, reason: 'session', code: minted.code, deviceToken };
    } else {
      fragment = { v: 1, state, reason: freshDevice ? 'new_device' : 'no_session', deviceToken };
    }
    // Guard: never emit a fragment the consumer cannot parse.
    const validFragment = deviceBootFragmentSchema.safeParse(fragment);
    if (!validFragment.success) {
      logger.error('device bootstrap built an invalid fragment', new Error('invalid fragment'));
      res.status(500).json({ message: 'Internal server error' });
      return;
    }

    setDeviceCookie(res, rawCookieKey);
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');

    target.url.hash = `oxy_boot=${encodeFragment(fragment)}`;
    res.redirect(303, target.url.toString());
  }),
);

/* -------------------------------------------------------------------------- */
/*  POST /auth/device/web-session                                             */
/* -------------------------------------------------------------------------- */

const webSessionLimiter = rateLimit({
  prefix: 'rl:auth:device:websession:',
  windowMs: 15 * 60 * 1000,
  max: 60,
});

/**
 * Same-site fast path. Delegates the trusted-lane + registrable-apex (or exact
 * host for IP/single-label) decision to the shared `isSameSiteTrustedRequest`
 * predicate, then returns the normalised origin for the deviceToken binding.
 */
function assertSameSiteApex(req: Request): { ok: true; origin: string } | { ok: false } {
  if (!isSameSiteTrustedRequest(req)) return { ok: false };
  const origin = normaliseOrigin(req.headers.origin as string);
  return origin ? { ok: true, origin } : { ok: false };
}

router.post(
  '/device/web-session',
  webSessionLimiter,
  requireSameSiteOrigin,
  asyncHandler(async (req: Request, res: Response) => {
    const site = assertSameSiteApex(req);
    if (!site.ok) {
      res.status(403).json({ message: 'Origin is not an allowed same-site caller' });
      return;
    }

    const rawCookie = readDeviceCookie(req);
    const existingState = rawCookie ? await deviceSessionService.getStateByCookieKey(rawCookie) : null;

    let deviceId: string;
    let rawCookieKey: string;
    let freshDevice = false;
    if (existingState && rawCookie) {
      deviceId = existingState.deviceId;
      rawCookieKey = rawCookie;
    } else {
      const ensured = await deviceSessionService.ensureDeviceForCookie();
      deviceId = ensured.deviceId;
      rawCookieKey = ensured.rawCookieKey;
      freshDevice = true;
    }

    // Always (re-)plant the cookie with a fresh sliding expiry and issue a fresh
    // web deviceToken bound to the caller origin.
    setDeviceCookie(res, rawCookieKey);
    const deviceToken = await issueDeviceToken({ deviceId, origin: site.origin, channel: 'web' });

    const activeRef = await resolveActiveSessionRef(existingState);
    if (activeRef) {
      const bundle = await buildTokenBundle(activeRef.sessionId, activeRef.userId);
      if (bundle) {
        res.json({ data: { reason: 'session' as const, session: bundle, deviceToken } });
        return;
      }
    }

    const reason: DeviceBootReason = freshDevice ? 'new_device' : 'no_session';
    res.json({ data: { reason, deviceToken } });
  }),
);

/* -------------------------------------------------------------------------- */
/*  POST /auth/device/exchange                                                */
/* -------------------------------------------------------------------------- */

const exchangeLimiter = rateLimit({
  prefix: 'rl:auth:device:exchange:',
  windowMs: 60 * 1000,
  max: 10,
});

router.post(
  '/device/exchange',
  exchangeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = deviceExchangeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'code is required' });
      return;
    }

    // Atomic single-use burn. Missing / replayed / expired → 410.
    const record = await redeemBootCode(parsed.data.code);
    if (!record) {
      res.status(410).json({ message: 'Code is invalid, expired, or already used' });
      return;
    }

    // Bind redemption to the RP that the code was minted for.
    const originRaw = req.headers.origin;
    const origin = typeof originRaw === 'string' ? normaliseOrigin(originRaw) : null;
    if (!origin || origin !== record.clientOrigin) {
      logger.warn('device exchange Origin does not match code clientOrigin');
      res.status(403).json({ message: 'Origin mismatch' });
      return;
    }

    const bundle = await buildTokenBundle(record.sessionId, record.userId);
    if (!bundle) {
      // The session died between mint and exchange — treat as a spent code.
      res.status(410).json({ message: 'Code is invalid, expired, or already used' });
      return;
    }

    res.json(bundle);
  }),
);

/* -------------------------------------------------------------------------- */
/*  POST /auth/refresh-token                                                  */
/* -------------------------------------------------------------------------- */

const refreshTokenLimiter = rateLimit({
  prefix: 'rl:auth:refresh-token:',
  windowMs: 60 * 1000,
  max: 60,
});

router.post(
  '/refresh-token',
  refreshTokenLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = tokenRefreshRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    // Rotate (single-use claim + reuse-detection family revoke). All failures →
    // uniform 401 so a caller cannot distinguish not_found/expired/reuse.
    const outcome = await rotateRefreshToken(parsed.data.refreshToken);
    if (!outcome.ok) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    const tokenResult = await sessionService.getAccessToken(outcome.sessionId);
    if (!tokenResult) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    res.json({
      accessToken: tokenResult.accessToken,
      refreshToken: outcome.token,
      expiresAt: tokenResult.expiresAt.toISOString(),
      sessionId: outcome.sessionId,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/*  POST /auth/device/token                                                   */
/* -------------------------------------------------------------------------- */

const deviceTokenLimiter = rateLimit({
  prefix: 'rl:auth:device:token:',
  windowMs: 60 * 60 * 1000,
  max: 10,
});

router.post(
  '/device/token',
  deviceTokenLimiter,
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    // Derive the deviceId from the caller's validated bearer — never the body.
    const token = extractTokenFromRequest(req);
    const decoded = token ? decodeToken(token) : null;
    const deviceId = decoded?.deviceId;
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      res.status(400).json({ message: 'Bearer token has no device binding' });
      return;
    }

    const deviceToken = await issueDeviceToken({ deviceId, origin: NATIVE_ORIGIN, channel: 'native' });
    res.json({ deviceToken });
  }),
);

/* -------------------------------------------------------------------------- */
/*  POST /auth/device/resolve  (X-Oxy-Internal — IdP chooser feed)            */
/* -------------------------------------------------------------------------- */

const deviceResolveLimiter = rateLimit({
  prefix: 'rl:auth:device:resolve:',
  windowMs: 60 * 1000,
  max: 120,
});

router.post(
  '/device/resolve',
  deviceResolveLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    // Gate FIRST — 404 (not 401) so the route's existence is not revealed.
    if (!hasValidInternalSecret(req)) {
      res.status(404).json({ message: 'Not found' });
      return;
    }

    const parsed = deviceResolveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'deviceKey is required' });
      return;
    }

    const state = await deviceSessionService.getStateByCookieKey(parsed.data.deviceKey);
    if (!state) {
      res.json({ activeAccountId: null, accounts: [] });
      return;
    }

    type ResolvedAccount = {
      user: SerializedUser;
      sessionId: string;
      accessToken: string;
      expiresAt: string;
    };
    // Resolve every account in PARALLEL, each isolated in its own try/catch so a
    // single dead/corrupt session is SKIPPED (returns null) rather than 500-ing
    // the whole chooser feed.
    const resolved = await Promise.all(
      state.accounts.map(async (account): Promise<ResolvedAccount | null> => {
        try {
          const validated = await sessionService.validateSessionById(account.sessionId, true);
          if (!validated) return null;
          const tokenResult = await sessionService.getAccessToken(account.sessionId);
          if (!tokenResult) return null;
          const user = validated.user ? formatUserResponse(validated.user) : null;
          if (!user) return null;
          return {
            user,
            sessionId: account.sessionId,
            accessToken: tokenResult.accessToken,
            expiresAt: tokenResult.expiresAt.toISOString(),
          };
        } catch (error) {
          logger.warn('device resolve: skipping unresolvable account', {
            sessionId: account.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      }),
    );
    const accounts = resolved.filter((a): a is ResolvedAccount => a !== null);

    // The active account survives only if it minted a live token above.
    const activeAlive =
      state.activeAccountId && accounts.some((a) => a.user.id === state.activeAccountId)
        ? state.activeAccountId
        : null;

    res.json({ activeAccountId: activeAlive, accounts });
  }),
);

export default router;
