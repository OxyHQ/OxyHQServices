import express from 'express';
import crypto from 'crypto';
import { DeveloperApp, IDeveloperApp } from '../models/DeveloperApp';
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

// Require authentication for all developer app routes
router.use(authMiddleware);

// Validation schemas
const createAppSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  webhookUrl: z.string().url('Invalid production webhook URL'),
  devWebhookUrl: z.string().url('Invalid development webhook URL').optional().nullable(),
  scopes: z.array(z.enum(['files:read', 'files:write', 'files:delete', 'user:read', 'webhooks:receive'])).optional()
});

const updateAppSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  webhookUrl: z.string().url('Invalid production webhook URL').optional(),
  devWebhookUrl: z.string().url('Invalid development webhook URL').optional().nullable(),
  scopes: z.array(z.enum(['files:read', 'files:write', 'files:delete', 'user:read', 'webhooks:receive'])).optional()
});

/**
 * Generate API key and secret
 */
function generateCredentials() {
  const apiKey = 'oxy_dk_' + crypto.randomBytes(24).toString('hex'); // oxy_dk_ prefix for developer key
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const webhookSecret = crypto.randomBytes(24).toString('hex');
  return { apiKey, apiSecret, webhookSecret };
}

/**
 * @route GET /api/developer/apps
 * @desc List user's developer apps
 * @access Private
 */
router.get('/apps', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const apps = await DeveloperApp.find({
      developerUserId: user._id,
      status: { $ne: 'deleted' }
    }).sort({ createdAt: -1 });

    // Don't expose apiSecret in list
    const sanitizedApps = apps.map(app => ({
      id: app._id,
      name: app.name,
      description: app.description,
      apiKey: app.apiKey,
      webhookUrl: app.webhookUrl,
      devWebhookUrl: app.devWebhookUrl,
      status: app.status,
      scopes: app.scopes,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      lastUsedAt: app.lastUsedAt
    }));

    res.json({
      success: true,
      apps: sanitizedApps
    });
  } catch (error: any) {
    logger.error('Error listing developer apps:', error);
    res.status(500).json({ error: 'Failed to list apps', message: error.message });
  }
});

/**
 * @route POST /api/developer/apps
 * @desc Create new developer app
 * @access Private
 */
router.post('/apps', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = createAppSchema.parse(req.body);
    
    // Check app limit (max 10 apps per user)
    const existingAppsCount = await DeveloperApp.countDocuments({
      developerUserId: user._id,
      status: { $ne: 'deleted' }
    });

    if (existingAppsCount >= 10) {
      return res.status(400).json({ 
        error: 'App limit reached',
        message: 'Maximum 10 apps per developer'
      });
    }

    // Generate credentials
    const { apiKey, apiSecret, webhookSecret } = generateCredentials();

    // Create app
    const app = new DeveloperApp({
      name: validatedData.name,
      description: validatedData.description,
      developerUserId: user._id,
      apiKey,
      apiSecret,
      webhookUrl: validatedData.webhookUrl,
      devWebhookUrl: validatedData.devWebhookUrl,
      webhookSecret: webhookSecret,
      scopes: validatedData.scopes,
      status: 'active'
    });

    await app.save();

    logger.info('Developer app created', {
      userId: user._id,
      appId: app._id,
      appName: app.name
    });

    // Return with apiSecret only on creation (never again!)
    res.status(201).json({
      success: true,
      app: {
        id: app._id,
        name: app.name,
        description: app.description,
        apiKey: app.apiKey,
        apiSecret: app.apiSecret, // ⚠️ Only shown once!
        webhookUrl: app.webhookUrl,
        devWebhookUrl: app.devWebhookUrl,
        webhookSecret: app.webhookSecret, // ⚠️ Only shown once!
        status: app.status,
        scopes: app.scopes,
        createdAt: app.createdAt
      },
      warning: 'Save the API Secret and Webhook Secret now - they will not be shown again!'
    });
  } catch (error: any) {
    logger.error('Error creating developer app:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }

    res.status(500).json({ 
      error: 'Failed to create app',
      message: error.message 
    });
  }
});

