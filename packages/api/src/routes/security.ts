import express from 'express';
import { getSecurityActivity } from '../controllers/securityActivity.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Security activity routes (require authentication)
router.get('/activity', authMiddleware, getSecurityActivity);

export default router;

