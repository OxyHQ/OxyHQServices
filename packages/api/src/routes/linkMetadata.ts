import { Router } from 'express';
import { fetchLinkMetadata } from '../controllers/linkMetadata.controller';

const router = Router();

router.post('/fetch-metadata', fetchLinkMetadata);

export default router; 