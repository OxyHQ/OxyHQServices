import { Router } from 'express';
import { fetchLinkMetadata } from '../controllers/linkMetadata.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/fetch-metadata', authMiddleware, fetchLinkMetadata);

export default router; 