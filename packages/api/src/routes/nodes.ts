/**
 * User-Node Routes (self-sovereign identity layer — F5a user nodes)
 *
 * Mounted at `/nodes`:
 *  - `GET    /nodes/me` (auth) — the caller's registered node + live status.
 *  - `DELETE /nodes/me` (auth) — revoke the caller's node registration.
 *
 * Bearer-authenticated (no app-local CSRF — bearer-write rule). The owner id is
 * always resolved server-side from the session (never from the body). Node
 * REGISTRATION is not here — a node is registered by publishing a signed
 * `type:'node'` record to `POST /identity/records`, which materializes the
 * operational cache via `nodeRegistry.service`. These routes only read and
 * revoke that cache; nothing here ever fetches a node (revocation is a local
 * cache write — the read-path invariant holds).
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError, UnauthorizedError } from '../utils/error';
import { rateLimit } from '../middleware/rateLimiter';
import { getUserNode, removeNode } from '../services/nodeRegistry.service';
import type { IUserNode } from '../models/UserNode';

const router = Router();

/** Per-authenticated-user key (falls back to IP pre-auth). */
function userScopedKey(scope: string) {
  return (req: AuthRequest): string => {
    const userId = req.user?.id;
    return userId ? `${scope}:${userId}` : `${scope}:ip:${req.ip ?? 'unknown'}`;
  };
}

const nodeReadLimiter = rateLimit({
  prefix: 'rl:nodes:read:',
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many node status requests. Please slow down.',
  keyGenerator: userScopedKey('nodes:read'),
});

const nodeAdminLimiter = rateLimit({
  prefix: 'rl:nodes:admin:',
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many node management requests. Please slow down.',
  keyGenerator: userScopedKey('nodes:admin'),
});

/** Public projection of a node row (drops Mongo internals). */
function serializeNode(node: IUserNode): Record<string, unknown> {
  return {
    nodeDid: node.nodeDid,
    endpoint: node.endpoint,
    nodePublicKey: node.nodePublicKey,
    mode: node.mode,
    status: node.status,
    lastSeenAt: node.lastSeenAt,
    lastProbeAt: node.lastProbeAt,
    lastError: node.lastError,
    cursor: node.cursor,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

/** GET /nodes/me — the caller's registered node (or `{ node: null }`). */
router.get(
  '/me',
  nodeReadLimiter,
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const node = await getUserNode(userId);
    res.json({ node: node ? serializeNode(node) : null });
  }),
);

/** DELETE /nodes/me — revoke the caller's node registration. */
router.delete(
  '/me',
  nodeAdminLimiter,
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const revoked = await removeNode(userId);
    if (!revoked) {
      throw new NotFoundError('No active node registration to revoke');
    }

    res.json({ success: true });
  }),
);

export default router;
