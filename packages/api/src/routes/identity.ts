import express from 'express';
import { IdentityController } from '../controllers/identity.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// All identity routes require authentication
router.use(authMiddleware);

// Notify server about successful identity transfer
router.post('/transfer-complete', IdentityController.transferComplete);

// Verify target device has active session with transferred identity
router.get('/verify-transfer', IdentityController.verifyTransfer);

export default router;

