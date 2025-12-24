import express from 'express';
import { SessionController } from '../controllers/session.controller';

const router = express.Router();

// Authentication routes
router.post('/register', SessionController.register);
router.post('/login', SessionController.verifyChallenge);

// Session-based data retrieval routes
router.get('/user/:sessionId', SessionController.getUserBySession);
router.get('/token/:sessionId', SessionController.getTokenBySession);
router.get('/sessions/:sessionId', SessionController.getUserSessions);

// Session management routes
router.post('/logout/:sessionId', SessionController.logoutSession);
router.post('/logout/:sessionId/:targetSessionId', SessionController.logoutSession);
router.post('/logout-all/:sessionId', SessionController.logoutAllSessions);
router.get('/validate/:sessionId', SessionController.validateSession);
router.get('/validate-header/:sessionId', SessionController.validateSessionFromHeader);

// Device management routes
router.get('/device/sessions/:sessionId', SessionController.getDeviceSessions);
router.post('/device/logout-all/:sessionId', SessionController.logoutAllDeviceSessions);
router.put('/device/name/:sessionId', SessionController.updateDeviceName);

// Batch operations
router.post('/users/batch', SessionController.getUsersBySessions);

export default router; 