import mongoose from 'mongoose';
import multer from 'multer';
import { Request } from 'express';
import { Readable } from 'stream';

let bucket: mongoose.mongo.GridFSBucket;

// Initialize GridFSBucket
const initGridFS = () => {
  if (!bucket && mongoose.connection.db) {
    bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads'
    });
  }
  return bucket;
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files per upload
  }
}).array('files', 5);

// Helper function to write file to GridFS
const writeFile = async (fileBuffer: Buffer, options: any) => {
  const bucket = initGridFS();
  if (!bucket) throw new Error('GridFS not initialized');

  // Use sanitized filename for storage while preserving original in metadata
  const safeFilename = `file-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const uploadStream = bucket.openUploadStream(safeFilename, {
    contentType: options.contentType || 'application/octet-stream',
    metadata: {
      ...options.metadata,
      originalFilename: options.filename, // Store the original user-provided filename
      sanitizedFilename: safeFilename,    // Store the safe internal filename
      uploadDate: new Date()
    }
  });

  return new Promise((resolve, reject) => {
    const readableStream = Readable.from(fileBuffer);
    readableStream
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => {
        resolve({
          _id: uploadStream.id,
          filename: safeFilename,
          contentType: options.contentType || 'application/octet-stream',
          metadata: {
            ...uploadStream.options.metadata,
            originalFilename: options.filename
          }
        });
      });
  });
};

// Helper function to read file from GridFS
const readFile = async (id: string) => {
  const bucket = initGridFS();
  if (!bucket) throw new Error('GridFS not initialized');
  
  try {
    // First check if the file exists before attempting to open download stream
    const files = await bucket.find({ _id: new mongoose.Types.ObjectId(id) }).toArray();
    if (files.length === 0) {
      return null; // File not found
    }
    
    return bucket.openDownloadStream(new mongoose.Types.ObjectId(id));
  } catch (error: any) {
    // Handle GridFS errors
    if (error.code === 'ENOENT' || error.message?.includes('FileNotFound')) {
      return null; // File not found
    }
    throw error; // Re-throw other errors
  }
};

// Helper function to delete file from GridFS
const deleteFile = async (id: string) => {
  const bucket = initGridFS();
  if (!bucket) throw new Error('GridFS not initialized');

  try {
    // Check if file exists before attempting deletion
    const exists = await fileExists(id);
    if (!exists) {
      throw new Error(`File with id ${id} not found`);
    }

    return await bucket.delete(new mongoose.Types.ObjectId(id));
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.message?.includes('FileNotFound')) {
      throw new Error(`File with id ${id} not found`);
    }
    throw error;
  }
};

// Helper function to find files
const findFiles = async (query: any) => {
  const bucket = initGridFS();
  if (!bucket) throw new Error('GridFS not initialized');

  try {
    return await bucket.find(query).toArray();
  } catch (error: any) {
    console.error('Error finding files in GridFS:', error);
    // Return empty array instead of throwing to prevent crashes
    return [];
  }
};

// Helper function to check if file exists
const fileExists = async (id: string): Promise<boolean> => {
  const bucket = initGridFS();
  if (!bucket) throw new Error('GridFS not initialized');

  try {
    const files = await bucket.find({ _id: new mongoose.Types.ObjectId(id) }).limit(1).toArray();
    return files.length > 0;
  } catch (error: any) {
    console.error('Error checking file existence:', error);
    return false;
  }
};

export {
  initGridFS,
  upload,
  writeFile,
  readFile,
  deleteFile,
  findFiles,
  fileExists
};