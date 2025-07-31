import express from 'express';
import multer from 'multer';
import { S3Service, createS3Service, UploadOptions } from '../services/s3Service';
import path from 'path';

const router = express.Router();

// Initialize S3 service
const s3Service = createS3Service({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  bucketName: process.env.AWS_S3_BUCKET || '',
});

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

/**
 * @route POST /api/files/upload
 * @desc Upload a file to S3
 * @access Private
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { folder, publicRead, metadata } = req.body;
    const file = req.file;
    
    // Generate unique key
    const key = s3Service.generateUniqueKey(file.originalname, folder);
    
    // Upload options
    const uploadOptions: UploadOptions = {
      contentType: file.mimetype,
      publicRead: publicRead === 'true',
      folder,
      metadata: metadata ? JSON.parse(metadata) : undefined,
    };

    // Upload to S3
    const fileInfo = await s3Service.uploadBuffer(key, file.buffer, uploadOptions);

    res.json({
      success: true,
      file: fileInfo,
      message: 'File uploaded successfully',
    });
  } catch (error: any) {
    console.error('File upload error:', error);
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
router.post('/upload-multiple', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const { folder, publicRead, metadata } = req.body;
    const files = req.files as Express.Multer.File[];
    
    const uploadPromises = files.map((file) => {
      const key = s3Service.generateUniqueKey(file.originalname, folder);
      const uploadOptions: UploadOptions = {
        contentType: file.mimetype,
        publicRead: publicRead === 'true',
        folder,
        metadata: metadata ? JSON.parse(metadata) : undefined,
      };
      
      return s3Service.uploadBuffer(key, file.buffer, uploadOptions);
    });

    const uploadedFiles = await Promise.all(uploadPromises);

    res.json({
      success: true,
      files: uploadedFiles,
      message: `${uploadedFiles.length} files uploaded successfully`,
    });
  } catch (error: any) {
    console.error('Multiple file upload error:', error);
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
router.get('/download/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Get file metadata first
    const metadata = await s3Service.getFileMetadata(key);
    if (!metadata) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Download file as buffer
    const buffer = await s3Service.downloadBuffer(key);

    // Set response headers
    res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(key)}"`);

    res.send(buffer);
  } catch (error: any) {
    console.error('File download error:', error);
    res.status(500).json({
      error: 'Failed to download file',
      message: error.message,
    });
  }
});

/**
 * @route DELETE /api/files/:key
 * @desc Delete a file from S3
 * @access Private
 */
router.delete('/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    // Check if file exists
    const exists = await s3Service.fileExists(key);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete file
    await s3Service.deleteFile(key);

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error: any) {
    console.error('File deletion error:', error);
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
router.delete('/batch', async (req, res) => {
  try {
    const { keys } = req.body;
    
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'File keys array is required' });
    }

    // Delete files
    await s3Service.deleteMultipleFiles(keys);

    res.json({
      success: true,
      message: `${keys.length} files deleted successfully`,
    });
  } catch (error: any) {
    console.error('Batch file deletion error:', error);
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
router.get('/presigned-upload', async (req, res) => {
  try {
    const { key, contentType, expiresIn, metadata } = req.query;
    
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'File key is required' });
    }

    const url = await s3Service.getPresignedUploadUrl(key, {
      expiresIn: expiresIn ? parseInt(expiresIn as string) : 3600,
      contentType: contentType as string || 'application/octet-stream',
      metadata: metadata ? JSON.parse(metadata as string) : undefined,
    });

    res.json({
      success: true,
      url,
      key,
      expiresIn: expiresIn ? parseInt(expiresIn as string) : 3600,
    });
  } catch (error: any) {
    console.error('Presigned upload URL error:', error);
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
router.get('/presigned-download/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    const { expiresIn } = req.query;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
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
    console.error('Presigned download URL error:', error);
    res.status(500).json({
      error: 'Failed to generate presigned download URL',
      message: error.message,
    });
  }
});

/**
 * @route GET /api/files/list
 * @desc List files in S3 bucket
 * @access Private
 */
router.get('/list', async (req, res) => {
  try {
    const { prefix, maxKeys } = req.query;
    
    const files = await s3Service.listFiles(
      prefix as string || '',
      maxKeys ? parseInt(maxKeys as string) : 1000
    );

    res.json({
      success: true,
      files,
      count: files.length,
    });
  } catch (error: any) {
    console.error('File listing error:', error);
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
router.get('/metadata/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
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
    console.error('File metadata error:', error);
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
router.post('/copy', async (req, res) => {
  try {
    const { sourceKey, destinationKey } = req.body;
    
    if (!sourceKey || !destinationKey) {
      return res.status(400).json({ error: 'Source and destination keys are required' });
    }

    // Check if source file exists
    const exists = await s3Service.fileExists(sourceKey);
    if (!exists) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    await s3Service.copyFile(sourceKey, destinationKey);

    res.json({
      success: true,
      message: 'File copied successfully',
      sourceKey,
      destinationKey,
    });
  } catch (error: any) {
    console.error('File copy error:', error);
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
router.post('/move', async (req, res) => {
  try {
    const { sourceKey, destinationKey } = req.body;
    
    if (!sourceKey || !destinationKey) {
      return res.status(400).json({ error: 'Source and destination keys are required' });
    }

    // Check if source file exists
    const exists = await s3Service.fileExists(sourceKey);
    if (!exists) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    await s3Service.moveFile(sourceKey, destinationKey);

    res.json({
      success: true,
      message: 'File moved successfully',
      sourceKey,
      destinationKey,
    });
  } catch (error: any) {
    console.error('File move error:', error);
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
router.get('/public-url/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!key) {
      return res.status(400).json({ error: 'File key is required' });
    }

    const url = s3Service.getPublicUrl(key);

    res.json({
      success: true,
      url,
      key,
    });
  } catch (error: any) {
    console.error('Public URL error:', error);
    res.status(500).json({
      error: 'Failed to get public URL',
      message: error.message,
    });
  }
});

export default router; 