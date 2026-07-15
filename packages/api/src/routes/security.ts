import express from 'express';
import { getSecurityActivity, logPrivateKeyExported, logBackupCreated } from '../controllers/securityActivity.controller';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  logPrivateKeyExportedSchema,
  logBackupCreatedSchema,
} from '../schemas/security.schemas';

const router = express.Router();

/**
 * @openapi
 * /security/activity:
 *   get:
 *     tags:
 *       - Security
 *     summary: Account activity log with pagination
 *     description: >
 *       Return security-relevant events for the authenticated user — sign-in
 *       attempts, password changes, 2FA toggles, private-key exports, backup
 *       creations, suspicious activity flags. Used to power the activity
 *       history screen.
 *     parameters:
 *       - name: limit
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - name: cursor
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           description: Opaque pagination cursor returned by the previous page.
 *     responses:
 *       200:
 *         description: Activity events.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 events:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                         example: SIGN_IN
 *                       deviceName:
 *                         type: string
 *                       ip:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.get('/activity', authMiddleware, getSecurityActivity);

/**
 * @openapi
 * /security/activity/private-key-exported:
 *   post:
 *     tags:
 *       - Security
 *     summary: Log a "private key exported" event
 *     description: >
 *       Record that the local identity wallet exported its private key for
 *       backup. The event surfaces in the activity log and is used to remind
 *       the user to safely store the key.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceId:
 *                 type: string
 *                 description: Device that performed the export. Optional.
 *     responses:
 *       200:
 *         description: Event recorded.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.post('/activity/private-key-exported', authMiddleware, validate({ body: logPrivateKeyExportedSchema }), logPrivateKeyExported);

/**
 * @openapi
 * /security/activity/backup-created:
 *   post:
 *     tags:
 *       - Security
 *     summary: Log a "backup created" event
 *     description: Record that the local identity wallet wrote a backup of its keys.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deviceId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Event recorded.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.post('/activity/backup-created', authMiddleware, validate({ body: logBackupCreatedSchema }), logBackupCreated);

export default router;
