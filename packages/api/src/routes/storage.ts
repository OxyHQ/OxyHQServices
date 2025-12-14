import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getStorageUsage } from '../controllers/storage.controller';

const router = Router();

// GET /api/storage/usage
router.get('/usage', authMiddleware, getStorageUsage);

export default router;





