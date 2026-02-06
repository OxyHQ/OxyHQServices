import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { DeveloperApp, IDeveloperApp } from '../models/DeveloperApp';
import DeveloperApiKey from '../models/DeveloperApiKey';
import ApiKeyUsage from '../models/ApiKeyUsage';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { z } from 'zod';

interface AuthenticatedRequest extends express.Request {
  user?: {
    _id: string;
    [key: string]: any;
  };
}

const router = express.Router();

// Require authentication for all developer routes
router.use(authMiddleware);

// Helper to get userId from request
function getUserId(req: AuthenticatedRequest): string | null {
  return req.user?._id?.toString() || null;
}

// Helper to serialize app for console response
function serializeApp(app: IDeveloperApp) {
  return {
    _id: app._id,
    userId: app.developerUserId,
    name: app.name,
    description: app.description,
    websiteUrl: app.websiteUrl,
    redirectUrls: app.redirectUrls || [],
    icon: app.icon,
    isActive: app.status === 'active',
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

// Helper to calculate start date from period
function getStartDate(period: string): Date {
  const now = new Date();
  const startDate = new Date();
  switch (period) {
    case '24h': startDate.setHours(now.getHours() - 24); break;
    case '7d': startDate.setDate(now.getDate() - 7); break;
    case '30d': startDate.setDate(now.getDate() - 30); break;
    case '90d': startDate.setDate(now.getDate() - 90); break;
    default: startDate.setDate(now.getDate() - 7);
  }
  return startDate;
}

// Helper for usage aggregation
async function getUsageStats(matchFilter: Record<string, any>) {
  const [usage] = await ApiKeyUsage.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: 1 },
        totalTokens: { $sum: '$tokensUsed' },
        totalCredits: { $sum: '$creditsUsed' },
        avgResponseTime: { $avg: '$responseTime' },
        successfulRequests: { $sum: { $cond: [{ $lt: ['$statusCode', 400] }, 1, 0] } },
        errorRequests: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
      },
    },
  ]);

  const byDay = await ApiKeyUsage.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        requests: { $sum: 1 },
        tokens: { $sum: '$tokensUsed' },
        credits: { $sum: '$creditsUsed' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byEndpoint = await ApiKeyUsage.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$endpoint',
        requests: { $sum: 1 },
        tokens: { $sum: '$tokensUsed' },
      },
    },
    { $sort: { requests: -1 } },
    { $limit: 10 },
  ]);

  return {
    summary: usage || {
      totalRequests: 0,
      totalTokens: 0,
      totalCredits: 0,
      avgResponseTime: 0,
      successfulRequests: 0,
      errorRequests: 0,
    },
    byDay,
    byEndpoint,
  };
}

// Generate API key and secret for apps
function generateCredentials() {
  const apiKey = 'oxy_dk_' + crypto.randomBytes(24).toString('hex');
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const webhookSecret = crypto.randomBytes(24).toString('hex');
  return { apiKey, apiSecret, webhookSecret };
}

// Scopes enum for validation
const appScopesEnum = ['files:read', 'files:write', 'files:delete', 'user:read', 'webhooks:receive', 'chat:completions', 'models:read'] as const;
const apiKeyScopesEnum = ['chat:completions', 'models:read', 'files:read', 'files:write', 'files:delete', 'user:read', 'webhooks:receive'] as const;

// ============================================
// GLOBAL USAGE & STATS (before /apps/:id)
// ============================================

// Get global usage statistics across all apps
router.get('/usage', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const period = (req.query.period as string) || '7d';
    const startDate = getStartDate(period);

    const stats = await getUsageStats({
      userId,
      timestamp: { $gte: startDate },
    });

    res.json(stats);
  } catch (error: any) {
    logger.error('Error fetching global usage:', error);
    res.status(500).json({ error: 'Failed to fetch usage statistics' });
  }
});

// Get developer overview stats
router.get('/stats', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const totalApps = await DeveloperApp.countDocuments({ developerUserId: userId, status: { $ne: 'deleted' } });
    const activeApps = await DeveloperApp.countDocuments({ developerUserId: userId, status: 'active' });
    const totalKeys = await DeveloperApiKey.countDocuments({ userId });
    const activeKeys = await DeveloperApiKey.countDocuments({ userId, isActive: true });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [usage] = await ApiKeyUsage.aggregate([
      { $match: { userId, timestamp: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalTokens: { $sum: '$tokensUsed' },
          totalCredits: { $sum: '$creditsUsed' },
        },
      },
    ]);

    res.json({
      totalApps,
      activeApps,
      totalKeys,
      activeKeys,
      last30Days: usage || { totalRequests: 0, totalTokens: 0, totalCredits: 0 },
    });
  } catch (error: any) {
    logger.error('Error fetching developer stats:', error);
    res.status(500).json({ error: 'Failed to fetch developer stats' });
  }
});

// ============================================
// DEVELOPER APPS ROUTES
// ============================================

const createAppSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  redirectUrls: z.array(z.string().url()).optional(),
  icon: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  devWebhookUrl: z.string().url().optional().nullable(),
  scopes: z.array(z.enum(appScopesEnum)).optional(),
});

const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  redirectUrls: z.array(z.string().url()).optional(),
  icon: z.string().optional(),
  isActive: z.boolean().optional(),
  webhookUrl: z.string().url().optional(),
  devWebhookUrl: z.string().url().optional().nullable(),
  scopes: z.array(z.enum(appScopesEnum)).optional(),
});

// List apps
router.get('/apps', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const apps = await DeveloperApp.find({
      developerUserId: userId,
      status: { $ne: 'deleted' },
    }).sort({ createdAt: -1 }).limit(100);

    res.json({ apps: apps.map(serializeApp) });
  } catch (error: any) {
    logger.error('Error listing developer apps:', error);
    res.status(500).json({ error: 'Failed to list apps' });
  }
});

// Create app
router.post('/apps', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const validatedData = createAppSchema.parse(req.body);

    const existingCount = await DeveloperApp.countDocuments({
      developerUserId: userId,
      status: { $ne: 'deleted' },
    });
    if (existingCount >= 10) {
      return res.status(400).json({ error: 'Maximum 10 apps per developer' });
    }

    const { apiKey, apiSecret, webhookSecret } = generateCredentials();

    const app = new DeveloperApp({
      name: validatedData.name,
      description: validatedData.description,
      developerUserId: userId,
      apiKey,
      apiSecret,
      webhookUrl: validatedData.webhookUrl || '',
      devWebhookUrl: validatedData.devWebhookUrl,
      webhookSecret,
      websiteUrl: validatedData.websiteUrl,
      redirectUrls: validatedData.redirectUrls || [],
      icon: validatedData.icon,
      scopes: validatedData.scopes,
      status: 'active',
      isInternal: false,
    });

    await app.save();

    logger.info('Developer app created', { userId, appId: app._id, appName: app.name });

    res.status(201).json({ app: serializeApp(app) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    logger.error('Error creating developer app:', error);
    res.status(500).json({ error: 'Failed to create app' });
  }
});

// Get single app
router.get('/apps/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const app = await DeveloperApp.findOne({
      _id: req.params.id,
      developerUserId: userId,
      status: { $ne: 'deleted' },
    });

    if (!app) return res.status(404).json({ error: 'App not found' });

    res.json({ app: serializeApp(app) });
  } catch (error: any) {
    logger.error('Error getting developer app:', error);
    res.status(500).json({ error: 'Failed to get app' });
  }
});

// Update app
router.patch('/apps/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const validatedData = updateAppSchema.parse(req.body);

    const app = await DeveloperApp.findOne({
      _id: req.params.id,
      developerUserId: userId,
      status: { $ne: 'deleted' },
    });

    if (!app) return res.status(404).json({ error: 'App not found' });

    // Map isActive to status
    if (validatedData.isActive !== undefined) {
      app.status = validatedData.isActive ? 'active' : 'suspended';
    }
    if (validatedData.name !== undefined) app.name = validatedData.name;
    if (validatedData.description !== undefined) app.description = validatedData.description;
    if (validatedData.websiteUrl !== undefined) app.websiteUrl = validatedData.websiteUrl || undefined;
    if (validatedData.redirectUrls !== undefined) app.redirectUrls = validatedData.redirectUrls;
    if (validatedData.icon !== undefined) app.icon = validatedData.icon;
    if (validatedData.scopes !== undefined) app.scopes = validatedData.scopes;
    if (validatedData.devWebhookUrl !== undefined) app.devWebhookUrl = validatedData.devWebhookUrl || undefined;

    if (validatedData.webhookUrl !== undefined && validatedData.webhookUrl !== app.webhookUrl) {
      app.webhookUrl = validatedData.webhookUrl;
      app.webhookSecret = crypto.randomBytes(24).toString('hex');
    }

    await app.save();

    logger.info('Developer app updated', { userId, appId: app._id });

    res.json({ app: serializeApp(app) });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    logger.error('Error updating developer app:', error);
    res.status(500).json({ error: 'Failed to update app' });
  }
});

// Regenerate API secret
router.post('/apps/:id/regenerate-secret', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const app = await DeveloperApp.findOne({ _id: req.params.id, developerUserId: userId });
    if (!app) return res.status(404).json({ error: 'App not found' });

    app.apiSecret = crypto.randomBytes(32).toString('hex');
    await app.save();

    logger.info('API secret regenerated', { userId, appId: app._id });

    res.json({
      apiSecret: app.apiSecret,
      warning: 'Save the new API Secret now - it will not be shown again!',
    });
  } catch (error: any) {
    logger.error('Error regenerating API secret:', error);
    res.status(500).json({ error: 'Failed to regenerate secret' });
  }
});

