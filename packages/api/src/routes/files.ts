/**
 * =============================================================================
 * DEPRECATED: Legacy GridFS File Routes (/api/files)
 * =============================================================================
 * 
 * ⚠️  WARNING: This file is DEPRECATED and should NOT be used for new features.
 * 
 * USE INSTEAD: /api/assets routes (see packages/api/src/routes/assets.ts)
 * 
 * Migration Status:
 * - Frontend OxyServices.uploadFile() → Redirects to assetUpload()
 * - Frontend OxyServices.getFile() → Redirects to assetGet()
 * - These routes are maintained for backward compatibility only
 * - All new code should use the Asset Service API
 * 
 * Asset Service Benefits:
 * ✓ Content-addressed storage (SHA256 deduplication)
 * ✓ Visibility control (private/public/unlisted)
 * ✓ Better S3/Spaces integration with presigned URLs
 * ✓ Optimized for CDN and caching
 * ✓ Automatic variant generation support
 * 
 * TODO: Remove this file after confirming no direct API calls to /api/files
 * =============================================================================
 */

import express from 'express';
import multer from 'multer';
import { S3Service, createS3Service, UploadOptions } from '../services/s3Service';
import { AssetService } from '../services/assetService';
import path from 'path';
import { authMiddleware } from '../middleware/auth';
import { mediaHeadersMiddleware } from '../middleware/mediaHeaders';
import { logger } from '../utils/logger';
import {
  handleFileDownload,
  extractFileKey,
  sendFileError,
  FileErrors,
  parsePaginationParams,
  scopeKeyToUser,
} from '../utils/fileUtils';

interface AuthenticatedRequest extends express.Request {
  user?: {
    _id: string;
    [key: string]: any;
  };
  files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
}

const router = express.Router();

// Allow token via query param/cookie for cases like direct download links
router.use((req, _res, next) => {
  const auth = req.headers.authorization as string | undefined;

  // Accept a few query param names for flexibility
  const q = req.query as Record<string, any>;
  const qpToken = [
    typeof q.token === 'string' ? q.token : undefined,
    typeof q.accessToken === 'string' ? q.accessToken : undefined,
    typeof q.auth === 'string' ? q.auth : undefined,
    typeof q.t === 'string' ? q.t : undefined,
  ].find(Boolean) as string | undefined;

  if ((!auth || !auth.startsWith('Bearer ')) && qpToken) {
    (req.headers as any).authorization = `Bearer ${qpToken}`;
  }

  // Basic cookie token support without adding cookie-parser
  if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) && req.headers.cookie) {
    const cookieHeader = req.headers.cookie;
    const parts = cookieHeader.split(';').map(p => p.trim());
    const cookieNames = ['accessToken', 'access_token'];
    const accessCookie = parts.find(p => cookieNames.some(name => p.startsWith(`${name}=`)));
    if (accessCookie) {
      const cookieToken = decodeURIComponent(accessCookie.split('=')[1] || '');
      if (cookieToken) {
        (req.headers as any).authorization = `Bearer ${cookieToken}`;
      }
    }
  }
  next();
});

// Require authentication for all file routes to ensure req.user is available
router.use(authMiddleware);

// Initialize S3 service
const s3Config = {
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  bucketName: process.env.AWS_S3_BUCKET || '',
  endpointUrl: process.env.AWS_ENDPOINT_URL, // For DigitalOcean Spaces
};

console.log('S3 Configuration:', {
  region: s3Config.region,
  bucketName: s3Config.bucketName,
  endpointUrl: s3Config.endpointUrl,
  hasAccessKey: !!s3Config.accessKeyId,
  hasSecretKey: !!s3Config.secretAccessKey,
});

const s3Service = createS3Service(s3Config);
// Back-compat: expose CAS service for legacy routes that should now source from CAS
const assetService = new AssetService(s3Service as unknown as S3Service);

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/json',
      'application/xml',
      'text/csv',
      'video/mp4',
      'audio/mpeg',
      'application/zip',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

console.log('Files route initialized with S3 service');

/**
 * @route GET /api/files/test-connection
 * @desc Test S3/DigitalOcean Spaces connection
 * @access Private
 */
