import express from 'express';
import multer from 'multer';
import { AssetService } from '../services/assetService';
import { createS3Service } from '../services/s3Service';
import { authMiddleware } from '../middleware/auth';
import { optionalAuthMiddleware, getUserId } from '../middleware/optionalAuth';
import { mediaHeadersMiddleware } from '../middleware/mediaHeaders';
import { logger } from '../utils/logger';
import { asyncHandler, sendSuccess } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError, ValidationError, ConflictError } from '../utils/error';
import { z } from 'zod';
import { FileVisibility } from '../models/File';
import { generateMissingFilePlaceholder, TRANSPARENT_PNG_PLACEHOLDER } from '../utils/placeholders';

interface AuthenticatedRequest extends express.Request {
  user?: {
    _id: string;
    [key: string]: any;
  };
}

const router = express.Router();
const upload = multer(); // memory storage

// Auth applied per-route: authMiddleware for private routes,
// optionalAuthMiddleware for public stream/download endpoints.

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
  visibility: z.enum(['private', 'public', 'unlisted']).optional(),
  metadata: z.record(z.any()).optional()
});

const linkFileSchema = z.object({
  app: z.string().min(1, 'App name is required'),
  entityType: z.string().min(1, 'Entity type is required'),
  entityId: z.string().min(1, 'Entity ID is required'),
  visibility: z.enum(['private', 'public', 'unlisted']).optional()
  ,
  webhookUrl: z.string().url().optional()
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
router.get('/', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const { files, total } = await assetService.listFilesByUser(user._id, limit, offset);

  sendSuccess(res, {
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
}));

/**
 * @route POST /api/assets/init
 * @desc Initialize file upload - returns pre-signed URL and file ID
 * @access Private
 */
router.post('/init', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  let validatedData;
  try {
    validatedData = initUploadSchema.parse(req.body);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      throw new ValidationError('Invalid request data', { details: error.errors });
    }
    throw error;
  }
  
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

  sendSuccess(res, result);
}));

/**
 * @route POST /api/assets/complete
 * @desc Complete file upload - commit metadata and trigger variant generation
 * @access Private
 */
router.post('/complete', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  let validatedData;
  try {
    validatedData = completeUploadSchema.parse(req.body);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      throw new ValidationError('Invalid request data', { details: error.errors });
    }
    throw error;
  }
  
  const file = await assetService.completeUpload(validatedData);

  logger.info('Asset upload completed', { 
    userId: user._id, 
    fileId: file._id,
    originalName: validatedData.originalName
  });

  sendSuccess(res, {
    assetId: file._id.toString(),
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
}));

/**
 * @route POST /api/assets/:id/upload-direct
 * @desc Direct upload via API (bypasses browser CORS for presigned PUT)
 * @access Private
 */
router.post('/:id/upload-direct', authMiddleware, upload.single('file'), asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  if (!req.file) {
    throw new BadRequestError('Missing file');
  }

  const file = await assetService.getFile(fileId);
  if (!file) {
    throw new NotFoundError('File not found');
  }
  if (file.status === 'deleted') {
    throw new BadRequestError('Cannot upload to deleted file');
  }

  // Upload buffer to the predetermined storageKey
  await s3Service.uploadBuffer(file.storageKey, req.file.buffer, {
    contentType: req.file.mimetype || file.mime || 'application/octet-stream'
  });

  sendSuccess(res, { fileId, key: file.storageKey });
}));

/**
 * @route POST /api/assets/upload
 * @desc Upload file directly - backend calculates SHA256
 * @access Private
 */
