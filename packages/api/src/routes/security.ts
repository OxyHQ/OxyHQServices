import express from 'express';
import { getSecurityActivity, logPrivateKeyExported, logBackupCreated } from '../controllers/securityActivity.controller';
import {
  setup2FA,
  enable2FA,
  disable2FA,
  verify2FAToken,
  verify2FALogin,
  get2FAStatus,
  regenerateBackupCodes
} from '../controllers/twoFactor.controller';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  logPrivateKeyExportedSchema,
  logBackupCreatedSchema,
  enable2FASchema,
  disable2FASchema,
  verify2FATokenSchema,
  verify2FALoginSchema,
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

/**
 * @openapi
 * /security/2fa/status:
 *   get:
 *     tags:
 *       - Security
 *     summary: Get 2FA status for the current user
 *     description: >
 *       Return whether TOTP-based two-factor authentication is enabled,
 *       when it was set up, and how many backup codes remain.
 *     responses:
 *       200:
 *         description: 2FA status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 enabledAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 backupCodesRemaining:
 *                   type: integer
 *                   example: 8
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.get('/2fa/status', authMiddleware, get2FAStatus);

/**
 * @openapi
 * /security/2fa/setup:
 *   post:
 *     tags:
 *       - Security
 *     summary: Begin 2FA setup
 *     description: >
 *       Generate a TOTP secret and otpauth URI for the user to register in
 *       their authenticator app. The secret is provisional until confirmed
 *       via `POST /security/2fa/enable` with a valid TOTP code.
 *     responses:
 *       200:
 *         description: TOTP secret + provisioning URI.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 secret:
 *                   type: string
 *                   description: Base32 TOTP secret.
 *                 otpauthUrl:
 *                   type: string
 *                   description: otpauth:// URL for QR rendering.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.post('/2fa/setup', authMiddleware, setup2FA);

/**
 * @openapi
 * /security/2fa/enable:
 *   post:
 *     tags:
 *       - Security
 *     summary: Confirm 2FA setup and turn it on
 *     description: >
 *       Submit a fresh TOTP code from the user's authenticator app to
 *       confirm the provisional secret. On success returns 10 backup codes
 *       (single-use, downloadable).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code.
 *                 example: '123456'
 *     responses:
 *       200:
 *         description: 2FA enabled. Returns 10 single-use backup codes.
 *       400:
 *         description: TOTP code invalid.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.post('/2fa/enable', authMiddleware, validate({ body: enable2FASchema }), enable2FA);

/**
 * @openapi
 * /security/2fa/disable:
 *   post:
 *     tags:
 *       - Security
 *     summary: Disable 2FA on the current account
 *     description: >
 *       Turn 2FA off. Requires the account password and, if currently
 *       enabled, a fresh TOTP code or backup code.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *                 format: password
 *               token:
 *                 type: string
 *                 description: TOTP or backup code.
 *     responses:
 *       200:
 *         description: 2FA disabled.
 *       400:
 *         description: Wrong password or invalid TOTP.
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.post('/2fa/disable', authMiddleware, validate({ body: disable2FASchema }), disable2FA);

/**
 * @openapi
 * /security/2fa/verify:
 *   post:
 *     tags:
 *       - Security
 *     security: []
 *     summary: Verify a TOTP code (no auth)
 *     description: >
 *       Used to validate a TOTP code outside the login flow — for example,
 *       to allow a sensitive action to proceed. Accepts either a fresh TOTP
 *       code or a backup code.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email or username of the user being verified.
 *                 example: alice
 *               token:
 *                 type: string
 *                 example: '123456'
 *               backupCode:
 *                 type: string
 *                 example: 'A1B2-C3D4-E5F6'
 *     responses:
 *       200:
 *         description: Code valid.
 *       400:
 *         description: Code invalid or expired.
 */
router.post('/2fa/verify', validate({ body: verify2FATokenSchema }), verify2FAToken);

/**
 * @openapi
 * /security/2fa/verify-login:
 *   post:
 *     tags:
 *       - Security
 *     security: []
 *     summary: Complete a 2FA login challenge
 *     description: >
 *       Final step of the password + 2FA login flow. Submit the
 *       `loginToken` returned by `/auth/login` along with a TOTP or backup
 *       code. On success returns the standard `AuthSuccess` payload.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - loginToken
 *             properties:
 *               loginToken:
 *                 type: string
 *                 example: lt_2fa_abc123def456
 *               token:
 *                 type: string
 *                 example: '123456'
 *               backupCode:
 *                 type: string
 *               deviceName:
 *                 type: string
 *                 example: iPhone 15 Pro
 *               deviceFingerprint:
 *                 type: string
 *                 example: dev-fp-abcdef0123456789
 *     responses:
 *       200:
 *         description: Login completed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccess'
 *       400:
 *         description: Invalid code or expired loginToken.
 */
router.post('/2fa/verify-login', validate({ body: verify2FALoginSchema }), verify2FALogin);

/**
 * @openapi
 * /security/2fa/backup-codes/regenerate:
 *   post:
 *     tags:
 *       - Security
 *     summary: Regenerate 2FA backup codes
 *     description: >
 *       Replace the existing backup codes with a fresh set of 10.
 *       Invalidates every previously issued backup code.
 *     responses:
 *       200:
 *         description: New backup codes.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 codes:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example:
 *                     - 'A1B2-C3D4-E5F6'
 *                     - 'G7H8-I9J0-K1L2'
 *       401:
 *         description: Missing or invalid bearer token.
 */
router.post('/2fa/backup-codes/regenerate', authMiddleware, regenerateBackupCodes);

export default router;
