import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getStorageUsage } from '../controllers/storage.controller';

const router = Router();

/**
 * @openapi
 * /storage/usage:
 *   get:
 *     tags:
 *       - Files
 *     summary: Get the authenticated user's storage usage
 *     description: >
 *       Return the total bytes used and the user's storage quota for the
 *       file-storage feature. Used by the storage settings UI to render
 *       progress bars and quota warnings.
 *     responses:
 *       200:
 *         description: Storage usage.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 used:
 *                   type: integer
 *                   description: Bytes consumed.
 *                   example: 1073741824
 *                 quota:
 *                   type: integer
 *                   description: Bytes available.
 *                   example: 10737418240
 *                 percent:
 *                   type: number
 *                   description: Percentage used (0-1).
 *                   example: 0.1
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.get('/usage', authMiddleware, getStorageUsage);

export default router;