// Delete app (cascade deletes keys + usage)
router.delete('/apps/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const app = await DeveloperApp.findOneAndDelete({
      _id: req.params.id,
      developerUserId: userId,
      status: { $ne: 'deleted' },
    });

    if (!app) return res.status(404).json({ error: 'App not found' });

    // Cascade delete API keys and usage
    await DeveloperApiKey.deleteMany({ appId: app._id, userId });
    await ApiKeyUsage.deleteMany({ appId: app._id, userId });

    logger.info('Developer app deleted', { userId, appId: app._id });

    res.json({ message: 'App deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting developer app:', error);
    res.status(500).json({ error: 'Failed to delete app' });
  }
});

// ============================================
// APP USAGE STATISTICS
// ============================================

router.get('/apps/:appId/usage', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { appId } = req.params;
    const app = await DeveloperApp.findOne({ _id: appId, developerUserId: userId, status: { $ne: 'deleted' } });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const period = (req.query.period as string) || '7d';
    const startDate = getStartDate(period);

    const stats = await getUsageStats({
      appId: new mongoose.Types.ObjectId(appId),
      timestamp: { $gte: startDate },
    });

    res.json(stats);
  } catch (error: any) {
    logger.error('Error fetching app usage:', error);
    res.status(500).json({ error: 'Failed to fetch usage statistics' });
  }
});

// ============================================
// API KEYS ROUTES
// ============================================

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(apiKeyScopesEnum)).default(['chat:completions', 'models:read']),
  expiresAt: z.string().datetime().optional(),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.enum(apiKeyScopesEnum)).optional(),
  isActive: z.boolean().optional(),
});

// List keys for an app
router.get('/apps/:appId/keys', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { appId } = req.params;
    const app = await DeveloperApp.findOne({ _id: appId, developerUserId: userId, status: { $ne: 'deleted' } });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const keys = await DeveloperApiKey.find({ appId, userId })
      .select('-keyHash')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ keys });
  } catch (error: any) {
    logger.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create API key
router.post('/apps/:appId/keys', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { appId } = req.params;
    const app = await DeveloperApp.findOne({ _id: appId, developerUserId: userId, status: { $ne: 'deleted' } });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const validatedData = createApiKeySchema.parse(req.body);

    // Generate key
    const plainKey = 'oxy_dk_' + crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.substring(0, 16);

    const apiKey = new DeveloperApiKey({
      userId,
      appId,
      name: validatedData.name,
      keyHash,
      keyPrefix,
      scopes: validatedData.scopes,
      expiresAt: validatedData.expiresAt ? new Date(validatedData.expiresAt) : null,
    });

    await apiKey.save();

    // Return plain key only this one time
    const keyResponse = apiKey.toObject();
    delete (keyResponse as any).keyHash;
    (keyResponse as any).key = plainKey;

    res.status(201).json({
      apiKey: keyResponse,
      warning: 'This is the only time you will see this key. Please save it securely.',
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    logger.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Update API key
router.patch('/apps/:appId/keys/:keyId', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { appId, keyId } = req.params;
    const app = await DeveloperApp.findOne({ _id: appId, developerUserId: userId, status: { $ne: 'deleted' } });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const validatedData = updateApiKeySchema.parse(req.body);

    const apiKey = await DeveloperApiKey.findOneAndUpdate(
      { _id: keyId, appId, userId },
      { $set: validatedData },
      { new: true }
    ).select('-keyHash');

    if (!apiKey) return res.status(404).json({ error: 'API key not found' });

    res.json({ apiKey });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    logger.error('Error updating API key:', error);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// Delete API key
router.delete('/apps/:appId/keys/:keyId', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { appId, keyId } = req.params;
    const app = await DeveloperApp.findOne({ _id: appId, developerUserId: userId, status: { $ne: 'deleted' } });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const apiKey = await DeveloperApiKey.findOneAndDelete({ _id: keyId, appId, userId });
    if (!apiKey) return res.status(404).json({ error: 'API key not found' });

    // Cascade delete usage
    await ApiKeyUsage.deleteMany({ apiKeyId: new mongoose.Types.ObjectId(keyId), userId });

    res.json({ message: 'API key deleted successfully' });
  } catch (error: any) {
    logger.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Per-key usage
router.get('/apps/:appId/keys/:keyId/usage', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { appId, keyId } = req.params;
    const app = await DeveloperApp.findOne({ _id: appId, developerUserId: userId, status: { $ne: 'deleted' } });
    if (!app) return res.status(404).json({ error: 'App not found' });

    const apiKey = await DeveloperApiKey.findOne({ _id: keyId, appId, userId });
    if (!apiKey) return res.status(404).json({ error: 'API key not found' });

    const period = (req.query.period as string) || '7d';
    const startDate = getStartDate(period);

    const stats = await getUsageStats({
      apiKeyId: new mongoose.Types.ObjectId(keyId),
      timestamp: { $gte: startDate },
    });

    res.json(stats);
  } catch (error: any) {
    logger.error('Error fetching key usage:', error);
    res.status(500).json({ error: 'Failed to fetch usage statistics' });
  }
});

export default router;
