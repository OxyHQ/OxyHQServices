import { Router, Request, Response, RequestHandler } from "express";
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth';
import { upload, writeFile, readFile, deleteFile, findFiles, fileExists } from '../utils/mongoose-gridfs';
import express from 'express';

interface GridFSFile {
  _id: mongoose.Types.ObjectId;
  length: number;
  chunkSize: number;
  uploadDate: Date;
  filename: string;
  contentType?: string;
  metadata?: any;
  aliases?: string[];
}

interface AuthenticatedRequest extends Request {
  user?: {
    _id: mongoose.Types.ObjectId;
    [key: string]: any;
  };
  files?: Express.Multer.File[];
}

const router = Router();

// Public routes first
router.get("/:id", streamFileHandler);
router.get("/meta/:id", getFileMetadataHandler);
router.get("/data/:ids", getFileDataHandler);

// Apply auth middleware to all protected routes
router.use(authMiddleware);

// Protected routes below
// Remove the old /files/upload route and all FormData/multer logic.
router.post('/upload-raw', express.raw({ type: '*/*', limit: '50mb' }), async (req: Request, res: Response) => {
  try {
    const fileName = decodeURIComponent(req.header('X-File-Name') || 'upload.bin');
    const userId = req.header('X-User-Id');
    const mimeType = req.header('Content-Type') || 'application/octet-stream';
    const user = (req as any).user;

    if (!userId) return res.status(400).json({ message: 'Missing userId' });
    if (!user?._id || user._id.toString() !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Save to GridFS or your storage
    const fileData = await writeFile(req.body, {
      filename: fileName,
      contentType: mimeType,
      metadata: {
        userID: userId,
        originalname: fileName,
        size: req.body.length,
        uploadDate: new Date()
      }
    }) as GridFSFile;

    res.json({
      _id: fileData._id,
      filename: fileData.metadata?.originalname || fileData.filename,
      size: req.body.length,
      mimetype: mimeType
    });
  } catch (err: any) {
    console.error('Raw upload error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

router.get("/list/:userID", (async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userID)) {
      return res.status(400).json({ message: "Invalid userID" });
    }

    if (!req.user?._id || req.user._id.toString() !== req.params.userID) {
      return res.status(403).json({ message: "Unauthorized to access these files" });
    }

    const files = await findFiles({ "metadata.userID": new mongoose.Types.ObjectId(req.params.userID) });
    res.json(files || []);
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ message: "Error retrieving files", error });
  }
}) as RequestHandler);

router.delete("/:id", (async (req: AuthenticatedRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid file ID" });
  }

  try {
    // Verify file ownership before deletion
    const files = await findFiles({ _id: new mongoose.Types.ObjectId(req.params.id) });
    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    const file = files[0];
    if (file.metadata?.userID.toString() !== req.user?._id.toString()) {
      return res.status(403).json({ message: "Unauthorized to delete this file" });
    }

    await deleteFile(req.params.id);
    res.json({ message: "File deleted successfully" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ message: `An error occurred while deleting the file: ${err.message}` });
  }
}) as RequestHandler);

// Cleanup broken file references
router.post("/cleanup/:userID", (async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userID)) {
      return res.status(400).json({ message: "Invalid userID" });
    }

    if (!req.user?._id || req.user._id.toString() !== req.params.userID) {
      return res.status(403).json({ message: "Unauthorized to cleanup files for this user" });
    }

    // Get all file metadata for the user
    const files = await findFiles({ "metadata.userID": new mongoose.Types.ObjectId(req.params.userID) });
    const brokenFiles = [];
    const validFiles = [];

    // Check each file's actual existence in GridFS
    for (const file of files) {
      try {
        const readStream = await readFile(file._id.toString());
        if (readStream) {
          validFiles.push(file);
          // Close the stream immediately since we're just checking existence
          readStream.destroy();
        } else {
          brokenFiles.push(file);
        }
      } catch (error: any) {
        brokenFiles.push(file);
      }
    }

    // For now, just return the count of broken files
    // In the future, you could implement actual cleanup logic here
    res.json({
      message: "File validation completed",
      total: files.length,
      valid: validFiles.length,
      broken: brokenFiles.length,
      brokenFileIds: brokenFiles.map(f => f._id.toString())
    });

  } catch (error) {
    console.error('Cleanup files error:', error);
    res.status(500).json({ message: "Error during file cleanup", error });
  }
}) as RequestHandler);

