/**
 * User App-Data Routes (`/users/me/app-data/...`)
 *
 * Generic per-user key/value store keyed by `(namespace, key)`. Authenticated
 * users may read, write, list, and delete entries scoped to their own
 * account; the routes do not allow access to anyone else's data.
 *
 * First consumer: Oxy Academy progress tracker on oxy.so. The shape is kept
 * generic so any Oxy surface can persist small bits of cross-device app
 * state without growing a bespoke schema.
 *
 * Limits:
 *   - 64 KB serialized JSON per value (enforced by the schema).
 *   - 100 writes/minute/user across PUT and DELETE (rate-limit middleware
 *     keyed on the authenticated user ID).
 *   - Namespace and key must match `[a-z0-9_-]{1,64}`.
 */

import { Router, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { UnauthorizedError } from '../utils/error';
import { logger } from '../utils/logger';
import UserAppData from '../models/UserAppData';
import {
  appDataKeyParamsSchema,
  appDataNamespaceParamsSchema,
  appDataValueBodySchema,
} from '../schemas/userData.schemas';

const router = Router();

/**
 * Per-user write rate limiter: 100 writes (PUT + DELETE) per minute.
 *
 * Keyed on the user ID extracted from the bearer token so it follows the
 * account across networks and so NAT'd clients don't share buckets. Falls
 * back to IP when the token can't be decoded (the request will then fail in
 * `authMiddleware` anyway, but the limiter still gets a stable key).
 */
const writeLimiter = rateLimit({
  prefix: 'rl:userdata:write:',
  windowMs: 60 * 1000,
  max: 100,
  message: 'Too many app-data writes. Please slow down and try again shortly.',
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && process.env.ACCESS_TOKEN_SECRET) {
      try {
        const decoded = jwt.decode(authHeader.slice('Bearer '.length));
        if (decoded && typeof decoded === 'object') {
          const claims = decoded as { userId?: string; sub?: string };
          const userId = claims.userId || claims.sub;
          if (typeof userId === 'string' && userId.length > 0) {
            return `userAppData:write:${userId}`;
          }
        }
      } catch (error) {
        logger.debug('Could not decode token for app-data rate-limit key', {
          component: 'userAppData',
          method: 'writeLimiter.keyGenerator',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return `userAppData:write:ip:${req.ip ?? 'unknown'}`;
  },
});

/**
 * @openapi
 * /users/me/app-data/{namespace}/{key}:
 *   get:
 *     tags: [UserAppData]
 *     summary: Read a single per-user JSON value
 *     description: >
 *       Returns the value stored under `(namespace, key)` for the authenticated
 *       user. The response body is always `{ value }`. If no value has ever
 *       been stored, `value` is `null` (the endpoint does not 404 on missing
 *       entries — a missing entry is semantically a `null` value).
 *     parameters:
 *       - in: path
 *         name: namespace
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *     responses:
 *       200:
 *         description: Current value (or null when not stored).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 value:
 *                   description: Arbitrary JSON value previously stored, or null.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.get(
  '/:namespace/:key',
  authMiddleware,
  validate({ params: appDataKeyParamsSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }
    const { namespace, key } = req.params;
    const doc = await UserAppData.findOne(
      { userId: req.user.id, namespace, key },
      { value: 1 },
    )
      .lean()
      .exec();

    return res.json({ value: doc ? doc.value ?? null : null });
  }),
);

/**
 * @openapi
 * /users/me/app-data/{namespace}/{key}:
 *   put:
 *     tags: [UserAppData]
 *     summary: Upsert a single per-user JSON value
 *     description: >
 *       Stores (or replaces) the value under `(namespace, key)` for the
 *       authenticated user. Body must be `{ value: <any JSON-serializable
 *       value> }`. Serialized JSON is capped at 64 KB.
 *     parameters:
 *       - in: path
 *         name: namespace
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value:
 *                 description: Arbitrary JSON value to persist.
 *     responses:
 *       200:
 *         description: The stored value, echoed back.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 value: { description: The value that is now stored. }
 *       400:
 *         description: Validation failed (bad namespace/key, oversized value).
 *       401:
 *         description: Missing or invalid bearer token.
 *       429:
 *         description: Per-user write rate limit exceeded.
 */
router.put(
  '/:namespace/:key',
  authMiddleware,
  writeLimiter,
  validate({
    params: appDataKeyParamsSchema,
    body: appDataValueBodySchema,
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }
    const { namespace, key } = req.params;
    const { value } = req.body as { value: unknown };

    const now = new Date();
    const doc = await UserAppData.findOneAndUpdate(
      { userId: req.user.id, namespace, key },
      { $set: { value, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true, new: true, projection: { value: 1 } },
    )
      .lean()
      .exec();

    return res.json({ value: doc ? doc.value ?? null : value });
  }),
);

/**
 * @openapi
 * /users/me/app-data/{namespace}/{key}:
 *   delete:
 *     tags: [UserAppData]
 *     summary: Delete a single per-user JSON value
 *     description: >
 *       Removes the value under `(namespace, key)` for the authenticated user.
 *       Idempotent — succeeds with 204 whether or not the entry existed.
 *     parameters:
 *       - in: path
 *         name: namespace
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *     responses:
 *       204:
 *         description: Deleted (or was already absent).
 *       401:
 *         description: Missing or invalid bearer token.
 *       429:
 *         description: Per-user write rate limit exceeded.
 */
router.delete(
  '/:namespace/:key',
  authMiddleware,
  writeLimiter,
  validate({ params: appDataKeyParamsSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }
    const { namespace, key } = req.params;
    await UserAppData.deleteOne({ userId: req.user.id, namespace, key }).exec();
    return res.status(204).send();
  }),
);

/**
 * @openapi
 * /users/me/app-data/{namespace}:
 *   get:
 *     tags: [UserAppData]
 *     summary: List every value in a namespace for the current user
 *     description: >
 *       Returns `{ entries }` where `entries` is a `key -> value` map of
 *       everything stored under `namespace` for the authenticated user. The
 *       response is bounded by the per-user write rate limit upstream and by
 *       the 64 KB cap per individual value; consumers should still expect to
 *       paginate large namespaces themselves.
 *     parameters:
 *       - in: path
 *         name: namespace
 *         required: true
 *         schema: { type: string, pattern: '^[a-z0-9_-]{1,64}$' }
 *     responses:
 *       200:
 *         description: Map of every key in the namespace to its value.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: object
 *                   additionalProperties:
 *                     description: Stored JSON value.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.get(
  '/:namespace',
  authMiddleware,
  validate({ params: appDataNamespaceParamsSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) {
      throw new UnauthorizedError('Authentication required');
    }
    const { namespace } = req.params;
    const docs = await UserAppData.find(
      { userId: req.user.id, namespace },
      { key: 1, value: 1 },
    )
      .lean()
      .exec();

    const entries: Record<string, unknown> = {};
    for (const doc of docs) {
      if (typeof doc.key === 'string') {
        entries[doc.key] = doc.value ?? null;
      }
    }
    return res.json({ entries });
  }),
);

export default router;