router.post('/upload', authMiddleware, upload.single('file'), asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  if (!req.file) {
    throw new BadRequestError('Missing file');
  }

  const visibility = (req.body.visibility as FileVisibility) || 'private';
  let metadata: Record<string, unknown> | undefined;
  if (req.body.metadata) {
    try {
      metadata = JSON.parse(req.body.metadata);
    } catch {
      throw new BadRequestError('Invalid metadata JSON');
    }
  }

  const file = await assetService.uploadFileDirect(
    user._id,
    req.file.buffer,
    req.file.mimetype || 'application/octet-stream',
    req.file.originalname || req.file.fieldname || 'upload',
    visibility,
    metadata
  );

  logger.info('File uploaded via direct endpoint', { 
    userId: user._id, 
    fileId: file._id,
    sha256: file.sha256
  });

  sendSuccess(res, {
    file: {
      id: file._id.toString(),
      sha256: file.sha256,
      size: file.size,
      mime: file.mime,
      ext: file.ext,
      originalName: file.originalName,
      visibility: file.visibility,
      metadata: file.metadata,
      links: file.links,
      variants: file.variants
    }
  });
}));

/**
 * @route POST /api/assets/:id/links
 * @desc Link file to an entity
 * @access Private
 */
router.post('/:id/links', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  let validatedData;
  try {
    validatedData = linkFileSchema.parse(req.body);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      throw new ValidationError('Invalid request data', { details: error.errors });
    }
    throw error;
  }
  
  const linkRequest = {
    ...validatedData,
    createdBy: user._id,
    webhookUrl: (validatedData as any).webhookUrl
  };

  const file = await assetService.linkFile(fileId, linkRequest);

  logger.info('File linked successfully', { 
    userId: user._id, 
    fileId,
    linkRequest
  });

  sendSuccess(res, {
    assetId: file._id.toString(),
    file: {
      id: file._id,
      usageCount: file.usageCount,
      links: file.links,
      status: file.status
    }
  });
}));

/**
 * @route DELETE /api/assets/:id/links
 * @desc Remove link from file
 * @access Private
 */
router.delete('/:id/links', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  let validatedData;
  try {
    validatedData = unlinkFileSchema.parse(req.body);
  } catch (error: any) {
    if (error.name === 'ZodError') {
      throw new ValidationError('Invalid request data', { details: error.errors });
    }
    throw error;
  }
  
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

  sendSuccess(res, {
    file: {
      id: file._id,
      usageCount: file.usageCount,
      links: file.links,
      status: file.status
    }
  });
}));

/**
 * @route GET /api/assets/:id
 * @desc Get file metadata with links and variants
 * @access Private
 */
router.get('/:id', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  const file = await assetService.getFile(fileId);

  if (!file) {
    throw new NotFoundError('File not found');
  }

  logger.debug('File metadata retrieved', {
    userId: user._id,
    fileId
  });

  sendSuccess(res, {
    assetId: file._id.toString(),
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
}));

/**
 * @route GET /api/assets/:id/url
 * @desc Get file URL (CDN or signed URL)
 * @access Private
 */
router.get('/:id/url', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  const { variant, expiresIn } = req.query;

  const variantType = typeof variant === 'string' ? variant : undefined;
  const expiry = typeof expiresIn === 'string' ? parseInt(expiresIn) : 3600;

  const file = await assetService.getFile(fileId);
  if (!file) {
    throw new NotFoundError('File not found');
  }

  const url = await assetService.getFileUrl(fileId, variantType, expiry, file);

  logger.debug('File URL generated', { 
    userId: user._id, 
    fileId,
    variant: variantType
  });

  sendSuccess(res, {
    url,
    variant: variantType,
    expiresIn: expiry
  });
}));

/**
 * @route GET /api/assets/:id/exists
 * @desc Debug: return storageKey and existence of the underlying object
 * @access Private
 */
router.get('/:id/exists', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  const file = await assetService.getFile(fileId);
  if (!file) {
    throw new NotFoundError('File not found');
  }

  const exists = await s3Service.fileExists(file.storageKey);
  sendSuccess(res, {
    fileId,
    storageKey: file.storageKey,
    exists,
    hasVariants: Array.isArray(file.variants) && file.variants.length > 0
  });
}));

/**
 * @route GET /api/assets/:id/stream
 * @desc Stream file bytes with correct headers to avoid browser ORB blocking
 * @access Public (with optional authentication for private files)
 */
