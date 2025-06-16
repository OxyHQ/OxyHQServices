import express from 'express';
import { SecureSessionController } from '../controllers/secureSession.controller';

const router = express.Router();

// Secure authentication routes
router.post('/login', SecureSessionController.secureLogin);

// Session-based data retrieval routes
router.get('/user/:sessionId', SecureSessionController.getUserBySession);
router.get('/token/:sessionId', SecureSessionController.getTokenBySession);
router.get('/sessions/:sessionId', SecureSessionController.getUserSessions);

// Session management routes
router.post('/logout/:sessionId', SecureSessionController.logoutSession);
router.post('/logout-all/:sessionId', SecureSessionController.logoutAllSessions);
router.get('/validate/:sessionId', SecureSessionController.validateSession);
router.get('/validate-header', SecureSessionController.validateSessionFromHeader);

// Device management routes
router.get('/device/sessions/:sessionId', SecureSessionController.getDeviceSessions);
router.post('/device/logout-all/:sessionId', SecureSessionController.logoutAllDeviceSessions);
router.put('/device/name/:sessionId', SecureSessionController.updateDeviceName);

export default router;
