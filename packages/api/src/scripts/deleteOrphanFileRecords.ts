#!/usr/bin/env bun
/**
 * One-shot: mark orphaned File records (missing S3 blob) as deleted so backfill
 * and variant generation skip them.
 *
 * Usage:
 *   ORPHAN_IDS=id1,id2,... bun packages/api/src/scripts/deleteOrphanFileRecords.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { File } from '../models/File.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const DEFAULT_ORPHANS = [
  '6981db864e659c104d11dcf7',
  '699093c40a3491f9abbd4c10',
  '69a4d84d8cffe931ac79175b',
  '69ab8953573f0eec8bf2c8a4',
  '69af783ba5aad3e10f21137e',
  '69af86fea5aad3e10f21150c',
  '69b03162231626d26db7a2b5',
  '69b063f8e084a07c2d835e02',
  '69b76d6bf124c4eb183e47e5',
  '6a2ebe5d044e8dfb758d791d',
  '6a2ec0c9044e8dfb758d7a16',
];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  const raw = process.env.ORPHAN_IDS?.trim();
  const ids = raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : DEFAULT_ORPHANS;

  await mongoose.connect(uri, { dbName: getDbName() });

  const before = await File.find({ _id: { $in: ids }, status: 'active' })
    .select({ _id: 1, storageKey: 1, mime: 1 })
    .lean();

  const result = await File.updateMany(
    { _id: { $in: ids }, status: 'active' },
    { $set: { status: 'deleted' } },
  );

  const remaining = await File.countDocuments({ _id: { $in: ids }, status: 'active' });

  logger.info('deleteOrphanFileRecords complete', {
    ids,
    activeBefore: before.length,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    remainingActive: remaining,
  });

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((error) => {
  logger.error('deleteOrphanFileRecords fatal', {
    error: error instanceof Error ? error.message : String(error),
  });
  void mongoose.disconnect().finally(() => process.exit(1));
});