router.get('/:id/stream', mediaHeadersMiddleware, optionalAuthMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const userId = getUserId(req);
  const { id: fileId } = req.params;
  const { variant } = req.query;
  const variantType = typeof variant === 'string' ? variant : undefined;

  const fallback = typeof req.query.fallback === 'string' ? req.query.fallback : '';

  const file = await assetService.getFile(fileId);
  if (!file) {
    if (fallback === 'placeholderVisible' || fallback === 'icon') {
      const svg = generateMissingFilePlaceholder(fileId);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(svg);
    }
    if (fallback === 'placeholder') {
      const buf = Buffer.from(TRANSPARENT_PNG_PLACEHOLDER, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(buf);
    }
    throw new NotFoundError('File not found');
  }

  let context: any = undefined;
  if (typeof req.query.context === 'string') {
     const parts = req.query.context.split(':');
     if (parts.length >= 3) {
         context = { app: parts[0], entityType: parts[1], entityId: parts[2] };
     }
  }

  if (!(await assetService.canUserAccessFile(file, userId, context))) {
    logger.warn('Access denied to file', { fileId, userId, visibility: file.visibility });
    if (fallback === 'placeholderVisible' || fallback === 'icon') {
      const svg = generateMissingFilePlaceholder(fileId);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(svg);
    }
    if (fallback === 'placeholder') {
      const buf = Buffer.from(TRANSPARENT_PNG_PLACEHOLDER, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(buf);
    }
    throw new ForbiddenError('Access denied');
  }

  // Resolve variant storageKey if requested
  let storageKey = file.storageKey;
  if (variantType) {
    try {
      const ensured = await assetService.ensureVariant(fileId, variantType, file);
      storageKey = ensured.key;
    } catch (e: any) {
      logger.warn('Variant ensure failed, falling back to original', { fileId, variantType, error: e?.message });
    }
  }

  // Redirect to presigned S3 URL — browser fetches image directly from S3/Spaces
  // with no auth required. This avoids ERR_BLOCKED_BY_ORB from expired tokens
  // because the presigned URL IS the authorization (valid 1 hour).
  try {
    const url = await s3Service.getPresignedDownloadUrl(storageKey, 3600);
    const cacheControl = file.visibility === 'public'
      ? 'public, max-age=3600'
      : 'private, max-age=3600';
    res.setHeader('Cache-Control', cacheControl);
    return res.redirect(url);
  } catch (e) {
    logger.warn('Failed to generate presigned URL, falling back to stream', { fileId, error: e });
  }

  // Fallback: stream through our server if presigned URL generation fails
  try {
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
  } catch (streamError: any) {
    if (streamError.name === 'NoSuchKey' || streamError.name === 'NotFound') {
      if (fallback === 'placeholder') {
        const buf = Buffer.from(TRANSPARENT_PNG_PLACEHOLDER, 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).end(buf);
      }
      if (fallback === 'icon' || fallback === 'placeholderVisible') {
        const svg = generateMissingFilePlaceholder(fileId);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).end(svg);
      }
      throw new NotFoundError('File not found');
    }
    throw streamError;
  }
}));

/**
 * @route GET /api/assets/:id/download
 * @desc Redirect to the signed file URL (suitable for <img src> and direct downloads)
 * @access Public (with optional authentication for private files)
 */
router.get('/:id/download', optionalAuthMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const userId = getUserId(req);
  const { id: fileId } = req.params;
  const { variant, expiresIn } = req.query;

  // Get file and check permissions
  const file = await assetService.getFile(fileId);
  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Check access permissions
  if (!(await assetService.canUserAccessFile(file, userId))) {
    logger.warn('Access denied to file download', { fileId, userId, visibility: file.visibility });
    throw new ForbiddenError('Access denied');
  }

  const variantType = typeof variant === 'string' ? variant : undefined;
  const expiry = typeof expiresIn === 'string' ? parseInt(expiresIn) : 3600;

  const url = await assetService.getFileUrl(fileId, variantType, expiry, file);
  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.redirect(url);
}));

/**
 * @route POST /api/assets/:id/restore
 * @desc Restore file from trash
 * @access Private
 */
