import express from 'express';
import { getSecurityActivity, logPrivateKeyExported, logBackupCreated } from '../controllers/securityActivity.controller';
import {
  setup2FA,
  enable2FA,
  disable2FA,
  verify2FAToken,
  get2FAStatus,
  regenerateBackupCodes
} from '../controllers/twoFactor.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Security activity routes (require authentication)
router.get('/activity', authMiddleware, getSecurityActivity);
router.post('/activity/private-key-exported', authMiddleware, logPrivateKeyExported);
router.post('/activity/backup-created', authMiddleware, logBackupCreated);

// Two-Factor Authentication routes
router.get('/2fa/status', authMiddleware, get2FAStatus);
router.post('/2fa/setup', authMiddleware, setup2FA);
router.post('/2fa/enable', authMiddleware, enable2FA);
router.post('/2fa/disable', authMiddleware, disable2FA);
router.post('/2fa/verify', verify2FAToken); // No auth required - used during login
router.post('/2fa/backup-codes/regenerate', authMiddleware, regenerateBackupCodes);

export default router;