// Helper function to handle streaming files
async function streamFileHandler(req: Request, res: Response) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid file ID" });
  }

  try {
    console.log(`[Files] Public access request for file: ${req.params.id}`);
    const readStream = await readFile(req.params.id);
    if (!readStream) {
      console.warn(`[Files] File not found: ${req.params.id}`);
      return res.status(404).json({ message: "File not found" });
    }
    
    res.set({
      'Cache-Control': 'public, max-age=31536000',
      'Expires': new Date(Date.now() + 31536000000).toUTCString()
    });
    
    // Handle stream errors to prevent server crashes
    readStream.on('error', (streamErr: any) => {
      console.error(`[Files] Stream error for file ${req.params.id}:`, streamErr);
      if (!res.headersSent) {
        if (streamErr.code === 'ENOENT' || streamErr.message?.includes('FileNotFound')) {
          res.status(404).json({ message: "File not found" });
        } else {
          res.status(500).json({ message: "Error streaming file", error: streamErr.message });
        }
      }
    });
    
    readStream.pipe(res);
  } catch (err: any) {
    console.error(`[Files] Error reading file ${req.params.id}:`, err);
    if (!res.headersSent) {
      if (err.code === 'ENOENT' || err.message?.includes('FileNotFound')) {
        res.status(404).json({ message: "File not found" });
      } else {
        res.status(500).json({ message: "Error retrieving file", error: err.message });
      }
    }
  }
}

// Helper function to handle file metadata requests
async function getFileMetadataHandler(req: Request, res: Response) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid file ID" });
  }

  try {
    console.log(`[Files] Metadata request for file: ${req.params.id}`);
    const files = await findFiles({ _id: new mongoose.Types.ObjectId(req.params.id) });
    if (!files || files.length === 0) {
      console.warn(`[Files] File metadata not found: ${req.params.id}`);
      return res.status(404).json({ message: "File not found" });
    }

    const file = files[0];
    res.json({
      id: file._id,
      filename: file.metadata?.originalname || file.filename,
      contentType: file.contentType,
      size: file.length,
      uploadDate: file.uploadDate
    });
  } catch (err: any) {
    console.error(`[Files] Error getting file metadata ${req.params.id}:`, err);
    res.status(500).json({ 
      message: "Error retrieving file metadata",
      error: err.message 
    });
  }
}

// Helper function to handle file data requests
async function getFileDataHandler(req: Request, res: Response) {
  try {
    if (!req.params.ids) {
      return res.status(400).json({ message: "No file IDs provided" });
    }

    const rawIds = req.params.ids.split(",").filter(id => id.trim());
    if (rawIds.length === 0) {
      return res.status(400).json({ message: "No valid file IDs provided" });
    }

    const ids = [];
    const invalidIds = [];
    
    for (let id of rawIds) {
      if (mongoose.Types.ObjectId.isValid(id.trim())) {
        ids.push(new mongoose.Types.ObjectId(id.trim()));
      } else {
        invalidIds.push(id);
      }
    }

    if (invalidIds.length > 0) {
      return res.status(400).json({ 
        message: "Invalid file ID(s) provided", 
        invalidIds 
      });
    }

    const files = await findFiles({ _id: { $in: ids } });

    if (!files || files.length === 0) {
      return res.status(404).json({ message: "No files found" });
    }

    if (files.length !== ids.length) {
      const foundIds = files.map(file => file._id.toString());
      const missingIds = ids.map(id => id.toString()).filter(id => !foundIds.includes(id));
      return res.status(404).json({ 
        message: "Some files were not found",
        missingIds
      });
    }

    const fileData = files.map((file: GridFSFile) => ({
      id: file._id,
      filename: file.metadata?.originalname || file.filename,
      contentType: file.contentType || 'application/octet-stream',
      length: file.length,
      uploadDate: file.uploadDate,
      metadata: file.metadata || {},
    }));

    res.json(fileData);
  } catch (err: any) {
    console.error('Error in /files/data/:ids:', err);
    res.status(500).json({ 
      message: "Error retrieving files",
      error: err.message 
    });
  }
}

export default router;
