import express from 'express';
import { IdentityController } from '../controllers/identity.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// All identity routes require authentication
router.use(authMiddleware);

// Notify server about successful identity transfer
router.post('/transfer-complete', IdentityController.transferComplete);

export default router;

