import { Router, Response } from 'express';
import { serviceAuthMiddleware, type ServiceAuthRequest } from '../middleware/auth';
import { asyncHandler, sendSuccess } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import { ForbiddenError, NotFoundError } from '../utils/error';
import { logger } from '../utils/logger';
import Application from '../models/Application';
import User from '../models/User';
import credentialDomainCache from '../utils/credentialDomainCache';
import {
  getUserPublicKey,
  signWithKeyId,
} from '../services/federation.service';
import { userService } from '../services/user.service';
import {
  publicKeyParamsSchema,
  publicKeyQuerySchema,
  signRequestSchema,
  federationFollowSchema,
  type PublicKeyParams,
  type PublicKeyQuery,
  type SignRequestBody,
  type FederationFollowBody,
} from '../schemas/federation.schemas';

const router = Router();

const REQUIRED_SCOPE = 'federation:write';

/**
 * Uncached loader for the federation domains a given Application may sign for.
 *
 * SECURITY BOUNDARY (see {@link credentialDomainCache}): there is no explicit
 * federation-domain field on the Application, so — mirroring the
 * approved-clients derivation — we take the hostnames of the Application's
 * `redirectUris` as the set of domains its credentials may operate on. Only
 * `active` applications qualify; a suspended/deleted/pending app yields an empty
 * set and every host check then fails closed (403).
 *
 * FAIL CLOSED: a missing app, non-active status, or unparseable redirectUris all
 * resolve to an empty list. On a DB error we throw — the cache's loader wrapper
 * logs and treats the throw as an empty allow-list (deny), never a default.
 */
async function loadAllowedDomains(appId: string): Promise<string[]> {
  const app = await Application.findById(appId).select('redirectUris status').lean();
  if (!app || app.status !== 'active') {
    return [];
  }

  const hosts = new Set<string>();
  for (const uri of app.redirectUris ?? []) {
    if (typeof uri !== 'string' || uri.length === 0) continue;
    try {
      hosts.add(new URL(uri).hostname.toLowerCase());
    } catch {
      // Skip malformed redirectUris — they contribute no authorisation.
    }
  }
  return Array.from(hosts);
}

/**
 * Resolve the set of federation hosts the requesting service credential may
 * operate on. Reads `req.serviceApp.appId` (set by serviceAuthMiddleware) and
 * resolves it through the short-TTL cache. Returns an empty set if the app id
 * is missing — the caller treats an empty set as "deny everything".
 */
async function getAllowedDomainsForRequest(req: ServiceAuthRequest): Promise<Set<string>> {
  const appId = req.serviceApp?.appId;
  if (typeof appId !== 'string' || appId.length === 0) {
    return new Set<string>();
  }
  return credentialDomainCache.getAllowedDomains(appId, () => loadAllowedDomains(appId));
}

/** Assert the requesting credential carries the federation:write scope. */
function assertFederationScope(req: ServiceAuthRequest): void {
  const scopes = req.serviceApp?.scopes ?? [];
  if (!scopes.includes(REQUIRED_SCOPE)) {
    throw new ForbiddenError(`Missing required scope: ${REQUIRED_SCOPE}`);
  }
}

/**
 * GET /federation/public-key/:username?domain=<domain>
 *
 * Returns the PUBLIC half of the domain-scoped user key so a relying app (e.g.
 * Mention) can publish a spec-compliant `publicKey` block whose `id`/`owner`
 * live on its own domain. NEVER returns privateKeyPem.
 *
 * The requested `domain` MUST be one of the requesting credential's registered
 * federation hosts (derived from the Application's redirectUris), otherwise 403.
 */
router.get(
  '/public-key/:username',
  serviceAuthMiddleware,
  validate({ params: publicKeyParamsSchema, query: publicKeyQuerySchema }),
  asyncHandler(async (req: ServiceAuthRequest, res: Response) => {
    assertFederationScope(req);

    const { username } = req.params as unknown as PublicKeyParams;
    const { domain } = req.query as unknown as PublicKeyQuery;

    const allowed = await getAllowedDomainsForRequest(req);
    if (!allowed.has(domain)) {
      logger.warn('federation/public-key: domain not authorised for credential', {
        appId: req.serviceApp?.appId,
        credentialId: req.serviceApp?.credentialId,
        domain,
      });
      throw new ForbiddenError('domain is not registered for this application');
    }

    const publicKey = await getUserPublicKey(username, domain);
    return sendSuccess(res, {
      keyId: publicKey.keyId,
      publicKeyPem: publicKey.publicKeyPem,
    });
  }),
);

