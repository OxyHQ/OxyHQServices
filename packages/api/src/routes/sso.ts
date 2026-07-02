import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from '../middleware/rateLimiter';
import { issueSsoCode, exchangeSsoCode, issueEstablishToken } from '../controllers/sso.controller';
import { authMiddleware } from '../middleware/auth';
import fedcmService from '../services/fedcm.service';
import { normaliseOrigin } from '../utils/origin';

const router = express.Router();

/**
 * Dedicated CORS handler for `POST /sso/exchange`.
 *
 * Mounted BEFORE the global CORS middleware (see server.ts) so it fully owns
 * the response for this path: the exchange must echo the validated APPROVED
 * client origin with `Access-Control-Allow-Credentials: false` (the session
 * token is delivered in the JSON body — there is no cookie), which differs from
 * the credentialed apex-only policy of the global middleware.
 *
 * The Origin is echoed only when it normalises cleanly AND is on the
 * authoritative FedCM approved-clients allow-list. The OPTIONS preflight is
 * answered here (204) so the request never falls through to the global CORS.
 */
export async function ssoExchangeCors(req: Request, res: Response, next: NextFunction): Promise<void> {
  const originHeader = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (typeof originHeader === 'string' && originHeader.length > 0) {
    const normalised = normaliseOrigin(originHeader);
    if (normalised && (await fedcmService.isClientApproved(normalised))) {
      // Echo the raw request origin (browsers send lowercase scheme+host; the
      // normalised form matches what the allow-list stored).
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      res.setHeader('Access-Control-Allow-Credentials', 'false');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

/**
 * Dedicated CORS handler for `POST /sso/establish-token`.
 *
 * Mounted BEFORE the global CORS middleware (see server.ts) so it fully owns the
 * response for this path. Unlike `/sso/exchange` this endpoint is
 * BEARER-authenticated (the token rides in the `Authorization` header, not a
 * cookie), so it echoes the validated approved origin with
 * `Access-Control-Allow-Credentials: false` and additionally allows the
 * `Authorization` request header. Cross-apex RP origins (`mention.earth`, …) are
 * NOT covered by the apex-scoped global policy, which is exactly why this
 * dedicated handler — echoing any origin on the FedCM approved-clients allow-list
 * — is required. The OPTIONS preflight is answered here (204).
 */
export async function ssoEstablishTokenCors(req: Request, res: Response, next: NextFunction): Promise<void> {
  const originHeader = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (typeof originHeader === 'string' && originHeader.length > 0) {
    const normalised = normaliseOrigin(originHeader);
    if (normalised && (await fedcmService.isClientApproved(normalised))) {
      res.setHeader('Access-Control-Allow-Origin', originHeader);
      res.setHeader('Access-Control-Allow-Credentials', 'false');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

// Internal mint endpoint: cheap, but cap throughput so a leaked internal secret
// cannot be used to flood the code store. Keyed per-IP via the default keyGen.
const codeLimiter = rateLimit({
  prefix: 'rl:sso:code:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 600 : 120,
});

// Public exchange endpoint: a code is single-use and bound to one origin, but
// rate-limit anyway to blunt brute-force enumeration of the 256-bit code space.
const exchangeLimiter = rateLimit({
  prefix: 'rl:sso:exchange:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 600 : 120,
});

// Bearer-authenticated establish-token mint. Called once per web device-flow
// sign-in, so a tight cap is fine — it blunts abuse of a leaked bearer.
const establishTokenLimiter = rateLimit({
  prefix: 'rl:sso:establish-token:',
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 600 : 60,
});

/**
 * @openapi
 * /sso/code:
 *   post:
 *     tags:
 *       - Federation
 *     security: []
 *     summary: Mint a single-use SSO code (internal, server-to-server)
 *     description: >
 *       Called ONLY by the auth.oxy.so worker after it has minted a real Oxy
 *       session via the existing FedCM pipeline. Gated by the internal
 *       `X-Oxy-Internal` shared secret (mismatch/absence returns 404 to hide the
 *       route). Wraps the supplied session in an opaque, origin-bound, 30s
 *       single-use code that the RP later redeems at `/sso/exchange`.
 *     parameters:
 *       - in: header
 *         name: X-Oxy-Internal
 *         required: true
 *         schema:
 *           type: string
 *         description: Shared secret equal to SSO_INTERNAL_SECRET.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [session, clientOrigin]
 *             properties:
 *               clientOrigin:
 *                 type: string
 *                 description: Approved RP origin the code is bound to.
 *               session:
 *                 type: object
 *                 required: [sessionId, accessToken, user]
 *                 properties:
 *                   sessionId: { type: string }
 *                   accessToken: { type: string }
 *                   expiresAt: { type: string, format: date-time }
 *                   authuser: { type: integer }
 *                   user:
 *                     type: object
 *                     required: [id]
 *                     properties:
 *                       id: { type: string }
 *                       username: { type: string }
 *                       email: { type: string }
 *                       avatar: { type: string }
 *                       name: { type: string }
 *     responses:
 *       200:
 *         description: Code issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: string }
 *                 expiresInSeconds: { type: integer }
 *       400:
 *         description: Invalid session payload or unapproved clientOrigin.
 *       404:
 *         description: Internal secret missing or invalid.
 */
router.post('/code', codeLimiter, issueSsoCode);

/**
 * @openapi
 * /sso/exchange:
 *   post:
 *     tags:
 *       - Federation
 *     security: []
 *     summary: Redeem an SSO code for a session (RP browser, cross-origin)
 *     description: >
 *       The RP calls this with the opaque code it received in the redirect
 *       fragment. The code is burned single-use (atomic GETDEL); the requesting
 *       Origin must match the approved origin the code was bound to. Returns the
 *       wrapped session. No cookies are involved (Access-Control-Allow-
 *       Credentials: false); the access token is in the body.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Session issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *                 sessionId: { type: string }
 *                 expiresAt: { type: string, format: date-time }
 *                 authuser: { type: integer }
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     username: { type: string }
 *                     email: { type: string }
 *                     avatar: { type: string }
 *                     name: { type: string }
 *       400:
 *         description: Missing code.
 *       403:
 *         description: Requesting Origin does not match the code's bound origin.
 *       410:
 *         description: Code is invalid, expired, or already used.
 */
router.post('/exchange', exchangeLimiter, exchangeSsoCode);

/**
 * @openapi
 * /sso/establish-token:
 *   post:
 *     tags:
 *       - Federation
 *     summary: Mint a durable-session establish URL for the caller's session (RP browser)
 *     description: >
 *       Bearer-authenticated. After a WEB device-flow ("Sign in with Oxy" QR)
 *       claim — which plants only in-memory tokens and NO IdP cookie — the RP
 *       calls this to plant a durable `fedcm_session` cookie so a reload can
 *       re-mint a token. Returns a fully-formed `/sso/establish` URL bound to the
 *       caller's OWN session (session id from the bearer, never the body), for an
 *       approved origin that must also equal the request `Origin` header. 501 if
 *       `FEDCM_TOKEN_SECRET` is unset.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [origin, state]
 *             properties:
 *               origin: { type: string, description: The approved RP origin to establish for. }
 *               state: { type: string, description: Opaque CSRF state echoed into the callback fragment. }
 *     responses:
 *       200:
 *         description: Establish URL issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 establishUrl: { type: string }
 *       400:
 *         description: Missing/invalid origin or state.
 *       401:
 *         description: Missing or invalid bearer session.
 *       403:
 *         description: Origin is unapproved or does not match the request Origin header.
 *       501:
 *         description: FEDCM_TOKEN_SECRET not configured (feature disabled).
 */
router.post('/establish-token', establishTokenLimiter, authMiddleware, issueEstablishToken);

export default router;
