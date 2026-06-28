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

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError, ErrorCodes, InternalServerError, NotFoundError, UnauthorizedError } from '../utils/error';
import { rateLimit } from '../middleware/rateLimiter';
import { isValidObjectId } from '../utils/validation';
import { getUserNode, removeNode, provisionManagedVault } from '../services/nodeRegistry.service';
import { enqueueNodeIngest } from '../queue/nodeIngest.queue';
import UserNode, { type IUserNode } from '../models/UserNode';

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

/**
 * Managed-vault provisioning limiter (F5c). Provisioning custodial-signs a chain
 * record + materializes a node, so it is deliberately rarer than the admin path —
 * a low per-user ceiling is plenty for the "Create your vault" action and blunts
 * any attempt to spam chain writes.
 */
const nodeManagedLimiter = rateLimit({
  prefix: 'rl:nodes:managed:',
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many managed vault requests. Please slow down.',
  keyGenerator: userScopedKey('nodes:managed'),
});

/**
 * Ingest-notify limiter (F5b). The endpoint is an unauthenticated HINT, so it is
 * keyed by IP and held to a HARD ceiling — a notify only triggers a re-pull of
 * the named user's OWN node, which the worker then fully re-verifies, but the
 * enqueue itself must be cheap to throttle. Per-user dedup in the queue prevents
 * a flood from one target stacking work.
 */
const nodeIngestNotifyLimiter = rateLimit({
  prefix: 'rl:nodes:ingest:',
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many ingest notifications. Please slow down.',
  keyGenerator: (req: Request): string => `nodes:ingest:ip:${req.ip ?? 'unknown'}`,
});

/** Public projection of a node row (drops Mongo internals). */
function serializeNode(node: IUserNode): Record<string, unknown> {
  return {
    nodeDid: node.nodeDid,
    endpoint: node.endpoint,
    nodePublicKey: node.nodePublicKey,
    mode: node.mode,
    managed: node.managed,
    controller: node.controller,
    status: node.status,
    lastSeenAt: node.lastSeenAt,
    lastProbeAt: node.lastProbeAt,
    lastError: node.lastError,
    cursor: node.cursor,
    lastSyncedAt: node.lastSyncedAt,
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

/**
 * POST /nodes/managed — provision an Oxy-operated MANAGED vault for the caller
 * (F5c "Create your vault"). The owner id is resolved from the session ONLY (the
 * request body is never read), Oxy custodial-signs the node registration onto the
 * caller's chain, and the materialized node is returned. Idempotent: an existing
 * active managed vault is refreshed in place, not duplicated.
 *
 * A missing Oxy custodial key or unconfigured managed-node fleet is server config,
 * so it answers 503 (try later) — never a silent broken vault.
 */
router.post(
  '/managed',
  nodeManagedLimiter,
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const result = await provisionManagedVault(userId);
    if (!result.ok) {
      switch (result.reason) {
        case 'oxy_key_unconfigured':
        case 'managed_endpoint_unconfigured':
          throw new ApiError(503, 'Managed vaults are not available right now', ErrorCodes.SERVICE_UNAVAILABLE);
        case 'user_not_found':
          throw new NotFoundError('User not found');
        default:
          throw new InternalServerError('Failed to provision managed vault');
      }
    }

    res.status(201).json({ node: serializeNode(result.node) });
  }),
);

/**
 * POST /nodes/ingest/notify/:userId — a HINT (no authority) that a user's node
 * has new records. The target is resolved server-side from the path param ONLY;
 * the request body is never read or trusted. If the named user has a registered
 * (non-revoked) node, a background ingest is enqueued — deduped per user, then
 * fully re-verified by the worker (a notify can never inject data). Always
 * answers 202: it is a fire-and-forget hint, not a probe.
 *
 * Unauthenticated by design (it only re-pulls the user's OWN node and changes
 * nothing without cryptographic verification), but rate-limited hard by IP. The
 * read path is untouched — this only schedules background work.
 */
router.post(
  '/ingest/notify/:userId',
  nodeIngestNotifyLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (isValidObjectId(userId)) {
      const hasNode = await UserNode.exists({ userId, status: { $ne: 'revoked' } });
      if (hasNode) {
        enqueueNodeIngest(userId);
      }
    }
    res.status(202).json({ accepted: true });
  }),
);

export default router;