router.post('/:id/restore', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  const file = await assetService.restoreFile(fileId);

  logger.info('File restored from trash', { 
    userId: user._id, 
    fileId
  });

  sendSuccess(res, {
    file: {
      id: file._id,
      status: file.status,
      usageCount: file.usageCount
    }
  });
}));

/**
 * @route PATCH /api/assets/:id/visibility
 * @desc Update file visibility
 * @access Private
 */
router.patch('/:id/visibility', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  const { visibility } = req.body;

  // Validate visibility value
  if (!visibility || !['private', 'public', 'unlisted'].includes(visibility)) {
    throw new BadRequestError('Visibility must be one of: private, public, unlisted');
  }

  // Get file and verify ownership
  const file = await assetService.getFile(fileId);
  if (!file) {
    throw new NotFoundError('File not found');
  }

  // Compare as strings (handle ObjectId vs string comparison)
  if (file.ownerUserId.toString() !== user._id.toString()) {
    throw new ForbiddenError('Access denied');
  }

  // Only update if visibility is actually changing
  if (file.visibility === visibility) {
    // No change needed, return current file
    return sendSuccess(res, {
      file: {
        id: file._id,
        visibility: file.visibility,
        updatedAt: file.updatedAt
      }
    });
  }

  // Update visibility
  const updatedFile = await assetService.updateFileVisibility(fileId, visibility as FileVisibility);

  logger.info('File visibility updated', { 
    userId: user._id, 
    fileId,
    visibility
  });

  sendSuccess(res, {
    file: {
      id: updatedFile._id,
      visibility: updatedFile.visibility,
      updatedAt: updatedFile.updatedAt
    }
  });
}));

/**
 * @route DELETE /api/assets/:id
 * @desc Delete file with impact summary
 * @access Private
 */
router.delete('/:id', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  if (!user?._id) {
    throw new UnauthorizedError('Authentication required');
  }

  const { id: fileId } = req.params;
  const { force } = req.query;
  const forceDelete = force === 'true';

  // Get deletion summary first
  const summary = await assetService.getDeletionSummary(fileId);

  // If not forcing and there are active links, return summary
  if (!forceDelete && summary.remainingLinks > 0) {
    throw new ConflictError('File has active links', {
      summary,
      message: 'Use ?force=true to delete anyway'
    });
  }

  // Proceed with deletion
  await assetService.deleteFile(fileId, forceDelete, user._id);

  logger.info('File deleted', { 
    userId: user._id, 
    fileId,
    force: forceDelete,
    summary
  });

  sendSuccess(res, {
    summary,
    message: 'File deleted successfully'
  });
}));

/**
 * @route POST /api/assets/batch-access
 * @desc Check access for multiple files
 * @access Private
 */
router.post('/batch-access', authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
  const user = req.user;
  const { fileIds, context } = req.body;

  if (!Array.isArray(fileIds)) {
    throw new BadRequestError('fileIds must be an array');
  }

  if (fileIds.length > 100) {
    throw new BadRequestError('Batch size limit exceeded (max 100)');
  }

  const files = await assetService.getFilesByIds(fileIds);
  const results: Record<string, any> = {};

  await Promise.all(files.map(async (file) => {
    const canAccess = await assetService.canUserAccessFile(file, user?._id, context);
    
    if (canAccess) {
      const url = await assetService.getFileUrl(file._id.toString(), undefined, 3600, file);
      results[file._id.toString()] = {
        allowed: true,
        url,
        visibility: file.visibility,
        mime: file.mime
      };
    } else {
      results[file._id.toString()] = {
        allowed: false,
        error: 'Access denied'
      };
    }
  }));
  
  // Handle missing files
  fileIds.forEach(id => {
      // We need to check if we found the file. Since _id is ObjectId, we need to be careful with comparison.
      const found = files.some(f => f._id.toString() === id);
      if (!found) {
          results[id] = { allowed: false, error: 'File not found' };
      }
  });

  sendSuccess(res, { results });
}));

export default router;