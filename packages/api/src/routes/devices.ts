import express from 'express';
import { DevicesController } from '../controllers/devices.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// All device routes require authentication
router.use(authMiddleware);

// Get all devices for the authenticated user
router.get('/', DevicesController.getUserDevices);

// Remove a device (logout all sessions on that device)
router.delete('/:deviceId', DevicesController.removeDevice);

export default router;

