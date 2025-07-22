import express from 'express';
import locationSearchController from '../controllers/locationSearch.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Search for locations
router.get('/search', authMiddleware, locationSearchController.searchLocations);

// Get location details by coordinates
router.get('/details', authMiddleware, locationSearchController.getLocationDetails);

export default router; 