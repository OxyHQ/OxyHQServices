import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireStaff } from '../middleware/requireStaff';
import { User } from '../models/User';
import Session from '../models/Session';
import { Message } from '../models/Message';
import Notification from '../models/Notification';
import { File } from '../models/File';
import { Transaction } from '../models/Transaction';
import { Application } from '../models/Application';
import Follow from '../models/Follow';
import { logger } from '../utils/logger';

const router = Router();

// Shared cache for both REST and SSE
let cachedStats: any = null;
let cacheTime = 0;
let inFlightStatsRefresh: Promise<any> | null = null;
let activeStatsStreams = 0;
const CACHE_TTL = 2_000; // 2s cache for real-time feel
const MAX_ACTIVE_STATS_STREAMS = 25;

async function fetchStats() {
  const now = Date.now();
  if (cachedStats && now - cacheTime < CACHE_TTL) {
    return cachedStats;
  }

  if (inFlightStatsRefresh) {
    return inFlightStatsRefresh;
  }

  inFlightStatsRefresh = refreshStats(now).finally(() => {
    inFlightStatsRefresh = null;
  });

  return inFlightStatsRefresh;
}

async function refreshStats(now: number) {
  const [
    totalUsers,
    activeSessions,
    totalMessages,
    totalNotifications,
    totalFiles,
    totalTransactions,
    totalApplications,
    totalFollows,
  ] = await Promise.all([
    User.countDocuments(),
    Session.countDocuments({ isActive: true }),
    Message.countDocuments(),
    Notification.countDocuments(),
    File.countDocuments(),
    Transaction.countDocuments(),
    Application.countDocuments({ status: 'active' }),
    Follow.countDocuments(),
  ]);

  const stats = {
    totalUsers,
    activeSessions,
    totalMessages,
    totalNotifications,
    totalFiles,
    totalTransactions,
    totalApplications,
    totalFollows,
    aiModels: 4,
    timestamp: new Date().toISOString(),
  };

  cachedStats = stats;
  cacheTime = now;
  return stats;
}

router.use(authMiddleware, requireStaff);

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
  if (activeStatsStreams >= MAX_ACTIVE_STATS_STREAMS) {
    res.status(429).json({ error: 'Too many active platform stats streams' });
    return;
  }

  activeStatsStreams += 1;
  let closed = false;
  let sendInProgress = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering
  });

  // Send initial data immediately
  const sendStats = async () => {
    if (closed || sendInProgress) {
      return;
    }

    sendInProgress = true;
    try {
      const stats = await fetchStats();
      if (!closed) {
        res.write(`data: ${JSON.stringify(stats)}\n\n`);
      }
    } catch (error) {
      logger.error('SSE stats error:', error);
    } finally {
      sendInProgress = false;
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
    if (closed) {
      return;
    }

    closed = true;
    activeStatsStreams = Math.max(0, activeStatsStreams - 1);
    clearInterval(interval);
    clearInterval(keepAlive);
  });
});

export default router;
