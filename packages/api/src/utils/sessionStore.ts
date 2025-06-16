// oxy-api/src/utils/sessionStore.ts
// In-memory session store for development. Replace with Redis/Mongo for production.
import crypto from 'crypto';

export interface Session {
  sessionId: string;
  userId: string;
  deviceInfo?: string;
  createdAt: number;
  expiresAt: number;
  ip?: string;
}

const SESSION_TTL = 1000 * 60 * 60 * 2; // 2 hours
const sessions: Record<string, Session> = {};

export function createSession(userId: string, deviceInfo?: string, ip?: string): Session {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session: Session = {
    sessionId,
    userId,
    deviceInfo,
    createdAt: now,
    expiresAt: now + SESSION_TTL,
    ip,
  };
  sessions[sessionId] = session;
  return session;
}

export function getSession(sessionId: string): Session | null {
  const session = sessions[sessionId];
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    delete sessions[sessionId];
    return null;
  }
  return session;
}

export function invalidateSession(sessionId: string) {
  delete sessions[sessionId];
}

export function invalidateAllSessionsForUser(userId: string) {
  Object.keys(sessions).forEach((sid) => {
    if (sessions[sid].userId === userId) delete sessions[sid];
  });
}

export function listSessionsForUser(userId: string): Session[] {
  return Object.values(sessions).filter((s) => s.userId === userId && s.expiresAt > Date.now());
}
