/**
 * Encrypted off-device identity backup routes (b3 Feature 1).
 *
 * Mounted at `/identity/backup`:
 *  - `POST   /identity/backup`            (bearer) upsert the encrypted backup
 *  - `GET    /identity/backup/status`     (bearer) does the caller have a backup?
 *  - `DELETE /identity/backup`            (bearer) delete the caller's backup
 *  - `GET    /identity/backup/:lookupId`  (PUBLIC) fetch the envelope by locator
 *
 * Zero-knowledge: the server persists ONLY ciphertext + `sha256(lookupId)`. It
 * never sees the recovery phrase, the derived backup key, the plaintext private
 * key, or the raw `lookupId`.
 *
 * The `:lookupId` restore endpoint is PUBLIC because possession of the 256-bit
 * locator (which itself requires the full BIP-39 seed to compute) IS the
 * authorization — a signed-out device recovering from the phrase alone has no
 * bearer token. Its real protection is that entropy; the hash-and-lookup +
 * constant-shape 404 are defense-in-depth against enumeration. No bearer writes
 * carry ambient cookies, so this router is mounted without CSRF.
 */
import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ConflictError, NotFoundError, UnauthorizedError, BadRequestError } from '../utils/error';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimiter';
import { hashedIpKey } from '../utils/ipKey';
import {
  backupUploadRequestSchema,
  backupLookupIdSchema,
  type BackupUploadRequest,
  type BackupStatusResponse,
  type EncryptedBackupEnvelope,
} from '@oxyhq/contracts';
import IdentityBackup, { type IIdentityBackup } from '../models/IdentityBackup';

const router = Router();

/**
 * `sha256(lookupId)` — the ONLY form of the locator that is ever stored or
 * compared. The raw `lookupId` (256-bit, derived from the full seed) is
 * discarded after hashing, so a DB dump cannot recompute a locator.
 */
function lookupIdHashOf(rawLookupId: string): string {
  return crypto.createHash('sha256').update(rawLookupId).digest('hex');
}

/** Whether a thrown error is a Mongo duplicate-key (E11000) error. */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** The stored fields the public envelope is projected from (lean-query friendly). */
type StoredEnvelopeFields = Pick<
  IIdentityBackup,
  'version' | 'kdfInfo' | 'nonce' | 'ciphertext' | 'publicKeyHint' | 'createdAt'
>;

/** Project a stored backup row into the public `EncryptedBackupEnvelope`. */
function toEnvelope(doc: StoredEnvelopeFields): EncryptedBackupEnvelope {
  return {
    version: doc.version,
    algorithm: 'xchacha20poly1305',
    kdfInfo: doc.kdfInfo,
    nonce: doc.nonce,
    ciphertext: doc.ciphertext,
    publicKeyHint: doc.publicKeyHint,
    createdAt: doc.createdAt,
  };
}

/**
 * Public restore-lookup limiter (IP-keyed — the endpoint is unauthenticated).
 * Bounds brute-force scanning of the locator space (already 256-bit, so this is
 * defense-in-depth, not the primary control).
 */
const publicRestoreLimiter = rateLimit({
  prefix: 'rl:identity:backup:',
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many backup lookups. Please try again shortly.',
  keyGenerator: (req: Request): string => `identity:backup:ip:${hashedIpKey(req)}`,
});

/** Per-user write budget for backup upserts (ciphertext can be large). */
const backupWriteLimiter = rateLimit({
  prefix: 'rl:identity:backup:write:',
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many backup uploads. Please try again later.',
  keyGenerator: (req: Request): string => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `identity:backup:write:${userId}` : `identity:backup:write:ip:${hashedIpKey(req)}`;
  },
});

/** Per-user delete budget — idempotent but should not be hammered. */
const backupDeleteLimiter = rateLimit({
  prefix: 'rl:identity:backup:delete:',
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many backup delete requests. Please try again later.',
  keyGenerator: (req: Request): string => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `identity:backup:delete:${userId}` : `identity:backup:delete:ip:${hashedIpKey(req)}`;
  },
});

/**
 * POST /identity/backup — create or REPLACE the caller's encrypted backup.
 * Upsert by `userId`, so a re-upload never accumulates duplicates. The raw
 * `lookupId` from the body is hashed before storage; only the hash is persisted.
 */
router.post(
  '/',
  authMiddleware,
  backupWriteLimiter,
  validate({ body: backupUploadRequestSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const body = req.body as BackupUploadRequest;
    const lookupIdHash = lookupIdHashOf(body.lookupId);

    try {
      const doc = await IdentityBackup.findOneAndUpdate(
        { userId },
        {
          $set: {
            lookupIdHash,
            publicKeyHint: body.publicKeyHint,
            ciphertext: body.ciphertext,
            nonce: body.nonce,
            algorithm: body.algorithm,
            kdfInfo: body.kdfInfo,
            version: body.version,
            createdAt: body.createdAt,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      const payload: BackupStatusResponse = {
        exists: true,
        publicKeyHint: doc.publicKeyHint,
        createdAt: doc.createdAt,
      };
      res.status(200).json(payload);
    } catch (err) {
      // A `lookupIdHash` collision with a DIFFERENT user's backup is
      // astronomically unlikely at 256-bit entropy; never silently overwrite
      // another user's record — surface a clean conflict.
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('Backup locator already in use.');
      }
      throw err;
    }
  }),
);

/**
 * GET /identity/backup/status — whether the caller has a backup, plus the
 * non-sensitive hint + timestamp when one exists. No ciphertext, no locator.
 */
router.get(
  '/status',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const doc = await IdentityBackup.findOne({ userId }).lean();
    const payload: BackupStatusResponse = doc
      ? { exists: true, publicKeyHint: doc.publicKeyHint, createdAt: doc.createdAt }
      : { exists: false };
    res.status(200).json(payload);
  }),
);

/**
 * DELETE /identity/backup — remove the caller's backup. Idempotent (deleting a
 * non-existent backup still returns success).
 */
router.delete(
  '/',
  authMiddleware,
  backupDeleteLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    await IdentityBackup.deleteOne({ userId });
    res.status(200).json({ success: true });
  }),
);

/**
 * GET /identity/backup/:lookupId — PUBLIC restore fetch. Hash the supplied raw
 * locator and return the matching envelope, or a constant-shape 404. No user
 * enumeration is possible: the response reveals only found/not-found, gated by
 * the locator's 256-bit entropy.
 */
router.get(
  '/:lookupId',
  publicRestoreLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = backupLookupIdSchema.safeParse(req.params.lookupId);
    if (!parsed.success) {
      throw new BadRequestError('Invalid backup locator');
    }
    const doc = await IdentityBackup.findOne({ lookupIdHash: lookupIdHashOf(parsed.data) }).lean();
    if (!doc) {
      throw new NotFoundError('Backup not found');
    }
    res.status(200).json(toEnvelope(doc));
  }),
);

export default router;
