// oxy-api/src/middleware/sessionAuth.ts
import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getSession } from '../utils/sessionStore';

export function sessionAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const sessionId = req.headers['x-session-id'] as string;
  if (!sessionId) {
    return res.status(401).json({ error: 'Session ID required' });
  }
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  // Attach user info to req.user (for demo, just userId)
  req.user = { userId: session.userId } as any;
  next();
}
