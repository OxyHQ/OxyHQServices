import express from 'express';
import { SessionController } from '../controllers/session.controller';
import { validate } from '../middleware/validate';
import { sessionIdParams, updateDeviceNameSchema, batchUsersSchema } from '../schemas/session.schemas';

const router = express.Router();

// Session-based data retrieval routes
router.get('/user/:sessionId', validate({ params: sessionIdParams }), SessionController.getUserBySession);
router.get('/token/:sessionId', validate({ params: sessionIdParams }), SessionController.getTokenBySession);
router.get('/sessions/:sessionId', validate({ params: sessionIdParams }), SessionController.getUserSessions);

// Session management routes
router.post('/logout/:sessionId', validate({ params: sessionIdParams }), SessionController.logoutSession);
router.post('/logout/:sessionId/:targetSessionId', SessionController.logoutSession);
router.post('/logout-all/:sessionId', validate({ params: sessionIdParams }), SessionController.logoutAllSessions);
router.get('/validate/:sessionId', validate({ params: sessionIdParams }), SessionController.validateSession);
router.get('/validate-header/:sessionId', validate({ params: sessionIdParams }), SessionController.validateSessionFromHeader);

// Device management routes
router.get('/device/sessions/:sessionId', validate({ params: sessionIdParams }), SessionController.getDeviceSessions);
router.post('/device/logout-all/:sessionId', validate({ params: sessionIdParams }), SessionController.logoutAllDeviceSessions);
router.put('/device/name/:sessionId', validate({ params: sessionIdParams, body: updateDeviceNameSchema }), SessionController.updateDeviceName);

// Batch operations
router.post('/users/batch', validate({ body: batchUsersSchema }), SessionController.getUsersBySessions);

export default router; 