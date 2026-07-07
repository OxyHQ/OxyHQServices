#!/usr/bin/env bun
/**
 * One-shot: run variant generation (ffprobe/sharp) on File records missing
 * canonical media metadata — especially federation-media-cache uploads that
 * never queued variant generation before the fix.
 *
 * Run:
 *   bun run packages/api/src/scripts/backfillFileMediaMetadata.ts
 *
 * Env: MONGODB_URI required.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { File } from '../models/File.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { VariantService } from '../services/variantService.js';
import { createS3Service } from '../services/s3Service.js';
import { resolveFileMediaMetadata } from '../utils/fileMediaMetadata.js';

dotenv.config();

const BATCH_SIZE = 100;

function getS3Service() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucketName = process.env.AWS_S3_BUCKET;
  if (!accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_S3_BUCKET are required');
  }
  return createS3Service({
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpointUrl: process.env.AWS_ENDPOINT_URL,
  });
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri, { dbName: getDbName() });
  const variantService = new VariantService(getS3Service());

  let scanned = 0;
  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  let lastId: mongoose.Types.ObjectId | null = null;

  for (;;) {
    const query: Record<string, unknown> = {
      status: 'active',
      mime: { $regex: /^(image|video)\// },
      $or: [
        { 'metadata.media.width': { $exists: false } },
        { 'metadata.media.height': { $exists: false } },
      ],
    };
    if (lastId) query._id = { $gt: lastId };

    const batch = await File.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).exec();
    if (batch.length === 0) break;

    for (const file of batch) {
      scanned += 1;
      lastId = new mongoose.Types.ObjectId(String(file._id));
      const before = resolveFileMediaMetadata(file);
      if (before.width && before.height) {
        skipped += 1;
        continue;
      }
      try {
        await variantService.generateVariants(file._id.toString());
        const fresh = await File.findById(file._id).lean();
        const after = fresh ? resolveFileMediaMetadata(fresh as typeof file) : {};
        if (after.width && after.height) {
          enriched += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        logger.warn('backfillFileMediaMetadata: variant generation failed', {
          fileId: file._id.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('backfillFileMediaMetadata progress', { scanned, enriched, skipped, failed });
  }

  logger.info('backfillFileMediaMetadata complete', { scanned, enriched, skipped, failed });
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  logger.error('backfillFileMediaMetadata fatal', {
    error: error instanceof Error ? error.message : String(error),
  });
  void mongoose.disconnect().finally(() => process.exit(1));
});
