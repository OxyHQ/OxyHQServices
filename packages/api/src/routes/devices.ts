import express from 'express';
import { DevicesController } from '../controllers/devices.controller';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { deviceIdParams } from '../schemas/devices.schemas';

const router = express.Router();

// All device routes require authentication
router.use(authMiddleware);

// Get all devices for the authenticated user
router.get('/', DevicesController.getUserDevices);

// Get security information
router.get('/security', DevicesController.getSecurityInfo);

// Remove a device (logout all sessions on that device)
router.delete('/:deviceId', validate({ params: deviceIdParams }), DevicesController.removeDevice);

export default router;

