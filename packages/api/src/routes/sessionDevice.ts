import { Router, type Request, type Response } from 'express';
import type { DeviceSessionState } from '@oxyhq/contracts';
import {
  deviceTokenMintRequestSchema,
  deviceHubTicketIssueRequestSchema,
  deviceHubTicketRedeemRequestSchema,
} from '@oxyhq/contracts';
import { isOfficialWebOrigin, normalizeOfficialReturnOrigin } from '@oxyhq/core/server';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { decodeToken, extractTokenFromRequest } from '../middleware/authUtils';
import { rateLimit } from '../middleware/rateLimiter';
import { isLockedOut, recordFailure, clearFailures } from '../services/loginLockout.service';
import deviceSessionService from '../services/deviceSession.service';
import sessionService from '../services/session.service';
import { broadcastDeviceState, broadcastSessionAccountsChanged } from '../utils/socket';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const router = Router();

/** Lockout scope for the public deviceSecret mint (per-deviceId sliding window). */
const DEVICE_TOKEN_LOCKOUT_SCOPE = 'device-token';

const deviceTokenLimiter = rateLimit({
  prefix: 'rl:session:device-token:',
  windowMs: 60_000,
  max: 30,
});

const hubTicketIssueLimiter = rateLimit({
  prefix: 'rl:session:hub-ticket:',
  windowMs: 60_000,
  max: 30,
});

const hubTicketRedeemLimiter = rateLimit({
  prefix: 'rl:session:redeem-ticket:',
  windowMs: 60_000,
  max: 30,
});

/**
 * POST /session/device/token — the phase-2c zero-cookie mint.
 *
 * PUBLIC by design and mounted ABOVE the router-wide
 * `requireSameSiteOrigin, authMiddleware` below: it carries NO bearer and NO
 * cookies. The client presents the `deviceId` it stored first-party plus the
 * opaque `deviceSecret`; possession of the secret IS the ownership proof, so the
 * mint can be initiated from any registered cross-apex origin over normal CORS.
 *
 * On a valid secret it mints a short access token for the device's active
 * account and ROTATES the secret in-use (returns `nextDeviceSecret`; the
 * presented secret stays valid for a short grace so multi-tab races don't lock
 * out). A dead/absent active session returns `no_active_session` WITHOUT rotating
 * — the client must re-authenticate and keeps its still-valid secret. Per-device
 * lockout + rate limiting blunt online secret-guessing.
 */
router.post(
  '/token',
  deviceTokenLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = deviceTokenMintRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'deviceId and deviceSecret are required' });
      return;
    }
    const { deviceId, deviceSecret } = parsed.data;

    const lockout = await isLockedOut({ scope: DEVICE_TOKEN_LOCKOUT_SCOPE, identifier: deviceId });
    if (lockout.locked) {
      if (typeof lockout.retryAfterSeconds === 'number') {
        res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
      }
      res.status(429).json({ error: 'Too many attempts' });
      return;
    }

    const state = await deviceSessionService.getStateBySecret(deviceId, deviceSecret);
    if (!state) {
      await recordFailure({ scope: DEVICE_TOKEN_LOCKOUT_SCOPE, identifier: deviceId });
      res.status(401).json({ error: 'invalid_device_secret' });
      return;
    }

    // The secret matched — clear the failure counter regardless of whether the
    // device currently has a live active session.
    await clearFailures({ scope: DEVICE_TOKEN_LOCKOUT_SCOPE, identifier: deviceId });

    const activeToken = await deviceSessionService.resolveActiveToken(state);
    if (!activeToken) {
      // Known device, but no live active session to mint for. Do NOT rotate — the
      // client re-authenticates and keeps its still-valid secret.
      res.status(401).json({ error: 'no_active_session' });
      return;
    }

    const nextDeviceSecret = await deviceSessionService.issueDeviceSecret(deviceId);
    if (!nextDeviceSecret) {
      // The device doc vanished between resolve and rotate (should not happen for
      // a live session). Fail closed rather than return a secret-less response.
      logger.error('device.token.mint could not rotate the device secret', new Error('rotation failed'), { deviceId });
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    logger.info('device.token.mint', { mint_source: 'secret', deviceId });
    res.json({
      data: {
        accessToken: activeToken.accessToken,
        expiresAt: activeToken.expiresAt,
        nextDeviceSecret,
        state,
      },
    });
  }),
);

/**
 * POST /session/device/hub-ticket — mint a one-time ticket to sync device
 * credentials onto another official origin (typically auth.oxy.so).
 *
 * Bearer required; `deviceId` comes from the validated JWT claim.
 */
router.post(
  '/hub-ticket',
  hubTicketIssueLimiter,
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = deviceHubTicketIssueRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'returnOrigin is required' });
      return;
    }

    const returnOrigin = normalizeOfficialReturnOrigin(parsed.data.returnOrigin);
    if (!returnOrigin || !isOfficialWebOrigin(returnOrigin)) {
      res.status(400).json({ error: 'invalid_return_origin' });
      return;
    }

    const deviceId = resolveCallerDeviceId(req);
    if (!deviceId) {
      res.status(401).json({ error: 'No device' });
      return;
    }

    const { issueHubTicket } = await import('../services/deviceHubTicket.service.js');
    const issued = await issueHubTicket({ deviceId, returnOrigin });
    res.json({ data: issued });
  }),
);

