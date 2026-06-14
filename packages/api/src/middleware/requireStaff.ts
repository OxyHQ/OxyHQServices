import { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';

/**
 * Platform staff guard.
 *
 * Requires the authenticated user to carry the `isStaff` flag on their User
 * document (set in the DB by a platform administrator only — there is no
 * self-service route to grant it). Used to gate staff-only operations such as
 * editing an Application's `type` / `isOfficial` / `isInternal` / `capabilities`
 * fields, which are NOT grantable through any application membership role.
 *
 * MUST run after `authMiddleware` so `req.user` is populated.
 */
export const requireStaff = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.isStaff === true) {
    next();
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    message: 'This operation requires Oxy platform staff privileges',
  });
};

/**
 * Predicate form of the staff guard for inline checks inside a handler (e.g.
 * silently ignoring staff-only fields on a normal update path rather than
 * rejecting the whole request).
 */
export const isStaffUser = (req: AuthRequest): boolean => req.user?.isStaff === true;
