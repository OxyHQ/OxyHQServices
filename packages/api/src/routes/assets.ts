import express from 'express';
import multer from 'multer';
import { AssetService } from '../services/assetService';
import { createS3Service } from '../services/s3Service';
import { authMiddleware } from '../middleware/auth';
import { mediaHeadersMiddleware } from '../middleware/mediaHeaders';
import { logger } from '../utils/logger';
import { z } from 'zod';

interface AuthenticatedRequest extends express.Request {
  user?: {
    _id: string;
    [key: string]: any;
  };
}

const router = express.Router();
const upload = multer(); // memory storage

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
 * @route GET /api/assets
 * @desc List authenticated user's files (Central Asset Service)
 * @access Private
 */
router.get('/', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const { files, total } = await assetService.listFilesByUser(user._id, limit, offset);

    res.json({
      files: files.map((file) => ({
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
        metadata: file.metadata,
      })),
      total,
      hasMore: offset + files.length < total,
    });
  } catch (error: any) {
    logger.error('Asset list error:', error);
    res.status(500).json({ error: 'Failed to list assets', message: error.message });
  }
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
 * @route POST /api/assets/:id/upload-direct
 * @desc Direct upload via API (bypasses browser CORS for presigned PUT)
 * @access Private
 */
router.post('/:id/upload-direct', upload.single('file'), async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    const file = await assetService.getFile(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    if (file.status === 'deleted') {
      return res.status(400).json({ error: 'Cannot upload to deleted file' });
    }

    // Upload buffer to the predetermined storageKey
    await s3Service.uploadBuffer(file.storageKey, req.file.buffer, {
      contentType: req.file.mimetype || file.mime || 'application/octet-stream'
    });

    return res.json({ success: true, fileId, key: file.storageKey });
  } catch (error: any) {
    logger.error('Direct asset upload error:', error);
    return res.status(500).json({ error: 'Failed to upload file', message: error.message });
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

    if (error.message?.includes('File not found in storage')) {
      return res.status(404).json({ error: 'File not found' });
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
 * @route GET /api/assets/:id/exists
 * @desc Debug: return storageKey and existence of the underlying object
 * @access Private
 */
router.get('/:id/exists', async (req: AuthenticatedRequest, res: express.Response) => {
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

    const exists = await s3Service.fileExists(file.storageKey);
    return res.json({
      success: true,
      fileId,
      storageKey: file.storageKey,
      exists,
      hasVariants: Array.isArray(file.variants) && file.variants.length > 0
    });
  } catch (error: any) {
    logger.error('Asset exists debug error:', error);
    return res.status(500).json({ error: 'Failed to check asset', message: error.message });
  }
});

/**
 * @route GET /api/assets/:id/stream
 * @desc Stream file bytes with correct headers to avoid browser ORB blocking
 * @access Private
 */
router.get('/:id/stream', mediaHeadersMiddleware, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const user = req.user;
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: fileId } = req.params;
    const { variant } = req.query;
    const variantType = typeof variant === 'string' ? variant : undefined;

    // Resolve storage key like in AssetService.getFileUrl
    const file = await assetService.getFile(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const originalKey = file.storageKey;
    let storageKey = originalKey;
    if (variantType) {
      try {
        // Ensure the requested variant exists (generate if needed)
        const ensured = await assetService.ensureVariant(fileId, variantType);
        storageKey = ensured.key;
      } catch (e: any) {
        logger.warn('Variant ensure failed, falling back to original', { fileId, variantType, error: e?.message });
        storageKey = originalKey;
      }
    }

    // Ensure object exists before streaming
    const exists = await s3Service.fileExists(storageKey);
    if (!exists) {
      // Optional placeholder fallback for UI
      const fallback = typeof req.query.fallback === 'string' ? req.query.fallback : '';
      if (fallback === 'placeholder') {
        // 1x1 transparent PNG (invisible)
        const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
        const buf = Buffer.from(pngBase64, 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).end(buf);
      }
      if (fallback === 'icon' || fallback === 'placeholderVisible') {
        // Visible SVG placeholder
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200" role="img" aria-label="Missing file">
  <defs>
    <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="16" height="16" fill="#f3f4f6"/>
      <path d="M16 0H0V16" fill="none" stroke="#e5e7eb" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <g fill="none" stroke="#9ca3af" stroke-width="3">
    <rect x="8" y="8" width="304" height="184" rx="8"/>
    <path d="M80 140l40-40 30 30 40-50 50 60"/>
    <circle cx="115" cy="88" r="10"/>
  </g>
  <text x="50%" y="50%" text-anchor="middle" fill="#6b7280" font-family="sans-serif" font-size="14" dy="56">Missing or deleted</text>
  <text x="50%" y="50%" text-anchor="middle" fill="#9ca3af" font-family="sans-serif" font-size="12" dy="76">id: ${fileId}</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
        return res.status(200).end(svg);
      }
      return res.status(404).json({ error: 'File not found' });
    }

    // Stream from S3/Spaces
    const streamInfo = await s3Service.getObjectStream(storageKey);
    
    if (streamInfo.contentType) {
      res.setHeader('Content-Type', streamInfo.contentType);
    }
    if (streamInfo.contentLength) {
      res.setHeader('Content-Length', String(streamInfo.contentLength));
    }
    if (streamInfo.lastModified) {
      res.setHeader('Last-Modified', new Date(streamInfo.lastModified).toUTCString());
    }
    // Cache headers: immutable for content-addressed files
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    streamInfo.body.on('error', (err: any) => {
      logger.error('Stream error', { err });
      if (!res.headersSent) {
        res.status(500).end('Stream error');
      } else {
        res.end();
      }
    });

    streamInfo.body.pipe(res);
  } catch (error: any) {
    logger.error('Asset stream error:', error);
    if (error.message?.includes('not found') || error?.Code === 'NoSuchKey' || error?.code === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(500).json({ error: 'Failed to stream file', message: error.message });
  }
});

/**
 * @route GET /api/assets/:id/download
 * @desc Redirect to the signed file URL (suitable for <img src> and direct downloads)
 * @access Private
 */
router.get('/:id/download', async (req: AuthenticatedRequest, res: express.Response) => {
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
  // Set short cache headers for redirect to reduce load while respecting expirations
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.redirect(url);
  } catch (error: any) {
    logger.error('Asset download redirect error:', error);

    if (error.message === 'File not found') {
      return res.status(404).json({ error: error.message });
    }

    if (error.message?.includes('File not found in storage')) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (error.message.includes('Variant') && error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to generate download URL', message: error.message });
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