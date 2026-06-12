#!/usr/bin/env bun
/**
 * One-time migration: wipe legacy email attachments.
 *
 * Why it exists:
 *   Pre-migration, `Message.attachments[]` stored raw `{ s3Key, filename,
 *   contentType, size }` records pointing at objects in a dedicated
 *   `oxy-email-*` bucket. The Oxy File Manager migration changed the
 *   contract to `{ fileId, name, contentType, size, contentId?, isInline }`
 *   referencing canonical `File` records via assetService. We chose NOT
 *   to back-migrate legacy blobs (decision recorded in CLAUDE.md and the
 *   session handoff): instead, we drop the legacy bucket contents and
 *   clear the now-invalid `attachments` arrays so the inbox surfaces
 *   the messages without broken attachment chips.
 *
 * Behavior:
 *   - Phase 1 (DB): `Message.updateMany({ "attachments.s3Key": { $exists: true } }, { $set: { attachments: [] } })`.
 *     Targets only messages whose subdocuments still carry the legacy key.
 *   - Phase 2 (S3): empty the legacy bucket. Paginated `ListObjectsV2` →
 *     batch `DeleteObjects` (max 1000 per request, per AWS limit).
 *   - The bucket itself is NOT removed — that's a manual op after this
 *     script reports zero remaining objects.
 *
 * Idempotent: safe to re-run. DB phase only touches docs that still match
 * the legacy filter; S3 phase no-ops when the bucket is already empty.
 *
 * Run:
 *   cd packages/api && bun run scripts/wipe-legacy-email-attachments.ts
 *
 * Required env:
 *   MONGODB_URI                 Mongo connection string
 *   EMAIL_LEGACY_BUCKET         Legacy bucket name (e.g. oxy-email-237343248947)
 *   AWS_REGION                  AWS region for the legacy bucket
 *   AWS_ACCESS_KEY_ID           IAM credentials with s3:ListBucket,
 *   AWS_SECRET_ACCESS_KEY       s3:DeleteObject on the legacy bucket
 *
 * Optional env:
 *   DRY_RUN=true                Report counts without writing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';

import { Message } from '../src/models/Message';
import { logger } from '../src/utils/logger';

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === 'true';
const S3_DELETE_BATCH = 1000;

interface WipeStats {
  matchedMessages: number;
  clearedMessages: number;
  s3ObjectsListed: number;
  s3ObjectsDeleted: number;
  errors: number;
}

async function clearLegacyAttachmentsInDb(stats: WipeStats): Promise<void> {
  const filter = { 'attachments.s3Key': { $exists: true } };

  const matched = await Message.countDocuments(filter);
  stats.matchedMessages = matched;
  logger.info(`Messages with legacy attachment shape: ${matched}`);

  if (matched === 0) {
    logger.info('No legacy attachment records found in DB. Skipping update.');
    return;
  }

  if (DRY_RUN) {
    logger.info(`[DRY_RUN] Would clear attachments[] on ${matched} messages.`);
    return;
  }

  const result = await Message.updateMany(filter, { $set: { attachments: [] } });
  stats.clearedMessages = result.modifiedCount ?? 0;
  logger.info(`Cleared attachments[] on ${stats.clearedMessages} messages.`);
}

async function emptyLegacyBucket(stats: WipeStats): Promise<void> {
  const bucket = process.env.EMAIL_LEGACY_BUCKET;
  if (!bucket) {
    throw new Error('EMAIL_LEGACY_BUCKET env var is required');
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error('AWS_REGION env var is required');
  }
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');
  }

  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  let continuationToken: string | undefined;
  let page = 0;

  do {
    page += 1;
    const list: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: S3_DELETE_BATCH,
      })
    );

    const keys = (list.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    stats.s3ObjectsListed += keys.length;

    if (keys.length === 0) {
      logger.info(`Page ${page}: empty.`);
    } else if (DRY_RUN) {
      logger.info(`[DRY_RUN] Page ${page}: would delete ${keys.length} objects.`);
    } else {
      const deleteResult = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      const errorCount = deleteResult.Errors?.length ?? 0;
      stats.errors += errorCount;
      stats.s3ObjectsDeleted += keys.length - errorCount;
      logger.info(`Page ${page}: deleted ${keys.length - errorCount} objects (errors: ${errorCount}).`);
      if (deleteResult.Errors && deleteResult.Errors.length > 0) {
        for (const e of deleteResult.Errors) {
          logger.error('S3 delete error', new Error(e.Message ?? 'unknown'), { key: e.Key, code: e.Code });
        }
      }
    }

    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI env var is required');
  }

  await mongoose.connect(uri);
  logger.info(`Connected to MongoDB${DRY_RUN ? ' (DRY_RUN)' : ''}`);

  const stats: WipeStats = {
    matchedMessages: 0,
    clearedMessages: 0,
    s3ObjectsListed: 0,
    s3ObjectsDeleted: 0,
    errors: 0,
  };

  try {
    await clearLegacyAttachmentsInDb(stats);
    await emptyLegacyBucket(stats);
  } finally {
    await mongoose.disconnect();
  }

  logger.info('Wipe complete', {
    matchedMessages: stats.matchedMessages,
    clearedMessages: stats.clearedMessages,
    s3ObjectsListed: stats.s3ObjectsListed,
    s3ObjectsDeleted: stats.s3ObjectsDeleted,
    errors: stats.errors,
    dryRun: DRY_RUN,
  });

  if (stats.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  logger.error('wipe-legacy-email-attachments failed', err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
