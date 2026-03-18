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
import { validate } from '../middleware/validate';
import {
  karmaUserIdParams,
  awardKarmaSchema,
  deductKarmaSchema,
  karmaRuleSchema,
} from '../schemas/karma.schemas';

const router = express.Router();

// Public routes (no auth required)
router.get('/leaderboard', getKarmaLeaderboard);
router.get('/rules', getKarmaRules);
router.get('/:userId/total', validate({ params: karmaUserIdParams }), getUserKarmaTotal);

// Auth required routes
router.use(authMiddleware);
router.get('/:userId/history', validate({ params: karmaUserIdParams }), getUserKarmaHistory);
router.post('/award', validate({ body: awardKarmaSchema }), awardKarma);
router.post('/deduct', validate({ body: deductKarmaSchema }), deductKarma);

// Auth required routes (continued)
router.post('/rules', validate({ body: karmaRuleSchema }), createOrUpdateKarmaRule);

export default router; 