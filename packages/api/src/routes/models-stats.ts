import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';

const router = Router();

// Static model definitions for the Oxy ecosystem
const MODELS = [
  {
    id: 'alia-lite',
    name: 'Alia Lite',
    description: 'Fast and efficient for simple tasks',
    tier: 'free',
    category: 'general',
    creditMultiplier: 0.5,
    supportsTools: false,
    supportsVision: false,
    maxTokens: 2048,
  },
  {
    id: 'alia-v1',
    name: 'Alia V1',
    description: 'Balanced performance and quality for everyday use',
    tier: 'free',
    category: 'general',
    creditMultiplier: 1,
    supportsTools: true,
    supportsVision: false,
    maxTokens: 8192,
  },
  {
    id: 'alia-v1-pro',
    name: 'Alia V1 Pro',
    description: 'Advanced reasoning capabilities for complex tasks',
    tier: 'pro',
    category: 'general',
    creditMultiplier: 3,
    supportsTools: true,
    supportsVision: true,
    maxTokens: 16384,
  },
  {
    id: 'alia-v1-pro-max',
    name: 'Alia V1 Pro Max',
    description: 'Maximum performance for demanding applications',
    tier: 'pro',
    category: 'general',
    creditMultiplier: 5,
    supportsTools: true,
    supportsVision: true,
    maxTokens: 32768,
  },
];

/**
 * GET /api/models/stats
 * Returns model information and stats
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const modelStats = MODELS.map((model) => ({
      ...model,
      avgLatencyMs: 0,
      uptime: 100,
      successRate: 100,
      totalRequests: 0,
      isHealthy: true,
    }));

    res.json({
      models: modelStats,
      count: modelStats.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error fetching model stats:', error);
    res.status(500).json({ error: 'Failed to fetch model statistics' });
  }
});

export default router;
