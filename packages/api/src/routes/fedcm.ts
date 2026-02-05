import express from 'express';
import jwt from 'jsonwebtoken';
import { exchangeIdToken, getApprovedClients, addApprovedClient, removeApprovedClient } from '../controllers/fedcm.controller';
import type { Request, Response, NextFunction } from 'express';

const router = express.Router();

/**
 * Middleware that only allows internal service tokens.
 * Verifies the JWT and checks for type: 'service'.
 */
function serviceTokenOnly(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Service token required' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as any;
    if (decoded.type !== 'service') {
      return res.status(403).json({ message: 'This endpoint is only accessible to internal services' });
    }
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired service token' });
  }
}

// FedCM token exchange - Cross-domain SSO without cookies
// Client sends FedCM ID token, receives Oxy session with access token
router.post('/exchange', exchangeIdToken);

// Get approved clients (public - needed by FedCM flow)
router.get('/clients/approved', getApprovedClients);

// Routes for managing approved clients (internal services only)
router.post('/clients/approved', serviceTokenOnly, addApprovedClient);
router.delete('/clients/approved/:origin', serviceTokenOnly, removeApprovedClient);

export default router;
