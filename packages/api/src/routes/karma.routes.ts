import express from 'express';
import {
  getUserKarmaTotal,
  getUserKarmaHistory,
  awardKarma,
  deductKarma,
  getKarmaLeaderboard,
  getKarmaRules,
  createOrUpdateKarmaRule
} from '../controllers/karma.controller';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Public routes (no auth required)
router.get('/leaderboard', getKarmaLeaderboard);
router.get('/rules', getKarmaRules);
router.get('/:userId/total', getUserKarmaTotal);

// Auth required routes
router.use(authMiddleware);
router.get('/:userId/history', getUserKarmaHistory);
router.post('/award', awardKarma);
router.post('/deduct', deductKarma);

// Auth required routes (continued)
router.post('/rules', createOrUpdateKarmaRule);

export default router; 