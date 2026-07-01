import { Router, Response } from 'express';
import type { DeviceSessionState } from '@oxyhq/contracts';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { decodeToken, extractTokenFromRequest } from '../middleware/authUtils';
import deviceSessionService from '../services/deviceSession.service';
import sessionService from '../services/session.service';
import { broadcastDeviceState } from '../utils/socket';
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

router.use(requireSameSiteOrigin, authMiddleware);

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
  const operatedByUserId = sessionDoc?.operatedByUserId ? sessionDoc.operatedByUserId.toString() : undefined;
  const state = await deviceSessionService.addAccount(session.deviceId, {
    accountId,
    sessionId: session.sessionId,
    ...(operatedByUserId ? { operatedByUserId } : {}),
  });
  broadcastDeviceState(state);
  res.json({ data: await withActiveToken(state) });
}));

router.post('/switch', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  const { accountId } = req.body ?? {};
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
  const outcome = await deviceSessionService.switchActive(deviceId, accountId);
  if (!outcome.ok) {
    if (outcome.reason === 'unauthorized') { res.status(403).json({ error: 'Account not authorized' }); return; }
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
