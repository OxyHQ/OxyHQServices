import express from 'express';
import { exchangeIdToken, getApprovedClients, addApprovedClient, removeApprovedClient } from '../controllers/fedcm.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// FedCM token exchange - Cross-domain SSO without cookies
// Client sends FedCM ID token, receives Oxy session with access token
router.post('/exchange', exchangeIdToken);

// Get approved clients (public - needed by FedCM flow)
router.get('/clients/approved', getApprovedClients);

// Admin routes for managing approved clients (require authentication)
// TODO: Add admin role check middleware
router.post('/clients/approved', authMiddleware, addApprovedClient);
router.delete('/clients/approved/:origin', authMiddleware, removeApprovedClient);

export default router;
