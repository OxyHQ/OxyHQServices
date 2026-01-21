import express from 'express';
import { getApprovedClients, addApprovedClient, removeApprovedClient } from '../controllers/fedcm.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Get approved clients (public - needed by FedCM flow)
router.get('/clients/approved', getApprovedClients);

// Admin routes for managing approved clients (require authentication)
// TODO: Add admin role check middleware
router.post('/clients/approved', authMiddleware, addApprovedClient);
router.delete('/clients/approved/:origin', authMiddleware, removeApprovedClient);

export default router;
