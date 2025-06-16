// oxy-api/src/middleware/sessionAuth.ts
import { Request, Response, NextFunction } from 'express';
import { getSession } from '../utils/sessionStore';

export function sessionAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.header('x-session-id');
  if (!sessionId) {
    return res.status(401).json({ error: 'Session ID required' });
  }
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  // Attach user info to req.user (for demo, just userId)
  req.user = { userId: session.userId };
  next();
}
