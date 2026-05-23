/**
 * Contact Discovery Routes
 *
 * Privacy-preserving discovery of which of a user's address-book contacts
 * already have Oxy accounts. Clients hash emails/phones locally with SHA-256
 * (see `utils/contactHash.ts` for the canonical algorithm) and upload only
 * those digests. The server intersects them against precomputed indexes on
 * the `User` collection and returns the matched user IDs.
 *
 * Privacy invariants:
 *   - Raw email / phone never traverses this route.
 *   - The response contains no PII — only Oxy user IDs and the hash the
 *     caller supplied (so the client can map matches back to the local
 *     contact that produced them).
 *   - No write to the database. Discovery is stateless.
 *
 * Abuse controls:
 *   - Authenticated user only (no service tokens — this is owner-only data).
 *   - Per-user 5 req/min via `keyGenerator` keyed on the resolved user ID.
 *   - Per-request payload capped at 200 hashes per channel (~400 total).
 */

import { Router, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { ForbiddenError, UnauthorizedError } from '../utils/error';
import { logger } from '../utils/logger';
import User from '../models/User';
import { discoverContactsSchema } from '../schemas/contacts.schemas';

const router = Router();

/**
 * Rate limiter: 5 requests per minute per authenticated user.
 *
 * Keyed on the user ID extracted from the bearer token (not the IP) so that
 * the limit follows the account across networks and so that NATed clients
 * don't share buckets.
 */
const discoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message:
    'Too many contact discovery requests. Please wait a minute before trying again.',
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && process.env.ACCESS_TOKEN_SECRET) {
      try {
        const decoded = jwt.decode(authHeader.slice('Bearer '.length));
        if (decoded && typeof decoded === 'object') {
          const claims = decoded as { userId?: string; sub?: string };
          const userId = claims.userId || claims.sub;
          if (typeof userId === 'string' && userId.length > 0) {
            return `contacts:discover:${userId}`;
          }
        }
      } catch (error) {
        logger.debug('Could not decode token for rate-limit key', {
          component: 'contacts',
          method: 'discoverLimiter.keyGenerator',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return `contacts:discover:ip:${req.ip ?? 'unknown'}`;
  },
});

/**
 * Reject tokens that were minted via `/auth/service-token` — discovery
 * operates on the owner's address book, so service-to-service callers have
 * no legitimate need for it (they can't represent an end-user's contacts).
 */
function rejectServiceTokens(req: AuthRequest, _res: Response, next: () => void): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && process.env.ACCESS_TOKEN_SECRET) {
    const token = authHeader.slice('Bearer '.length);
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object') {
      const tokenType = (decoded as { type?: string }).type;
      if (tokenType === 'service') {
        throw new ForbiddenError(
          'Service tokens cannot perform contact discovery — use a user session token.',
        );
      }
    }
  }
  next();
}

interface DiscoverMatch {
  userId: string;
  hashedIdentifier: string;
  matchType: 'email' | 'phone';
}

/**
 * POST /contacts/discover
 *
 * Body: { hashedEmails: string[]; hashedPhones: string[] }
 * Response: { matches: Array<{ userId, hashedIdentifier, matchType }> }
 *
 * Auth: required (user session token only; rejects service tokens).
 */
router.post(
  '/discover',
  authMiddleware,
  rejectServiceTokens,
  discoverLimiter,
  validate({ body: discoverContactsSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const { hashedEmails, hashedPhones } = req.body as {
      hashedEmails: string[];
      hashedPhones: string[];
    };

    // De-dupe within the request so a contact with the same email listed twice
    // doesn't cost us two index lookups.
    const uniqueEmailHashes = Array.from(new Set(hashedEmails));
    const uniquePhoneHashes = Array.from(new Set(hashedPhones));

    // Build the discovery query. We do two short queries (one per index) and
    // merge results so that a single user matched on both email and phone
    // shows up as two distinct entries — the client may want to surface that
    // either signal contributed to the match.
    const [emailMatches, phoneMatches] = await Promise.all([
      uniqueEmailHashes.length > 0
        ? User.find(
            {
              hashedEmail: { $in: uniqueEmailHashes },
              // Don't return the caller's own account — they already know
              // they're on Oxy.
              _id: { $ne: req.user.id },
              // Federated/agent/automated accounts are not meant to surface
              // in a personal contact-sync flow.
              type: { $in: ['local', null] },
            },
            { _id: 1, hashedEmail: 1 },
          )
            .lean()
            .exec()
        : Promise.resolve([] as Array<{ _id: unknown; hashedEmail?: string }>),
      uniquePhoneHashes.length > 0
        ? User.find(
            {
              hashedPhone: { $in: uniquePhoneHashes },
              _id: { $ne: req.user.id },
              type: { $in: ['local', null] },
            },
            { _id: 1, hashedPhone: 1 },
          )
            .lean()
            .exec()
        : Promise.resolve([] as Array<{ _id: unknown; hashedPhone?: string }>),
    ]);

    const matches: DiscoverMatch[] = [];

    for (const doc of emailMatches) {
      const userIdStr =
        typeof doc._id === 'string'
          ? doc._id
          : doc._id != null && typeof (doc._id as { toString: () => string }).toString === 'function'
            ? (doc._id as { toString: () => string }).toString()
            : null;
      if (userIdStr && typeof doc.hashedEmail === 'string') {
        matches.push({
          userId: userIdStr,
          hashedIdentifier: doc.hashedEmail,
          matchType: 'email',
        });
      }
    }

    for (const doc of phoneMatches) {
      const userIdStr =
        typeof doc._id === 'string'
          ? doc._id
          : doc._id != null && typeof (doc._id as { toString: () => string }).toString === 'function'
            ? (doc._id as { toString: () => string }).toString()
            : null;
      if (userIdStr && typeof doc.hashedPhone === 'string') {
        matches.push({
          userId: userIdStr,
          hashedIdentifier: doc.hashedPhone,
          matchType: 'phone',
        });
      }
    }

    logger.info('Contact discovery completed', {
      component: 'contacts',
      method: 'discover',
      userId: req.user.id,
      emailHashesIn: uniqueEmailHashes.length,
      phoneHashesIn: uniquePhoneHashes.length,
      matchCount: matches.length,
    });

    res.json({ matches });
  }),
);

export default router;
