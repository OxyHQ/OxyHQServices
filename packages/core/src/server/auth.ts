import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { OxyServices } from '../OxyServices';

export interface OxyRequestUser {
  id: string;
  _id?: string;
  username?: string;
  email?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface OxyServiceAppContext {
  appId: string;
  appName: string;
  scopes: string[];
  credentialId: string;
}

export interface OxyServiceActingAsContext {
  userId: string;
  scopes: string[];
}

export interface OxyAuthRequest extends Request {
  userId?: string | null;
  user?: OxyRequestUser | null;
  accessToken?: string;
  sessionId?: string | null;
  serviceApp?: OxyServiceAppContext;
  serviceActingAs?: OxyServiceActingAsContext;
}

export interface OxyAuthenticatedRequest extends OxyAuthRequest {
  userId: string;
  user: OxyRequestUser;
}

export interface OxyAuthMiddlewareOptions {
  /**
   * Options forwarded to `oxy.auth()`.
   * `optional` is forced to `true` by the composed helpers so route guards can
   * produce one consistent 401 shape.
   */
  auth?: Parameters<OxyServices['auth']>[0];
}

function normalizeId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function ensureUser(req: OxyAuthRequest, userId: string): OxyRequestUser {
  const existing = req.user;
  if (existing) {
    const user = {
      ...existing,
      id: normalizeId(existing.id) ?? normalizeId(existing._id) ?? userId,
    };
    req.user = user;
    return user;
  }

  const user = { id: userId };
  req.user = user;
  return user;
}

export function getOxyUserId(req: Request): string | null {
  const authReq = req as OxyAuthRequest;
  return (
    normalizeId(authReq.userId) ??
    normalizeId(authReq.user?.id) ??
    normalizeId(authReq.user?._id)
  );
}

export function isOxyAuthenticated(req: Request): req is OxyAuthenticatedRequest {
  return getOxyUserId(req) !== null;
}

export function getRequiredOxyUserId(req: Request): string {
  const userId = getOxyUserId(req);
  if (!userId) {
    throw new Error('User not authenticated');
  }
  return userId;
}

export function requireOxyAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = getOxyUserId(req);
  if (!userId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  const authReq = req as OxyAuthRequest;
  authReq.userId = userId;
  ensureUser(authReq, userId);
  next();
}

export function createOptionalOxyAuth(
  oxy: OxyServices,
  options: OxyAuthMiddlewareOptions = {},
): RequestHandler {
  const resolveSession = oxy.auth({ ...options.auth, optional: true });

  return (req, res, next) => {
    if (getOxyUserId(req)) {
      next();
      return;
    }

    resolveSession(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      next();
    });
  };
}

export function createOxyAuthMiddleware(
  oxy: OxyServices,
  options: OxyAuthMiddlewareOptions = {},
): RequestHandler {
  const resolveSession = createOptionalOxyAuth(oxy, options);

  return (req, res, next) => {
    if (getOxyUserId(req)) {
      requireOxyAuth(req, res, next);
      return;
    }

    resolveSession(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      requireOxyAuth(req, res, next);
    });
  };
}
