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

// Security activity routes (require authentication)
router.get('/activity', authMiddleware, getSecurityActivity);
router.post('/activity/private-key-exported', authMiddleware, validate({ body: logPrivateKeyExportedSchema }), logPrivateKeyExported);
router.post('/activity/backup-created', authMiddleware, validate({ body: logBackupCreatedSchema }), logBackupCreated);

// Two-Factor Authentication routes
router.get('/2fa/status', authMiddleware, get2FAStatus);
router.post('/2fa/setup', authMiddleware, setup2FA);
router.post('/2fa/enable', authMiddleware, validate({ body: enable2FASchema }), enable2FA);
router.post('/2fa/disable', authMiddleware, validate({ body: disable2FASchema }), disable2FA);
router.post('/2fa/verify', validate({ body: verify2FATokenSchema }), verify2FAToken); // No auth required - used during login
router.post('/2fa/verify-login', validate({ body: verify2FALoginSchema }), verify2FALogin); // No auth required - 2FA challenge during login, creates session
router.post('/2fa/backup-codes/regenerate', authMiddleware, regenerateBackupCodes);

export default router;

