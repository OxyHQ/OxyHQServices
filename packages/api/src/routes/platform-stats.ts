import { Router, Request, Response } from 'express';
import { User } from '../models/User';
import Session from '../models/Session';
import { Message } from '../models/Message';
import Notification from '../models/Notification';
import { File } from '../models/File';
import { Transaction } from '../models/Transaction';
import { DeveloperApp } from '../models/DeveloperApp';
import Follow from '../models/Follow';
import { logger } from '../utils/logger';

const router = Router();

// Shared cache for both REST and SSE
let cachedStats: any = null;
let cacheTime = 0;
const CACHE_TTL = 2_000; // 2s cache for real-time feel

async function fetchStats() {
  const now = Date.now();
  if (cachedStats && now - cacheTime < CACHE_TTL) {
    return cachedStats;
  }

  const [
    totalUsers,
    activeSessions,
    totalMessages,
    totalNotifications,
    totalFiles,
    totalTransactions,
    totalDeveloperApps,
    totalFollows,
    topCountries,
    regionCount,
  ] = await Promise.all([
    User.countDocuments(),
    Session.countDocuments({ isActive: true }),
    Message.countDocuments(),
    Notification.countDocuments(),
    File.countDocuments(),
    Transaction.countDocuments(),
    DeveloperApp.countDocuments({ status: 'active' }),
    Follow.countDocuments(),
    Session.aggregate([
      { $match: { isActive: true, 'deviceInfo.location': { $exists: true, $ne: '' } } },
      { $group: { _id: '$deviceInfo.location', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 7 },
    ]).catch(() => []),
    Session.distinct('deviceInfo.location', {
      isActive: true,
      'deviceInfo.location': { $exists: true, $ne: '' },
    }).then((locations) => locations.length).catch(() => 0),
  ]);

  const stats = {
    totalUsers,
    activeSessions,
    totalMessages,
    totalNotifications,
    totalFiles,
    totalTransactions,
    totalDeveloperApps,
    totalFollows,
    aiModels: 4,
    topCountries: topCountries.map((c: any) => ({
      location: c._id,
      count: c.count,
    })),
    regions: regionCount,
    timestamp: new Date().toISOString(),
  };

  cachedStats = stats;
  cacheTime = now;
  return stats;
}

// REST endpoint (fallback)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stats = await fetchStats();
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching platform stats:', error);
    res.status(500).json({ error: 'Failed to fetch platform statistics' });
  }
});

// SSE endpoint — true real-time push
router.get('/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering
  });

  // Send initial data immediately
  const sendStats = async () => {
    try {
      const stats = await fetchStats();
      res.write(`data: ${JSON.stringify(stats)}\n\n`);
    } catch (error) {
      logger.error('SSE stats error:', error);
    }
  };

  // Send immediately, then every 2 seconds
  sendStats();
  const interval = setInterval(sendStats, 2_000);

  // Keep-alive ping every 15s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15_000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(keepAlive);
  });
});

export default router;
