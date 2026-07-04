/**
 * Authorized-apps management ("Connected apps").
 *
 * Replaces the deleted FedCM `GET/DELETE /fedcm/me/authorized-apps` surface. The
 * authoritative record of a user's third-party consent is `AppGrant` (keyed by
 * the stable `Application._id`, written by the OAuth `POST /auth/oauth/authorize`
 * flow) — FedCM grants are gone. Trusted first-party/internal/official apps are
 * auto-approved and never recorded, so this only ever surfaces the revocable
 * third-party set.
 *
 * The SDK's `authorizedApps` mixin consumes:
 *   GET    /apps/authorized            → { data: { apps: [...] } }
 *   DELETE /apps/authorized/:clientId  → 204
 *
 * `clientId` is an OAuth client_id (`ApplicationCredential.publicKey`); the grant
 * is keyed by `applicationId`, so we resolve `clientId → credential → applicationId`
 * on revoke and expose a representative public client_id on read.
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { AppGrant } from '../models/AppGrant';
import { Application } from '../models/Application';
import { ApplicationCredential } from '../models/ApplicationCredential';
import { logger } from '../utils/logger';

const router = Router();

const readLimiter = rateLimit({
  prefix: 'rl:apps:authorized:read:',
  windowMs: 15 * 60 * 1000,
  max: 120,
});

const revokeLimiter = rateLimit({
  prefix: 'rl:apps:authorized:revoke:',
  windowMs: 15 * 60 * 1000,
  max: 60,
});

/**
 * GET /apps/authorized — list the caller's connected (consented) third-party
 * applications. Reads `AppGrant`, joins the `Application` for name/icon, and
 * resolves a representative active public `clientId`. Grants whose app or public
 * credential no longer resolves are skipped (an orphaned grant is not a
 * user-actionable connected app).
 */
router.get(
  '/authorized',
  readLimiter,
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const grants = await AppGrant.find({ userId })
      .select('applicationId scopes firstGrantedAt')
      .sort({ lastUsedAt: -1 })
      .lean();

    const apps: Array<{
      clientId: string;
      appName: string;
      appIconUrl?: string;
      grantedAt: string;
      scopes?: string[];
    }> = [];

    for (const grant of grants) {
      const app = await Application.findById(grant.applicationId).select('name icon').lean();
      if (!app) continue;
      const credential = await ApplicationCredential.findOne({
        applicationId: grant.applicationId,
        type: 'public',
        status: 'active',
      })
        .select('publicKey')
        .lean();
      if (!credential?.publicKey) continue;

      apps.push({
        clientId: credential.publicKey,
        appName: app.name,
        ...(typeof app.icon === 'string' && app.icon.length > 0 ? { appIconUrl: app.icon } : {}),
        grantedAt: new Date(grant.firstGrantedAt).toISOString(),
        ...(Array.isArray(grant.scopes) && grant.scopes.length > 0 ? { scopes: grant.scopes } : {}),
      });
    }

    res.json({ data: { apps } });
  }),
);

/**
 * DELETE /apps/authorized/:clientId — revoke the caller's consent for the
 * application behind `clientId`. Resolves `clientId → ApplicationCredential →
 * applicationId` and deletes the `(userId, applicationId)` grant. Idempotent:
 * an unknown clientId or an already-revoked grant still returns 204 (revoke is a
 * state assertion, not a mutation that must have found a row).
 */
router.delete(
  '/authorized/:clientId',
  revokeLimiter,
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const clientId = req.params.clientId;
    const credential = await ApplicationCredential.findOne({ publicKey: clientId })
      .select('applicationId')
      .lean();

    if (credential?.applicationId) {
      const result = await AppGrant.deleteOne({ userId, applicationId: credential.applicationId });
      if (result.deletedCount > 0) {
        logger.info('[authorizedApps] revoked app grant', {
          userId,
          applicationId: credential.applicationId.toString(),
        });
      }
    }

    res.status(204).end();
  }),
);

export default router;