router.get('/test-connection', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    console.log('Testing S3 connection...');
    
    // Try to list files to test connection
    const userPrefix = `users/${req.user?._id}/`;
    const files = await s3Service.listFiles(userPrefix, 1);
    
    console.log('S3 connection test successful');
    res.json({
      success: true,
      message: 'S3 connection test successful',
      fileCount: files.length,
    });
  } catch (error: any) {
    console.error('S3 connection test failed:', error);
    res.status(500).json({
      error: 'S3 connection test failed',
      message: error.message,
      details: error.toString(),
    });
  }
});

/**
 * @route POST /api/files/upload-raw
 * @desc Upload a raw file to S3 (for direct binary uploads)
 * @access Private
 */
router.post('/upload-raw', async (req: AuthenticatedRequest, res: express.Response) => {
  console.log('USER: ', req.user?._id);
  try {
    const user = req.user;

    console.log('Raw file upload request received');
    
    if (!user?._id) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get file information from headers
    const fileName = decodeURIComponent(req.headers['x-file-name'] as string || 'upload.bin');
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const userId = user._id; // Always use the authenticated user's ID
    
    // Read the raw body data
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        
        if (buffer.length === 0) {
          return res.status(400).json({ error: 'No file data provided' });
        }
        
        // Check file size limit (50MB as mentioned in the frontend)
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (buffer.length > maxSize) {
          return res.status(413).json({ error: 'File too large (max 50MB)' });
        }
        
        // Generate unique key with user prefix
        const userFolder = `users/${userId}`;
        const key = s3Service.generateUniqueKey(fileName, userFolder);
        
        // Upload options
        const uploadOptions: UploadOptions = {
          contentType,
          publicRead: false,
          // Don't set folder here since it's already included in the key
          metadata: {
            userId,
            originalName: fileName,
            uploadedAt: new Date().toISOString(),
          },
        };

        // Upload to S3
        const fileInfo = await s3Service.uploadBuffer(key, buffer, uploadOptions);

        logger.info(`Raw file uploaded successfully: ${key} by user ${userId}`);

        // Return in FileMetadata format expected by the frontend
        const response = {
          id: fileInfo.key,
          filename: fileName,
          contentType: fileInfo.contentType || contentType,
          length: fileInfo.size,
          chunkSize: 261120, // GridFS default chunk size for compatibility
          uploadDate: fileInfo.lastModified.toISOString(),
          metadata: fileInfo.metadata,
        };

        res.json(response);
      } catch (error: any) {
        logger.error('Raw file upload error:', error);
        res.status(500).json({
          error: 'Failed to upload file',
          message: error.message,
        });
      }
    });
    
    req.on('error', (error) => {
      logger.error('Raw file upload stream error:', error);
      res.status(500).json({
        error: 'Failed to upload file',
        message: error.message,
      });
    });
    
  } catch (error: any) {
    logger.error('Raw file upload setup error:', error);
    res.status(500).json({
      error: 'Failed to upload file',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/files/upload
 * @desc Upload a file to S3
 * @access Private
 */
router.post('/upload', upload.single('file'), async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { folder, publicRead, metadata } = req.body;
    const file = req.file;
    const user = req.user;
    
    // Generate unique key with user prefix
    const userFolder = `users/${user?._id}`;
    const finalFolder = folder ? `${userFolder}/${folder}` : userFolder;
    const key = s3Service.generateUniqueKey(file.originalname, finalFolder);
    
    // Upload options
    const uploadOptions: UploadOptions = {
      contentType: file.mimetype,
      publicRead: publicRead === 'true',
      // Don't set folder here since it's already included in the key
      metadata: {
        ...(metadata ? JSON.parse(metadata) : {}),
        userId: user?._id,
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      },
    };

    // Upload to S3
    const fileInfo = await s3Service.uploadBuffer(key, file.buffer, uploadOptions);

    logger.info(`File uploaded successfully: ${key} by user ${user?._id}`);

    res.json({
      success: true,
      file: fileInfo,
      message: 'File uploaded successfully',
    });
  } catch (error: any) {
    logger.error('File upload error:', error);
    res.status(500).json({
      error: 'Failed to upload file',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/files/upload-multiple
 * @desc Upload multiple files to S3
 * @access Private
 */
router.post('/upload-multiple', upload.array('files', 10), async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const { folder, publicRead, metadata } = req.body;
    const files = req.files as Express.Multer.File[];
    const user = req.user;
    
    const userFolder = `users/${user?._id}`;
    const finalFolder = folder ? `${userFolder}/${folder}` : userFolder;
    
    const uploadPromises = files.map((file) => {
      const key = s3Service.generateUniqueKey(file.originalname, finalFolder);
      const uploadOptions: UploadOptions = {
        contentType: file.mimetype,
        publicRead: publicRead === 'true',
        // Don't set folder here since it's already included in the key
        metadata: {
          ...(metadata ? JSON.parse(metadata) : {}),
          userId: user?._id,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      };
      
      return s3Service.uploadBuffer(key, file.buffer, uploadOptions);
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    logger.info(`${uploadedFiles.length} files uploaded by user ${user?._id}`);

    res.json({
      success: true,
      files: uploadedFiles,
      message: `${uploadedFiles.length} files uploaded successfully`,
    });
  } catch (error: any) {
    logger.error('Multiple file upload error:', error);
    res.status(500).json({
      error: 'Failed to upload files',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/download/:key
 * @desc Download a file from S3
 * @access Private
 */
router.get('/download/:key(*)', mediaHeadersMiddleware, async (req: AuthenticatedRequest, res: express.Response) => {
  const key = req.params.key;
  const user = req.user;
  
  if (!key) {
    return sendFileError(res, FileErrors.NO_KEY);
  }

  await handleFileDownload({
    key,
    userId: user?._id as string,
    s3Service,
    res,
    attachment: true,
  });
});

/**
 * @route GET /api/files/download?key=...
 * @desc Download a file from S3 using query param to avoid path encoding issues
 * @access Private
 */
router.get('/download', mediaHeadersMiddleware, async (req: AuthenticatedRequest, res: express.Response) => {
  const key = extractFileKey(req.params, req.query);
  const user = req.user;

  if (!key) {
    return sendFileError(res, FileErrors.NO_KEY);
  }

  await handleFileDownload({
    key,
    userId: user?._id as string,
    s3Service,
    res,
    attachment: true,
  });
});

/**
 * @route DELETE /api/files/:key
 * @desc Delete a file from S3
 * @access Private
 */
router.delete('/:key(*)', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { key } = req.params;
    const user = req.user;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Verify user has access to this file
    if (!key.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    const exists = await s3Service.fileExists(key);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete file
    await s3Service.deleteFile(key);

    logger.info(`File deleted: ${key} by user ${user?._id}`);

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error: any) {
    logger.error('File deletion error:', error);
    res.status(500).json({
      error: 'Failed to delete file',
      message: error.message,
    });
  }
});

/**
 * @route DELETE /api/files/batch
 * @desc Delete multiple files from S3
 * @access Private
 */
router.delete('/batch', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { keys } = req.body;
    const user = req.user;
    
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'File keys array is required' });
    }

    // Verify user has access to all files
    const unauthorizedKeys = keys.filter((key: string) => !key.startsWith(`users/${user?._id}/`));
    if (unauthorizedKeys.length > 0) {
      return res.status(403).json({ error: 'Access denied to some files' });
    }

    // Delete files
    await s3Service.deleteMultipleFiles(keys);

    logger.info(`${keys.length} files deleted by user ${user?._id}`);

    res.json({
      success: true,
      message: `${keys.length} files deleted successfully`,
    });
  } catch (error: any) {
    logger.error('Batch file deletion error:', error);
    res.status(500).json({
      error: 'Failed to delete files',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/presigned-upload
 * @desc Generate presigned URL for file upload
 * @access Private
 */
router.get('/presigned-upload', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { key, contentType, expiresIn, metadata } = req.query;
    const user = req.user;
    
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Ensure key is in user's folder
    const userKey = key.startsWith(`users/${user?._id}/`) ? key : `users/${user?._id}/${key}`;

    const url = await s3Service.getPresignedUploadUrl(userKey, {
      expiresIn: expiresIn ? parseInt(expiresIn as string) : 3600,
      contentType: contentType as string || 'application/octet-stream',
      metadata: {
        ...(metadata ? JSON.parse(metadata as string) : {}),
        userId: user?._id,
        generatedAt: new Date().toISOString(),
      },
    });

    res.json({
      success: true,
      url,
      key: userKey,
      expiresIn: expiresIn ? parseInt(expiresIn as string) : 3600,
    });
  } catch (error: any) {
    logger.error('Presigned upload URL error:', error);
    res.status(500).json({
      error: 'Failed to generate presigned upload URL',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/presigned-download/:key
 * @desc Generate presigned URL for file download
 * @access Private
 */
router.get('/presigned-download/:key(*)', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { key } = req.params;
    const { expiresIn } = req.query;
    const user = req.user;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Verify user has access to this file
    if (!key.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    const exists = await s3Service.fileExists(key);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    const url = await s3Service.getPresignedDownloadUrl(
      key,
      expiresIn ? parseInt(expiresIn as string) : 3600
    );

    res.json({
      success: true,
      url,
      key,
      expiresIn: expiresIn ? parseInt(expiresIn as string) : 3600,
    });
  } catch (error: any) {
    logger.error('Presigned download URL error:', error);
    res.status(500).json({
      error: 'Failed to generate presigned download URL',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/redirect-download/:key
 * @desc Validate and redirect to a presigned URL for file download (anchor-friendly)
 * @access Private
 */
router.get('/redirect-download/:key(*)', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { key } = req.params;
    const { expiresIn } = req.query;
    const user = req.user;

    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    if (!key.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const exists = await s3Service.fileExists(key);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    const url = await s3Service.getPresignedDownloadUrl(
      key,
      expiresIn ? parseInt(expiresIn as string) : 3600
    );

    // 302 redirect to S3/Spaces
    return res.redirect(url);
  } catch (error: any) {
    logger.error('Redirect download error:', error);
    return res.status(500).json({
      error: 'Failed to redirect to download URL',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/redirect-download?key=...
 * @desc Query-param variant to avoid path encoding issues
 * @access Private
 */
router.get('/redirect-download', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : undefined;
    const { expiresIn } = req.query;
    const user = req.user;

    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    if (!key.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const exists = await s3Service.fileExists(key);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    const url = await s3Service.getPresignedDownloadUrl(
      key,
      expiresIn ? parseInt(expiresIn as string) : 3600
    );

    return res.redirect(url);
  } catch (error: any) {
    logger.error('Redirect download (query) error:', error);
    return res.status(500).json({
      error: 'Failed to redirect to download URL',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/list
 * @desc List files in S3 bucket for the authenticated user
 * @access Private
 */
router.get('/list', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
  const { prefix, maxKeys, limit, offset } = req.query as Record<string, any>;
  const user = req.user;
    
    // Back-compat shim: if prefix is undefined/null/empty, delegate to CAS listing
    if (!prefix || prefix === 'undefined' || prefix === 'null') {
      try {
        const userId = (user?._id as any)?.toString?.() || (user as any)?.id;
        const lim = limit ? parseInt(String(limit)) : 50;
        const off = offset ? parseInt(String(offset)) : 0;
        const { files, total } = await assetService.listFilesByUser(userId, lim, off);

        const convertedFiles = files.map((f: any) => ({
          id: f._id?.toString?.() || f.id,
          filename: f.originalName || f.sha256,
          contentType: f.mime || 'application/octet-stream',
          length: f.size || 0,
          chunkSize: 0,
          uploadDate: (f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt) || new Date().toISOString(),
          metadata: f.metadata || {},
        }));

        return res.json({ success: true, files: convertedFiles, count: total });
      } catch (e: any) {
        logger.error('Back-compat list (CAS, query) error:', e);
        return res.status(500).json({ error: 'Failed to list files', message: e.message });
      }
    }

    // Ensure prefix is within user's folder
    const userId = (user?._id as any)?.toString?.() || (user as any)?.id;
    const userPrefix = `users/${userId}/`;
    // Normalize provided prefix: remove leading '/', ensure trailing '/'
  let normalized = typeof prefix === 'string' ? prefix : '';
    if (normalized.startsWith('/')) normalized = normalized.slice(1);
    if (normalized && !normalized.endsWith('/')) normalized = `${normalized}/`;

    // If client passed userId or already passed absolute users/<id>/..., avoid double-prefix
  let finalPrefix = userPrefix;
    if (normalized) {
      if (normalized === `${userId}/`) {
        finalPrefix = userPrefix;
      } else if (normalized.startsWith(`users/${userId}/`)) {
        finalPrefix = normalized; // already absolute
      } else {
        finalPrefix = `${userPrefix}${normalized}`;
      }
    }
  logger.debug('List files computed prefix', { userId, requestedPrefix: prefix, normalized, finalPrefix });
    
    const files = await s3Service.listFiles(
      finalPrefix,
      maxKeys ? parseInt(maxKeys as string) : 1000
    );

    // Convert S3 FileInfo format to FileMetadata format
    const convertedFiles = await Promise.all(files.map(async (file) => {
      try {
        const metadata = await s3Service.getFileMetadata(file.key);
        return {
          id: file.key,
          filename: metadata?.metadata?.originalName || file.key.split('/').pop() || file.key,
          contentType: metadata?.contentType || 'application/octet-stream',
          length: file.size,
          chunkSize: 261120,
          uploadDate: file.lastModified.toISOString(),
          metadata: metadata?.metadata || {},
        };
      } catch (e) {
        // Fallback if metadata fetch fails
        return {
          id: file.key,
          filename: file.key.split('/').pop() || file.key,
          contentType: 'application/octet-stream',
          length: file.size,
          chunkSize: 261120,
          uploadDate: file.lastModified.toISOString(),
          metadata: {},
        };
      }
    }));

    res.json({
      success: true,
      files: convertedFiles,
      count: convertedFiles.length,
    });
  } catch (error: any) {
    logger.error('File listing error:', error);
    res.status(500).json({
      error: 'Failed to list files',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/list/:prefix
 * @desc List files in S3 bucket for the authenticated user (path-param variant)
 * @access Private
 */
router.get('/list/:prefix(*)', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { maxKeys, limit, offset } = req.query as Record<string, string | undefined>;
    const user = req.user;
    let rawPrefix = req.params.prefix || '';

    // Back-compat shim: some older clients call /api/files/list/undefined (passing undefined userId)
    // In that case, delegate to CAS and return user's assets instead of S3 prefix listing
    if (!rawPrefix || rawPrefix === 'undefined' || rawPrefix === 'null') {
      try {
        const userId = (user?._id as any)?.toString?.() || (user as any)?.id;
        const lim = limit ? parseInt(limit) : 50;
        const off = offset ? parseInt(offset) : 0;
        const { files, total } = await assetService.listFilesByUser(userId, lim, off);

        // Map CAS File documents to legacy FileMetadata shape
        const convertedFiles = files.map((f: any) => ({
          id: f._id?.toString?.() || f.id,
          filename: f.originalName || f.sha256,
          contentType: f.mime || 'application/octet-stream',
          length: f.size || 0,
          chunkSize: 0,
          uploadDate: (f.createdAt instanceof Date ? f.createdAt.toISOString() : f.createdAt) || new Date().toISOString(),
          metadata: f.metadata || {},
        }));

        return res.json({ success: true, files: convertedFiles, count: total });
      } catch (e: any) {
        logger.error('Back-compat list (CAS) error:', e);
        return res.status(500).json({ error: 'Failed to list files', message: e.message });
      }
    }

    // Disallow path traversal
    if (rawPrefix.includes('..')) {
      return res.status(400).json({ error: 'Invalid prefix' });
    }

  const userId = (user?._id as any)?.toString?.() || (user as any)?.id;
  const userPrefix = `users/${userId}/`;
    // Normalize prefix: strip leading '/', ensure trailing '/'
    if (rawPrefix.startsWith('/')) rawPrefix = rawPrefix.slice(1);
    if (rawPrefix && !rawPrefix.endsWith('/')) rawPrefix = `${rawPrefix}/`;

    // If client passed userId or already passed absolute users/<id>/..., avoid double-prefix
  let finalPrefix = userPrefix;
    if (rawPrefix) {
      if (rawPrefix === `${userId}/`) {
        finalPrefix = userPrefix;
      } else if (rawPrefix.startsWith(`users/${userId}/`)) {
        finalPrefix = rawPrefix; // already absolute
      } else {
        finalPrefix = `${userPrefix}${rawPrefix}`;
      }
    }
  logger.debug('List (path) computed prefix', { userId, requestedPrefix: req.params.prefix, rawPrefix, finalPrefix });

  const files = await s3Service.listFiles(
      finalPrefix,
      maxKeys ? parseInt(maxKeys as string) : 1000
    );

    // Convert S3 FileInfo format to FileMetadata format
    const convertedFiles = await Promise.all(files.map(async (file) => {
      try {
        const metadata = await s3Service.getFileMetadata(file.key);
        return {
          id: file.key,
          filename: metadata?.metadata?.originalName || file.key.split('/').pop() || file.key,
          contentType: metadata?.contentType || 'application/octet-stream',
          length: file.size,
          chunkSize: 261120,
          uploadDate: file.lastModified.toISOString(),
          metadata: metadata?.metadata || {},
        };
      } catch (e) {
        return {
          id: file.key,
          filename: file.key.split('/').pop() || file.key,
          contentType: 'application/octet-stream',
          length: file.size,
          chunkSize: 261120,
          uploadDate: file.lastModified.toISOString(),
          metadata: {},
        };
      }
    }));

    res.json({
      success: true,
      files: convertedFiles,
      count: convertedFiles.length,
    });
  } catch (error: any) {
    logger.error('File listing (path) error:', error);
    res.status(500).json({
      error: 'Failed to list files',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/metadata/:key
 * @desc Get file metadata
 * @access Private
 */
router.get('/metadata/:key(*)', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { key } = req.params;
    const user = req.user;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Verify user has access to this file
    if (!key.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const metadata = await s3Service.getFileMetadata(key);
    if (!metadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      success: true,
      metadata,
    });
  } catch (error: any) {
    logger.error('File metadata error:', error);
    res.status(500).json({
      error: 'Failed to get file metadata',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/files/copy
 * @desc Copy a file in S3
 * @access Private
 */
router.post('/copy', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { sourceKey, destinationKey } = req.body;
    const user = req.user;
    
    if (!sourceKey || !destinationKey) {
      return res.status(400).json({ error: 'Source and destination keys are required' });
    }

    // Verify user has access to source file
    if (!sourceKey.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied to source file' });
    }

    // Ensure destination is in user's folder
    const userDestinationKey = destinationKey.startsWith(`users/${user?._id}/`) 
      ? destinationKey 
      : `users/${user?._id}/${destinationKey}`;

    // Check if source file exists
    const exists = await s3Service.fileExists(sourceKey);
    if (!exists) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    await s3Service.copyFile(sourceKey, userDestinationKey);

    logger.info(`File copied: ${sourceKey} to ${userDestinationKey} by user ${user?._id}`);

    res.json({
      success: true,
      message: 'File copied successfully',
      sourceKey,
      destinationKey: userDestinationKey,
    });
  } catch (error: any) {
    logger.error('File copy error:', error);
    res.status(500).json({
      error: 'Failed to copy file',
      message: error.message,
    });
  }
});

/**
 * @route POST /api/files/move
 * @desc Move a file in S3
 * @access Private
 */
router.post('/move', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { sourceKey, destinationKey } = req.body;
    const user = req.user;
    
    if (!sourceKey || !destinationKey) {
      return res.status(400).json({ error: 'Source and destination keys are required' });
    }

    // Verify user has access to source file
    if (!sourceKey.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied to source file' });
    }

    // Ensure destination is in user's folder
    const userDestinationKey = destinationKey.startsWith(`users/${user?._id}/`) 
      ? destinationKey 
      : `users/${user?._id}/${destinationKey}`;

    // Check if source file exists
    const exists = await s3Service.fileExists(sourceKey);
    if (!exists) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    await s3Service.moveFile(sourceKey, userDestinationKey);

    logger.info(`File moved: ${sourceKey} to ${userDestinationKey} by user ${user?._id}`);

    res.json({
      success: true,
      message: 'File moved successfully',
      sourceKey,
      destinationKey: userDestinationKey,
    });
  } catch (error: any) {
    logger.error('File move error:', error);
    res.status(500).json({
      error: 'Failed to move file',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/public-url/:key
 * @desc Get public URL for a file
 * @access Private
 */
router.get('/public-url/:key(*)', async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { key } = req.params;
    const user = req.user;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Verify user has access to this file
    if (!key.startsWith(`users/${user?._id}/`)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const url = s3Service.getPublicUrl(key);

    res.json({
      success: true,
      url,
      key,
    });
  } catch (error: any) {
    logger.error('Public URL error:', error);
    res.status(500).json({
      error: 'Failed to get public URL',
      message: error.message,
    });
  }
});

export default router;
