/**
 * Shared AssetService singleton.
 *
 * AssetService wraps S3Service + the File model and is the canonical surface
 * for any code that needs to reference user-owned files (email attachments,
 * profile media, Mention posts, etc.). Constructing a new instance per
 * request would cause repeated S3 client setup and defeat the in-memory
 * fileCache used by AssetService.getFile. Instead, every consumer imports
 * this shared instance.
 */

import { AssetService } from './assetService';
import { createS3Service } from './s3Service';

export const s3Service = createS3Service({
  region: process.env.AWS_REGION || 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  bucketName: process.env.AWS_S3_BUCKET || '',
  endpointUrl: process.env.AWS_ENDPOINT_URL,
});

export const assetService = new AssetService(s3Service);
