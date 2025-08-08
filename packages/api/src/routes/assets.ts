import express from 'express';
import { AssetService } from '../services/assetService';
import { createS3Service } from '../services/s3Service';
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

// Require authentication for all asset routes
router.use(authMiddleware);

// Initialize S3 service and Asset service
const s3Config = {
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  bucketName: process.env.AWS_S3_BUCKET || '',
  endpointUrl: process.env.AWS_ENDPOINT_URL,
};

const s3Service = createS3Service(s3Config);
const assetService = new AssetService(s3Service);

// Validation schemas
const initUploadSchema = z.object({
  sha256: z.string().length(64, 'SHA256 must be 64 characters'),
  size: z.number().positive('Size must be positive'),
  mime: z.string().min(1, 'MIME type is required')
});

const completeUploadSchema = z.object({
  fileId: z.string().min(1, 'File ID is required'),
  originalName: z.string().min(1, 'Original name is required'),
  size: z.number().positive('Size must be positive'),
  mime: z.string().min(1, 'MIME type is required'),
  metadata: z.record(z.any()).optional()
});

const linkFileSchema = z.object({
  app: z.string().min(1, 'App name is required'),
  entityType: z.string().min(1, 'Entity type is required'),
  entityId: z.string().min(1, 'Entity ID is required')
});

const unlinkFileSchema = z.object({
  app: z.string().min(1, 'App name is required'),
  entityType: z.string().min(1, 'Entity type is required'),
  entityId: z.string().min(1, 'Entity ID is required')
});

/**
 * @route POST /api/assets/init
 * @desc Initialize file upload - returns pre-signed URL and file ID
 * @access Private
 */
router.post('/init', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = initUploadSchema.parse(req.body);
    
    const result = await assetService.initUpload(
      user._id,
      validatedData.sha256,
      validatedData.size,
      validatedData.mime
    );

    logger.info('Asset upload initialized', { 
      userId: user._id, 
      fileId: result.fileId,
      sha256: result.sha256
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Asset init error:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }

    res.status(500).json({
      error: 'Failed to initialize asset upload',
      message: error.message
    });
  }
});

/**
 * @route POST /api/assets/complete
 * @desc Complete file upload - commit metadata and trigger variant generation
 * @access Private
 */
router.post('/complete', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const validatedData = completeUploadSchema.parse(req.body);
    
    const file = await assetService.completeUpload(validatedData);

    logger.info('Asset upload completed', { 
      userId: user._id, 
      fileId: file._id,
      originalName: validatedData.originalName
    });

    res.json({
      success: true,
      file: {
        id: file._id,
        sha256: file.sha256,
        size: file.size,
        mime: file.mime,
        originalName: file.originalName,
        status: file.status,
        usageCount: file.usageCount,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        links: file.links,
        variants: file.variants
      }
    });
  } catch (error: any) {
    logger.error('Asset complete error:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }

    res.status(500).json({
      error: 'Failed to complete asset upload',
      message: error.message
    });
  }
});

/**
 * @route POST /api/assets/:id/links
 * @desc Link file to an entity
 * @access Private
 */
router.post('/:id/links', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const validatedData = linkFileSchema.parse(req.body);
    
    const linkRequest = {
      ...validatedData,
      createdBy: user._id
    };

    const file = await assetService.linkFile(fileId, linkRequest);

    logger.info('File linked successfully', { 
      userId: user._id, 
      fileId,
      linkRequest
    });

    res.json({
      success: true,
      file: {
        id: file._id,
        usageCount: file.usageCount,
        links: file.links,
        status: file.status
      }
    });
  } catch (error: any) {
    logger.error('Asset link error:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }

    if (error.message === 'File not found') {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({
      error: 'Failed to link file',
      message: error.message
    });
  }
});

/**
 * @route DELETE /api/assets/:id/links
 * @desc Remove link from file
 * @access Private
 */
