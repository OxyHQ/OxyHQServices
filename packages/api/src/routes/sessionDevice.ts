import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { decodeToken, extractTokenFromRequest } from '../middleware/authUtils';
import deviceSessionService from '../services/deviceSession.service';
import { broadcastDeviceState } from '../utils/socket';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

function resolveCallerDeviceId(req: AuthRequest): string | null {
  const token = extractTokenFromRequest(req);
  const decoded = token ? decodeToken(token) : null;
  return decoded?.deviceId ?? null;
}

router.use(requireSameSiteOrigin, authMiddleware);

router.get('/state', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  res.json({ data: await deviceSessionService.getState(deviceId) });
}));

router.post('/add', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  const { accountId, sessionId, operatedByUserId } = req.body ?? {};
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  if (!accountId || !sessionId) { res.status(400).json({ error: 'accountId and sessionId required' }); return; }
  const state = await deviceSessionService.addAccount(deviceId, { accountId, sessionId, operatedByUserId });
  broadcastDeviceState(state);
  res.json({ data: state });
}));

router.post('/switch', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  const { accountId } = req.body ?? {};
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
  const state = await deviceSessionService.switchActive(deviceId, accountId);
  if (!state) { res.status(404).json({ error: 'Account not on this device' }); return; }
  broadcastDeviceState(state);
  res.json({ data: state });
}));

router.post('/signout', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  const { accountId, all } = req.body ?? {};
  const target = all === true ? { all: true as const } : accountId ? { accountId } : null;
  if (!target) { res.status(400).json({ error: 'accountId or all required' }); return; }
  const state = await deviceSessionService.signout(deviceId, target);
  broadcastDeviceState(state);
  res.json({ data: state });
}));

export default router;
