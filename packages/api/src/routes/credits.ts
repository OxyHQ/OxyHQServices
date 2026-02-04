import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { UserCredits } from '../models/UserCredits';
import ApiKeyUsage from '../models/ApiKeyUsage';
import { logger } from '../utils/logger';

const router = Router();

// Helper to get or create UserCredits record
async function getOrCreateUserCredits(userId: string) {
  return UserCredits.findByIdAndUpdate(
    userId,
    {
      $setOnInsert: {
        _id: userId,
        credits: { free: 1000, freeLimit: 1000, dailyRefresh: 300, lastRefresh: new Date(), paid: 0 },
      },
    },
    { upsert: true, new: true }
  );
}

// Get credit balance
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id?.toString();
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const userCredits = await getOrCreateUserCredits(userId);
    await userCredits.refreshCreditsIfNeeded();

    res.json({
      credits: userCredits.credits.free + userCredits.credits.paid,
      freeCredits: userCredits.credits.free,
      paidCredits: userCredits.credits.paid,
      dailyRefresh: userCredits.credits.dailyRefresh,
      lastRefresh: userCredits.credits.lastRefresh,
    });
  } catch (error: any) {
    logger.error('Error fetching credits:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

// Get daily credit usage history
router.get('/usage', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id?.toString();
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const period = (req.query.period as string) || '7d';
    const days = period === '30d' ? 30 : 7;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const usage = await ApiKeyUsage.aggregate([
      {
        $match: {
          userId,
          timestamp: { $gte: since },
          $or: [
            { creditsUsed: { $gt: 0 } },
            { tokensUsed: { $gt: 0 } },
          ],
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          used: {
            $sum: {
              $cond: {
                if: { $gt: ['$creditsUsed', 0] },
                then: '$creditsUsed',
                else: { $max: [{ $ceil: { $divide: ['$tokensUsed', 1000] } }, 1] },
              },
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill gaps with zeros
    const result: { date: string; used: number }[] = [];
    const usageMap = new Map(usage.map((u: any) => [u._id, u.used]));
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, used: (usageMap.get(key) as number) || 0 });
    }

    res.json(result);
  } catch (error: any) {
    logger.error('Error fetching credit usage:', error);
    res.status(500).json({ error: 'Failed to fetch credit usage' });
  }
});

export { getOrCreateUserCredits };
export default router;