router.delete('/:id/links', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const validatedData = unlinkFileSchema.parse(req.body);
    
    const file = await assetService.unlinkFile(
      fileId,
      validatedData.app,
      validatedData.entityType,
      validatedData.entityId
    );

    logger.info('File unlinked successfully', { 
      userId: user._id, 
      fileId,
      unlinkRequest: validatedData
    });

    res.json({
      success: true,
      file: {
        id: file._id,
        usageCount: file.usageCount,
        links: file.links,
        status: file.status
      }
    });
  } catch (error: any) {
    logger.error('Asset unlink error:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Validation error',
        details: error.errors
      });
    }

    if (error.message === 'File not found') {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({
      error: 'Failed to unlink file',
      message: error.message
    });
  }
});

/**
 * @route GET /api/assets/:id
 * @desc Get file metadata with links and variants
 * @access Private
 */
router.get('/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const file = await assetService.getFile(fileId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    logger.debug('File metadata retrieved', { 
      userId: user._id, 
      fileId 
    });

    res.json({
      success: true,
      file: {
        id: file._id,
        sha256: file.sha256,
        size: file.size,
        mime: file.mime,
        ext: file.ext,
        originalName: file.originalName,
        ownerUserId: file.ownerUserId,
        status: file.status,
        usageCount: file.usageCount,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        links: file.links,
        variants: file.variants,
        metadata: file.metadata
      }
    });
  } catch (error: any) {
    logger.error('Asset get error:', error);
    
    res.status(500).json({
      error: 'Failed to get file',
      message: error.message
    });
  }
});

/**
 * @route GET /api/assets/:id/url
 * @desc Get file URL (CDN or signed URL)
 * @access Private
 */
router.get('/:id/url', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const { variant, expiresIn } = req.query;

    const variantType = typeof variant === 'string' ? variant : undefined;
    const expiry = typeof expiresIn === 'string' ? parseInt(expiresIn) : 3600;

    const url = await assetService.getFileUrl(fileId, variantType, expiry);

    logger.debug('File URL generated', { 
      userId: user._id, 
      fileId,
      variant: variantType
    });

    res.json({
      success: true,
      url,
      variant: variantType,
      expiresIn: expiry
    });
  } catch (error: any) {
    logger.error('Asset URL error:', error);
    
    if (error.message === 'File not found') {
      return res.status(404).json({ error: error.message });
    }

    if (error.message.includes('Variant') && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({
      error: 'Failed to get file URL',
      message: error.message
    });
  }
});

/**
 * @route POST /api/assets/:id/restore
 * @desc Restore file from trash
 * @access Private
 */
router.post('/:id/restore', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const file = await assetService.restoreFile(fileId);

    logger.info('File restored from trash', { 
      userId: user._id, 
      fileId
    });

    res.json({
      success: true,
      file: {
        id: file._id,
        status: file.status,
        usageCount: file.usageCount
      }
    });
  } catch (error: any) {
    logger.error('Asset restore error:', error);
    
    if (error.message === 'File not found') {
      return res.status(404).json({ error: error.message });
    }

    if (error.message === 'File is not in trash') {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({
      error: 'Failed to restore file',
      message: error.message
    });
  }
});

/**
 * @route DELETE /api/assets/:id
 * @desc Delete file with impact summary
 * @access Private
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const { force } = req.query;
    const forceDelete = force === 'true';

    // Get deletion summary first
    const summary = await assetService.getDeletionSummary(fileId);

    // If not forcing and there are active links, return summary
    if (!forceDelete && summary.remainingLinks > 0) {
      return res.status(409).json({
        error: 'File has active links',
        summary,
        message: 'Use ?force=true to delete anyway'
      });
    }

    // Proceed with deletion
    await assetService.deleteFile(fileId, forceDelete);

    logger.info('File deleted', { 
      userId: user._id, 
      fileId,
      force: forceDelete,
      summary
    });

    res.json({
      success: true,
      summary,
      message: 'File deleted successfully'
    });
  } catch (error: any) {
    logger.error('Asset delete error:', error);
    
    if (error.message === 'File not found') {
      return res.status(404).json({ error: error.message });
    }

    if (error.message.includes('Cannot delete file with active links')) {
      return res.status(409).json({ 
        error: error.message,
        message: 'Use ?force=true to delete anyway'
      });
    }

    res.status(500).json({
      error: 'Failed to delete file',
      message: error.message
    });
  }
});

export default router;