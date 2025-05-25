/**
 * Example server-side implementation for file management using MongoDB's GridFS
 * This is a simplified version to show how to implement the backend for the OxyServices file API
 */
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket, ObjectId } = require('mongodb');
const { Readable } = require('stream');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(cors());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/oxydb')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

let gfs;
let bucket;

mongoose.connection.once('open', () => {
  // Initialize GridFS bucket
  bucket = new GridFSBucket(mongoose.connection.db, {
    bucketName: 'files'
  });
  console.log('GridFS bucket initialized');
});

// Middleware for JWT authentication
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, 'your_jwt_secret'); // Replace with your actual secret
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Storage configuration for multer
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit
    files: 5 // Max 5 files per request
  }
});

// File upload endpoint
app.post('/files/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Parse metadata if provided
    let metadata = {};
    if (req.body.metadata) {
      try {
        metadata = JSON.parse(req.body.metadata);
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }
    }

    // Add user ID from authenticated user
    metadata.userId = req.user.userId;
    
    // Create upload stream to GridFS
    const readableStream = new Readable();
    readableStream.push(req.file.buffer);
    readableStream.push(null);

    // Upload file to GridFS
    let uploadStream = bucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
      metadata
    });

    // Process the upload
    readableStream.pipe(uploadStream);

    // Return response after upload completes
    uploadStream.on('finish', async (file) => {
      // Get the file with metadata
      const fileMetadata = await mongoose.connection.db
        .collection('files.files')
        .findOne({ _id: file._id });

      // Format response
      const response = {
        success: true,
        file: {
          id: file._id.toString(),
          filename: file.filename,
          contentType: file.contentType,
          length: file.length,
          chunkSize: file.chunkSize,
          uploadDate: file.uploadDate,
          metadata: file.metadata
        }
      };

      res.status(200).json(response);
    });

    uploadStream.on('error', (error) => {
      console.error('Error uploading file:', error);
      res.status(500).json({ success: false, message: 'Error uploading file' });
    });
  } catch (error) {
    console.error('Error in file upload:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get file metadata
app.get('/files/:fileId/metadata', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);
    const file = await mongoose.connection.db
      .collection('files.files')
      .findOne({ _id: fileId });
      
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.status(200).json({
      id: file._id.toString(),
      filename: file.filename,
      contentType: file.contentType,
      length: file.length,
      chunkSize: file.chunkSize,
      uploadDate: file.uploadDate,
      metadata: file.metadata
    });
  } catch (error) {
    console.error('Error getting file metadata:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update file metadata
app.put('/files/:fileId/metadata', authMiddleware, async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);
    const file = await mongoose.connection.db
      .collection('files.files')
      .findOne({ _id: fileId });
      
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // Verify ownership (only the file owner can update metadata)
    if (file.metadata?.userId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const updates = { $set: {} };

    // Update filename if provided
    if (req.body.filename) {
      updates.$set.filename = req.body.filename;
    }

    // Update metadata if provided
    if (req.body.metadata) {
      // Preserve userId in metadata
      const updatedMetadata = {
        ...req.body.metadata,
        userId: file.metadata.userId // Keep the original user ID
      };
      
      updates.$set.metadata = updatedMetadata;
    }

    // Update the file document
    await mongoose.connection.db
      .collection('files.files')
      .updateOne({ _id: fileId }, updates);

    // Get updated file
    const updatedFile = await mongoose.connection.db
      .collection('files.files')
      .findOne({ _id: fileId });

    res.status(200).json({
      id: updatedFile._id.toString(),
      filename: updatedFile.filename,
      contentType: updatedFile.contentType,
      length: updatedFile.length,
      chunkSize: updatedFile.chunkSize,
      uploadDate: updatedFile.uploadDate,
      metadata: updatedFile.metadata
    });
  } catch (error) {
    console.error('Error updating file metadata:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Download file
app.get('/files/:fileId/download', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);
    const file = await mongoose.connection.db
      .collection('files.files')
      .findOne({ _id: fileId });
      
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // Set response headers
    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);

    // Stream file from GridFS to response
    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.pipe(res);
    
    downloadStream.on('error', (error) => {
      console.error('Error downloading file:', error);
      res.status(500).json({ success: false, message: 'Error downloading file' });
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Stream file (for audio/video)
app.get('/files/:fileId/stream', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);
    const file = await mongoose.connection.db
      .collection('files.files')
      .findOne({ _id: fileId });
      
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // Set streaming headers
    res.set('Content-Type', file.contentType);
    res.set('Accept-Ranges', 'bytes');
    
    // Handle range requests for streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      const chunkSize = (end - start) + 1;
      
      res.status(206);
      res.set('Content-Length', chunkSize);
      res.set('Content-Range', `bytes ${start}-${end}/${file.length}`);
      
      const downloadStream = bucket.openDownloadStream(fileId, {
        start,
        end: end + 1
      });
      downloadStream.pipe(res);
    } else {
      // Stream the entire file
      res.set('Content-Length', file.length);
      const downloadStream = bucket.openDownloadStream(fileId);
      downloadStream.pipe(res);
    }
  } catch (error) {
    console.error('Error streaming file:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete file
app.delete('/files/:fileId', authMiddleware, async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.fileId);
    const file = await mongoose.connection.db
      .collection('files.files')
      .findOne({ _id: fileId });
      
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // Verify ownership (only the file owner can delete)
    if (file.metadata?.userId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Delete the file
    await bucket.delete(fileId);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      fileId: fileId.toString()
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// List user files with pagination and filtering
app.get('/files', authMiddleware, async (req, res) => {
  try {
    const userId = req.query.userId || req.user.userId;
    
    // Verify access rights (users can only view their own files unless authorized)
    if (userId !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    // Create query filter
    const filter = { 'metadata.userId': userId };
    
    // Add content type filter if provided
    if (req.query.contentType) {
      filter.contentType = { $regex: new RegExp(req.query.contentType) };
    }
    
    // Count total files matching filter
    const total = await mongoose.connection.db
      .collection('files.files')
      .countDocuments(filter);
    
    // Get files with pagination
    const files = await mongoose.connection.db
      .collection('files.files')
      .find(filter)
      .sort({ uploadDate: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    
    // Format response
    const formattedFiles = files.map(file => ({
      id: file._id.toString(),
      filename: file.filename,
      contentType: file.contentType,
      length: file.length,
      chunkSize: file.chunkSize,
      uploadDate: file.uploadDate,
      metadata: file.metadata
    }));
    
    res.status(200).json({
      files: formattedFiles,
      total,
      hasMore: offset + files.length < total
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});