/**
 * @route GET /api/developer/apps/:id
 * @desc Get developer app details
 * @access Private
 */
router.get('/apps/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const app = await DeveloperApp.findById(req.params.id);
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (app.developerUserId !== user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      success: true,
      app: {
        id: app._id,
        name: app.name,
        description: app.description,
        apiKey: app.apiKey,
        webhookUrl: app.webhookUrl,
        devWebhookUrl: app.devWebhookUrl,
        status: app.status,
        scopes: app.scopes,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt,
        lastUsedAt: app.lastUsedAt
      }
    });
  } catch (error: any) {
    logger.error('Error getting developer app:', error);
    res.status(500).json({ error: 'Failed to get app', message: error.message });
  }
});

/**
 * @route PATCH /api/developer/apps/:id
 * @desc Update developer app
 * @access Private
 */
router.patch('/apps/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = updateAppSchema.parse(req.body);
    
    const app = await DeveloperApp.findById(req.params.id);
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (app.developerUserId !== user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update fields
    if (validatedData.name !== undefined) app.name = validatedData.name;
    if (validatedData.description !== undefined) app.description = validatedData.description;
    if (validatedData.scopes !== undefined) app.scopes = validatedData.scopes;
    if (validatedData.devWebhookUrl !== undefined) app.devWebhookUrl = validatedData.devWebhookUrl || undefined;
    
    // Handle webhook URL changes (regenerate secret if URL changes)
    if (validatedData.webhookUrl !== undefined && validatedData.webhookUrl !== app.webhookUrl) {
      app.webhookUrl = validatedData.webhookUrl;
      app.webhookSecret = crypto.randomBytes(24).toString('hex');
    }

    await app.save();

    logger.info('Developer app updated', {
      userId: user._id,
      appId: app._id
    });

    res.json({
      success: true,
      app: {
        id: app._id,
        name: app.name,
        description: app.description,
        apiKey: app.apiKey,
        webhookUrl: app.webhookUrl,
        devWebhookUrl: app.devWebhookUrl,
        webhookSecret: validatedData.webhookUrl && validatedData.webhookUrl !== app.webhookUrl ? app.webhookSecret : undefined,
        status: app.status,
        scopes: app.scopes,
        updatedAt: app.updatedAt
      },
      message: validatedData.webhookUrl && app.webhookSecret ? 'New webhook secret generated - save it now!' : undefined
    });
  } catch (error: any) {
    logger.error('Error updating developer app:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }

    res.status(500).json({ 
      error: 'Failed to update app',
      message: error.message 
    });
  }
});

/**
 * @route POST /api/developer/apps/:id/regenerate-secret
 * @desc Regenerate API secret
 * @access Private
 */
router.post('/apps/:id/regenerate-secret', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const app = await DeveloperApp.findById(req.params.id);
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (app.developerUserId !== user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Generate new secret
    app.apiSecret = crypto.randomBytes(32).toString('hex');
    await app.save();

    logger.info('API secret regenerated', {
      userId: user._id,
      appId: app._id
    });

    res.json({
      success: true,
      apiSecret: app.apiSecret,
      warning: 'Save the new API Secret now - it will not be shown again!'
    });
  } catch (error: any) {
    logger.error('Error regenerating API secret:', error);
    res.status(500).json({ error: 'Failed to regenerate secret', message: error.message });
  }
});

/**
 * @route DELETE /api/developer/apps/:id
 * @desc Delete developer app
 * @access Private
 */
router.delete('/apps/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const app = await DeveloperApp.findById(req.params.id);
    
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    if (app.developerUserId !== user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    app.status = 'deleted';
    await app.save();

    logger.info('Developer app deleted', {
      userId: user._id,
      appId: app._id
    });

    res.json({
      success: true,
      message: 'App deleted successfully'
    });
  } catch (error: any) {
    logger.error('Error deleting developer app:', error);
    res.status(500).json({ error: 'Failed to delete app', message: error.message });
  }
});

export default router;
