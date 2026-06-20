#!/usr/bin/env bun
/**
 * Idempotent one-shot: copy existing `visibility:'public'` asset objects
 * (originals + variants) from their non-public S3 keys to the CDN-reachable
 * `public/` prefix, so they resolve via the public CDN (`cloud.oxy.so`,
 * CloudFront `origin_path = /public`).
 *
 * Why this is needed
 * ------------------
 * The read path (`AssetService.getPublicCdnUrl`) serves a public asset via the
 * CDN only when its bytes physically live under the `public/` prefix. New public
 * uploads are written there directly (and relocated on visibility change), but
 * objects created before the CDN cutover still sit at `content/..` / `variants/..`.
 * Until they are copied under `public/`, the read path safely falls back to
 * streaming them through our own origin — correct, but it bypasses the CDN. This
 * script performs that one-time S3 copy so old public media is served by the CDN.
 *
 * Scope / safety
 * --------------
 *  - ONLY `status:'active'`, `visibility:'public'` files are touched.
 *  - S3-only: copies objects via `CopyObject`. It does NOT mutate the DB
 *    (no migration) — the read path already maps a non-public stored key to its
 *    `public/` counterpart, so the copy alone makes the asset CDN-served.
 *  - Idempotent: an object already under `public/`, or already copied, is
 *    skipped (HEAD check before copy). Safe to re-run.
 *  - Private/unlisted assets are never copied to `public/`.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/src/scripts/backfillPublicAssetsToCdn.ts
 * Or, against the compiled output:
 *   node packages/api/dist/scripts/backfillPublicAssetsToCdn.js
 *
 * Env:
 *   MONGODB_URI            required (injected by ECS from SSM)
 *   NODE_ENV               selects the DB name via getDbName()
 *   AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET
 *                          required for the S3 client
 *   AWS_ENDPOINT_URL       optional (S3-compatible endpoints)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { File } from '../models/File.js';
import { createS3Service } from '../services/s3Service.js';
import { applyPublicPrefix, isPublicKey } from '../config/cdn.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const COMPONENT = 'backfill-public-assets-to-cdn';
/** Process files in batches to bound memory on large collections. */
const BATCH_SIZE = 500;

interface BackfillStats {
  filesScanned: number;
  objectsCopied: number;
  objectsAlreadyPublic: number;
  objectsAlreadyCopied: number;
  objectsMissingSource: number;
  errors: number;
}

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

/**
 * Copy a single object to its `public/`-prefixed key when it is not already
 * public and not already copied. Returns the outcome so the caller can tally.
 */
async function backfillObject(
  s3Service: ReturnType<typeof createS3Service>,
  sourceKey: string
): Promise<'already-public' | 'already-copied' | 'copied' | 'missing-source'> {
  if (isPublicKey(sourceKey)) {
    return 'already-public';
  }

  const targetKey = applyPublicPrefix(sourceKey);

  if (await s3Service.fileExists(targetKey)) {
    return 'already-copied';
  }

  if (!(await s3Service.fileExists(sourceKey))) {
    return 'missing-source';
  }

  await s3Service.copyFile(sourceKey, targetKey);
  return 'copied';
}

async function run(s3Service: ReturnType<typeof createS3Service>): Promise<BackfillStats> {
  const stats: BackfillStats = {
    filesScanned: 0,
    objectsCopied: 0,
    objectsAlreadyPublic: 0,
    objectsAlreadyCopied: 0,
    objectsMissingSource: 0,
    errors: 0,
  };

  const cursor = File.find({ visibility: 'public', status: 'active' })
    .select('_id storageKey variants visibility')
    .batchSize(BATCH_SIZE)
    .cursor();

  for await (const file of cursor) {
    stats.filesScanned += 1;

    const keys: string[] = [file.storageKey, ...file.variants.map((variant) => variant.key)]
      .filter((key): key is string => typeof key === 'string' && key.length > 0);

    for (const key of keys) {
      try {
        const outcome = await backfillObject(s3Service, key);
        switch (outcome) {
          case 'copied':
            stats.objectsCopied += 1;
            logger.info('Copied public asset object under CDN prefix', {
              component: COMPONENT,
              fileId: file._id.toString(),
              sourceKey: key,
              targetKey: applyPublicPrefix(key),
            });
            break;
          case 'already-public':
            stats.objectsAlreadyPublic += 1;
            break;
          case 'already-copied':
            stats.objectsAlreadyCopied += 1;
            break;
          case 'missing-source':
            stats.objectsMissingSource += 1;
            logger.warn('Public asset object has no source bytes to copy', {
              component: COMPONENT,
              fileId: file._id.toString(),
              sourceKey: key,
            });
            break;
        }
      } catch (error) {
        stats.errors += 1;
        logger.error(
          'Failed to backfill public asset object',
          error instanceof Error ? error : new Error(String(error)),
          { component: COMPONENT, fileId: file._id.toString(), sourceKey: key }
        );
      }
    }

    if (stats.filesScanned % BATCH_SIZE === 0) {
      logger.info('Backfill progress', { component: COMPONENT, ...stats });
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }

  const s3Service = getS3Service();

  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  logger.info('Connected to MongoDB', { component: COMPONENT, dbName });

  try {
    const stats = await run(s3Service);
    logger.info('Backfill complete', { component: COMPONENT, ...stats });
    if (stats.errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed', { component: COMPONENT });
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    logger.error(
      'backfillPublicAssetsToCdn failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: COMPONENT, method: 'main' }
    );
    process.exit(1);
  });
