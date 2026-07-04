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

    if (grants.length === 0) {
      res.json({ data: { apps } });
      return;
    }

    // BULK-resolve the applications + their representative public client_ids in
    // two `$in` queries (NOT N+1 per grant). `applicationId` is unique per grant
    // (one grant row per user+application).
    const applicationIds = grants.map((grant) => grant.applicationId);

    const applications = await Application.find({ _id: { $in: applicationIds } })
      .select('name icon')
      .lean();
    const appById = new Map(applications.map((app) => [app._id.toString(), app]));

    const credentials = await ApplicationCredential.find({
      applicationId: { $in: applicationIds },
      type: 'public',
      status: 'active',
    })
      .select('applicationId publicKey')
      .lean();
    // First active public credential per application wins (a stable, representative
    // client_id); later credentials for the same app are ignored.
    const clientIdByApp = new Map<string, string>();
    for (const credential of credentials) {
      const key = credential.applicationId.toString();
      if (credential.publicKey && !clientIdByApp.has(key)) {
        clientIdByApp.set(key, credential.publicKey);
      }
    }

    for (const grant of grants) {
      const key = grant.applicationId.toString();
      const app = appById.get(key);
      const clientId = clientIdByApp.get(key);
      // Skip a grant whose app or public credential no longer resolves (orphaned).
      if (!app || !clientId) continue;

      apps.push({
        clientId,
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
