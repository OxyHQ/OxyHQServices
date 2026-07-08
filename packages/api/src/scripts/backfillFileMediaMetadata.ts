#!/usr/bin/env bun
/**
 * One-shot: backfill canonical media metadata on File records missing
 * `metadata.media` — especially federation-media-cache uploads that never
 * queued variant generation before the fix.
 *
 * Fast path: when dimensions can already be resolved (type-specific subdocs or
 * existing variants) we persist `metadata.media` WITHOUT regenerating variants
 * (see VariantService.enrichCanonicalMetadataOnly). Only files that still can't
 * resolve dimensions fall back to full variant generation (ffprobe/sharp).
 *
 * Sharding (for parallel one-shot runs): the work set is partitioned by the
 * last hex char of `_id` mod SHARD_COUNT === SHARD_INDEX. Launch N processes,
 * each with a distinct SHARD_INDEX in [0, SHARD_COUNT).
 *
 * Run:
 *   bun run packages/api/src/scripts/backfillFileMediaMetadata.ts
 *   SHARD_INDEX=0 SHARD_COUNT=8 bun run packages/api/src/scripts/backfillFileMediaMetadata.ts
 *   bun run packages/api/src/scripts/backfillFileMediaMetadata.ts --shard-index 0 --shard-count 8
 *
 * Env: MONGODB_URI required. SHARD_INDEX (default 0), SHARD_COUNT (default 1).
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

function parseIntArg(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function resolveShardConfig(): { shardIndex: number; shardCount: number } {
  let shardIndex = parseIntArg(process.env.SHARD_INDEX, 0);
  let shardCount = parseIntArg(process.env.SHARD_COUNT, 1);

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--shard-index') shardIndex = parseIntArg(argv[i + 1], shardIndex);
    if (argv[i] === '--shard-count') shardCount = parseIntArg(argv[i + 1], shardCount);
  }

  if (shardCount < 1) shardCount = 1;
  if (shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`Invalid shard config: SHARD_INDEX=${shardIndex} must be in [0, ${shardCount})`);
  }
  return { shardIndex, shardCount };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  const { shardIndex, shardCount } = resolveShardConfig();

  await mongoose.connect(uri, { dbName: getDbName() });
  const variantService = new VariantService(getS3Service());

  logger.info('backfillFileMediaMetadata starting', { shardIndex, shardCount });

  let scanned = 0;
  let enriched = 0;
  let persistedFast = 0;
  let skipped = 0;
  let failed = 0;
  let lastId: mongoose.Types.ObjectId | null = null;

  for (;;) {
    const and: Record<string, unknown>[] = [
      {
        $or: [
          { 'metadata.media.width': { $exists: false } },
          { 'metadata.media.height': { $exists: false } },
        ],
      },
    ];
    // Shard by last hex char of the _id string mod SHARD_COUNT. `$toInt` does
    // not parse hex, so map the char to 0-15 via its index in the hex alphabet.
    if (shardCount > 1) {
      and.push({
        $expr: {
          $eq: [
            {
              $mod: [
                {
                  $indexOfCP: [
                    '0123456789abcdef',
                    { $substrCP: [{ $toString: '$_id' }, 23, 1] },
                  ],
                },
                shardCount,
              ],
            },
            shardIndex,
          ],
        },
      });
    }

    const query: Record<string, unknown> = {
      status: 'active',
      mime: { $regex: /^(image|video)\// },
      $and: and,
    };
    if (lastId) query._id = { $gt: lastId };

    const batch = await File.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).exec();
    if (batch.length === 0) break;

    for (const file of batch) {
      scanned += 1;
      lastId = new mongoose.Types.ObjectId(String(file._id));
      const fileId = file._id.toString();
      try {
        const outcome = await variantService.enrichCanonicalMetadataOnly(fileId);
        if (outcome === 'persisted') {
          persistedFast += 1;
          continue;
        }
        if (outcome === 'skipped') {
          skipped += 1;
          continue;
        }

        // needs_variants: fall back to full ffprobe/sharp variant generation.
        await variantService.generateVariants(fileId);
        const fresh = await File.findById(fileId).lean();
        const after = fresh ? resolveFileMediaMetadata(fresh as typeof file) : {};
        if (after.width && after.height) {
          enriched += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        logger.warn('backfillFileMediaMetadata: enrichment failed', {
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('backfillFileMediaMetadata progress', {
      shardIndex,
      scanned,
      persistedFast,
      enriched,
      skipped,
      failed,
    });
  }

  logger.info('backfillFileMediaMetadata complete', {
    shardIndex,
    shardCount,
    scanned,
    persistedFast,
    enriched,
    skipped,
    failed,
  });
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  logger.error('backfillFileMediaMetadata fatal', {
    error: error instanceof Error ? error.message : String(error),
  });
  void mongoose.disconnect().finally(() => process.exit(1));
});