/**
 * POST /session/device/redeem-ticket — exchange a one-time hub ticket for a
 * fresh device secret. PUBLIC: ticket possession is the proof.
 */
router.post(
  '/redeem-ticket',
  hubTicketRedeemLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = deviceHubTicketRedeemRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'ticket and returnOrigin are required' });
      return;
    }

    const returnOrigin = normalizeOfficialReturnOrigin(parsed.data.returnOrigin);
    if (!returnOrigin || !isOfficialWebOrigin(returnOrigin)) {
      res.status(400).json({ error: 'invalid_return_origin' });
      return;
    }

    const { redeemHubTicket } = await import('../services/deviceHubTicket.service.js');
    const outcome = await redeemHubTicket(parsed.data.ticket, returnOrigin);
    if (!outcome.ok) {
      res.status(401).json({ error: 'invalid_ticket' });
      return;
    }

    res.json({
      data: {
        deviceId: outcome.deviceId,
        deviceSecret: outcome.deviceSecret,
      },
    });
  }),
);

async function withActiveToken(state: DeviceSessionState) {
  const activeToken = await deviceSessionService.resolveActiveToken(state);
  return { state, activeToken };
}

function resolveCallerDeviceId(req: AuthRequest): string | null {
  const token = extractTokenFromRequest(req);
  const decoded = token ? decodeToken(token) : null;
  return decoded?.deviceId ?? null;
}

function resolveCallerSession(req: AuthRequest): { deviceId: string; sessionId: string } | null {
  const token = extractTokenFromRequest(req);
  const decoded = token ? decodeToken(token) : null;
  if (!decoded?.deviceId || !decoded?.sessionId) return null;
  return { deviceId: decoded.deviceId, sessionId: decoded.sessionId };
}

router.use(requireSameSiteOrigin, authMiddleware);

// GET /state returns the DEVICE subset (this device's registered accounts). The
// RP client additionally unions the org/shared account graph from `GET /accounts`;
// that extra graph is legitimate and is NOT part of the device subset — do not
// try to mirror it here.
router.get('/state', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }

  res.json({ data: await withActiveToken(await deviceSessionService.getState(deviceId)) });
}));

router.post('/add', asyncHandler(async (req: AuthRequest, res: Response) => {
  const session = resolveCallerSession(req);
  const accountId = req.user?._id?.toString();
  if (!session?.deviceId || !accountId || !session.sessionId) { res.status(401).json({ error: 'Invalid session' }); return; }
  // The bearer JWT does not carry `operatedByUserId` (it is session-doc-only),
  // so a managed-account sign-in must be resolved from the session record
  // itself to bind the device-session entry to its operator.
  const sessionDoc = await sessionService.getSession(session.sessionId, true);
  // The session record must still be active. `getSession` returns null for an
  // expired/revoked session (JWT not yet expired but the session doc
  // deactivated) — such a session must NOT be re-added to the device set.
  if (!sessionDoc) { res.status(401).json({ error: 'Invalid session' }); return; }
  const operatedByUserId = sessionDoc.operatedByUserId ? sessionDoc.operatedByUserId.toString() : undefined;

  const { state, changed } = await deviceSessionService.addAccount(session.deviceId, {
    accountId,
    sessionId: session.sessionId,
    ...(operatedByUserId ? { operatedByUserId } : {}),
  });
  // An idempotent re-register (reload handoff) changes nothing — do not broadcast.
  if (changed) {
    broadcastDeviceState(state);
    // Also signal the added account's user across their other apps/devices.
    broadcastSessionAccountsChanged(accountId, state.revision, 'add');
  }
  res.json({ data: await withActiveToken(state) });
}));

router.post('/switch', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  const { accountId } = req.body ?? {};
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
  const outcome = await deviceSessionService.switchActive(deviceId, accountId);
  if (!outcome.ok) {
    if (outcome.reason === 'unauthorized') {
      // The target session was revoked; `switchActive` healed the device set by
      // removing the dead account. Broadcast the healed state so the device's
      // other tabs drop it too, then reject the switch.
      broadcastDeviceState(outcome.state);
      // The dropped account was revoked — signal its user to refetch.
      broadcastSessionAccountsChanged(accountId, outcome.state.revision, 'revoke');
      res.status(403).json({ error: 'Account not authorized' });
      return;
    }
    res.status(404).json({ error: 'Account not on this device' });
    return;
  }
  broadcastDeviceState(outcome.state);
  broadcastSessionAccountsChanged(accountId, outcome.state.revision, 'switch');
  res.json({ data: await withActiveToken(outcome.state) });
}));

router.post('/signout', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  const { accountId, all } = req.body ?? {};
  const target = all === true ? { all: true as const } : accountId ? { accountId } : null;
  if (!target) { res.status(400).json({ error: 'accountId or all required' }); return; }
  // Capture the account set BEFORE signout so we can signal every user actually
  // removed — this covers `all`, a single account, AND the operator-cascade
  // (signing out an operator removes their managed accounts too).
  const before = await deviceSessionService.getState(deviceId);
  const state = await deviceSessionService.signout(deviceId, target);
  broadcastDeviceState(state);
  const remaining = new Set(state.accounts.map((a) => a.accountId));
  const removedUserIds = before.accounts
    .map((a) => a.accountId)
    .filter((id) => !remaining.has(id));
  broadcastSessionAccountsChanged(removedUserIds, state.revision, 'signout');
  res.json({ data: await withActiveToken(state) });
}));

export default router;