/**
 * POST /federation/sign
 *
 * Signs an HTTP-Signature signing string with the private key identified by
 * `keyId`. The private key NEVER leaves Oxy — only the base64 signature is
 * returned (sign-on-behalf).
 *
 * Validation order (each rejecting before the next):
 *  - federation:write scope            → 403
 *  - body schema (keyId is an https #main-key url; signingString begins with
 *    "(request-target):" and is <= MAX_SIGNING_STRING_LENGTH)  → 400 (validate)
 *  - keyId host == one of the credential's registered domains   → 403
 *  - key pair for keyId exists (no auto-create on the sign path) → 404
 */
router.post(
  '/sign',
  serviceAuthMiddleware,
  validate({ body: signRequestSchema }),
  asyncHandler(async (req: ServiceAuthRequest, res: Response) => {
    assertFederationScope(req);

    const { keyId, signingString } = req.body as SignRequestBody;

    // keyId is already validated as an https URL ending in #main-key by the
    // schema; parsing here cannot throw, but guard defensively so the host check
    // is unambiguous.
    let keyIdHost: string;
    try {
      keyIdHost = new URL(keyId).hostname.toLowerCase();
    } catch {
      throw new ForbiddenError('keyId host is not authorised for this application');
    }

    const allowed = await getAllowedDomainsForRequest(req);
    if (!allowed.has(keyIdHost)) {
      logger.warn('federation/sign: keyId host not authorised for credential', {
        appId: req.serviceApp?.appId,
        credentialId: req.serviceApp?.credentialId,
        keyIdHost,
      });
      throw new ForbiddenError('keyId host is not authorised for this application');
    }

    const signature = await signWithKeyId(keyId, signingString);
    if (signature === null) {
      throw new NotFoundError('No key pair exists for the requested keyId');
    }

    return sendSuccess(res, {
      keyId,
      algorithm: 'rsa-sha256',
      signature,
    });
  }),
);

/**
 * POST /federation/follow
 *
 * Mirrors an inbound ActivityPub Follow/Undo-Follow into the Oxy follow graph on
 * behalf of a FEDERATED actor: when a remote actor follows (or unfollows) a
 * local user, Mention's backend calls this to create/remove the corresponding
 * Oxy edge. Idempotent — repeated calls never double-move the follower/following
 * counters.
 *
 * ANTI-IMPERSONATION: `followerUserId` MUST resolve to a `type:'federated'`
 * user. A service credential must never be able to move a LOCAL user's follow
 * graph — only the user themselves (via their own session) may do that. The
 * target must be a real, non-federated (local) user.
 */
router.post(
  '/follow',
  serviceAuthMiddleware,
  validate({ body: federationFollowSchema }),
  asyncHandler(async (req: ServiceAuthRequest, res: Response) => {
    assertFederationScope(req);

    const { followerUserId, targetUserId, action } = req.body as FederationFollowBody;

    const [follower, target] = await Promise.all([
      User.findById(followerUserId).select('type').lean(),
      User.findById(targetUserId).select('type').lean(),
    ]);

    if (!follower) {
      throw new NotFoundError('follower user not found');
    }
    // Only a federated actor's graph may be moved by a service credential.
    if (follower.type !== 'federated') {
      throw new ForbiddenError('follower must be a federated user');
    }
    if (!target) {
      throw new NotFoundError('target user not found');
    }
    // A federated actor may only follow a local user through this bridge.
    if (target.type === 'federated') {
      throw new ForbiddenError('target must be a local (non-federated) user');
    }

    if (action === 'follow') {
      const { created, counts } = await userService.followUser(followerUserId, targetUserId);
      return sendSuccess(res, { created, counts });
    }

    const { removed, counts } = await userService.unfollowUser(followerUserId, targetUserId);
    return sendSuccess(res, { removed, counts });
  }),
);

export default router;
