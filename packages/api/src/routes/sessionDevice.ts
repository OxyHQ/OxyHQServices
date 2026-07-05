import { Router, Response } from 'express';
import type { DeviceSessionState } from '@oxyhq/contracts';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { decodeToken, extractTokenFromRequest } from '../middleware/authUtils';
import deviceSessionService from '../services/deviceSession.service';
import sessionService from '../services/session.service';
import { broadcastDeviceState } from '../utils/socket';
import { readDeviceCookie } from '../utils/deviceCookie';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

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

/**
 * CONVERGE ON READ + ADD — collapse the deviceId split-brain onto ONE device doc.
 *
 * The `DeviceSession` doc is looked up two ways: the IdP + bootstrap/web-session
 * read it by `cookieKeyHash` (the `oxy_device` cookie), while RP apps read it by
 * the bearer JWT's `deviceId` claim. A session minted before the cookie existed
 * (or by a mint path that did not thread the cookie's deviceId) lives on a doc
 * the cookie side never sees — so a signed-in user can look signed-out to the
 * IdP chooser and the two surfaces show DIFFERENT account lists.
 *
 * When a same-site caller presents the `oxy_device` cookie AND it resolves to a
 * DIFFERENT (canonical) device than the caller's JWT deviceId claim, migrate the
 * caller's session onto the cookie device and converge the account onto the
 * canonical cookie doc, returning the converged `{ state, activeToken }` with a
 * FRESH access token that carries the cookie deviceId. The caller replaces its
 * bearer immediately (SessionClient plants `activeToken`) so its next
 * `/session/device/*` calls hit the canonical doc + join the right socket room.
 *
 * Same-site is proven by the cookie itself: `oxy_device` is `SameSite=Lax` +
 * `HttpOnly` + `Domain=.oxy.so`, so it only rides same-site requests, and every
 * `/session/device/*` route additionally requires a valid bearer — a cross-site
 * sub-request or top-level navigation (which cannot set `Authorization`) is
 * rejected before reaching here. No cookie / same-doc / cross-apex (cookie never
 * travels off `.oxy.so`) → returns null and the caller uses its normal path.
 *
 * Returns null (no convergence) so `GET /state` and `POST /add` fall through to
 * their normal read/add behaviour. Idempotent: a no-op re-converge broadcasts
 * nothing.
 */
async function convergeCallerOntoCookieDevice(
  req: AuthRequest,
  session: { deviceId: string; sessionId: string },
  accountId: string,
): Promise<Awaited<ReturnType<typeof withActiveToken>> | null> {
  const rawCookie = readDeviceCookie(req);
  if (!rawCookie) return null;
  const cookieState = await deviceSessionService.getStateByCookieKey(rawCookie);
  if (!cookieState || cookieState.deviceId === session.deviceId) return null;

  // Mismatch confirmed. The bearer JWT does not carry `operatedByUserId` (it is
  // session-doc-only), so resolve it from the session record to bind the device
  // entry to its operator. A null doc means the session is expired/revoked —
  // there is nothing live to converge, so bail (the normal read/add path then
  // reflects reality) rather than resurrect a dead session onto the cookie doc.
  const sessionDoc = await sessionService.getSession(session.sessionId, true);
  if (!sessionDoc) return null;
  const operatedByUserId = sessionDoc.operatedByUserId ? sessionDoc.operatedByUserId.toString() : undefined;

  // Re-mint the session's tokens on the cookie device FIRST so the returned
  // activeToken carries the cookie deviceId claim.
  await sessionService.migrateSessionToDevice(session.sessionId, cookieState.deviceId);
  const { cookieState: convergedState, oldState, changed } = await deviceSessionService.convergeAccountOntoDevice(
    cookieState.deviceId,
    session.deviceId,
    { accountId, sessionId: session.sessionId, ...(operatedByUserId ? { operatedByUserId } : {}) },
  );
  // Broadcast BOTH rooms on a real migration: the cookie device (account
  // arrived) and the old device (account left). No-op re-converge → no change.
  if (changed) {
    broadcastDeviceState(convergedState);
    broadcastDeviceState(oldState);
  }
  return withActiveToken(convergedState);
}

router.use(requireSameSiteOrigin, authMiddleware);

// GET /state returns the DEVICE subset (this device's registered accounts). The
// IdP's `POST /auth/device/resolve` returns the SAME device subset once deviceIds
// converge (both derive from one `DeviceSession` doc). The RP client additionally
// unions the org/shared account graph from `GET /accounts`; that extra graph is
// legitimate and is NOT part of the device subset — do not try to make the IdP
// mirror it.
router.get('/state', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }

  // Converge on READ so a switcher that only ever reads state still collapses a
  // split-brain (previously only POST /add converged, so a client that reloads
  // and reads state stayed split forever). Only attempts a DB touch when the
  // caller carries both deviceId + sessionId in its JWT and an oxy_device cookie
  // is present; otherwise a cheap short-circuit to the normal read.
  const session = resolveCallerSession(req);
  const accountId = req.user?._id?.toString();
  if (session && accountId) {
    const converged = await convergeCallerOntoCookieDevice(req, session, accountId);
    if (converged) { res.json({ data: converged }); return; }
  }

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

  // Converge onto the canonical cookie device when the cookie deviceId differs
  // from the JWT claim (shared with GET /state — see convergeCallerOntoCookieDevice).
  const converged = await convergeCallerOntoCookieDevice(req, session, accountId);
  if (converged) { res.json({ data: converged }); return; }

  const { state, changed } = await deviceSessionService.addAccount(session.deviceId, {
    accountId,
    sessionId: session.sessionId,
    ...(operatedByUserId ? { operatedByUserId } : {}),
  });
  // An idempotent re-register (reload handoff) changes nothing — do not broadcast.
  if (changed) broadcastDeviceState(state);
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
      res.status(403).json({ error: 'Account not authorized' });
      return;
    }
    res.status(404).json({ error: 'Account not on this device' });
    return;
  }
  broadcastDeviceState(outcome.state);
  res.json({ data: await withActiveToken(outcome.state) });
}));

router.post('/signout', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  const { accountId, all } = req.body ?? {};
  const target = all === true ? { all: true as const } : accountId ? { accountId } : null;
  if (!target) { res.status(400).json({ error: 'accountId or all required' }); return; }
  const state = await deviceSessionService.signout(deviceId, target);
  broadcastDeviceState(state);
  res.json({ data: await withActiveToken(state) });
}));

export default router;
