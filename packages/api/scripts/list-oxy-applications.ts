#!/usr/bin/env bun
/**
 * READ-ONLY: list ALL Application documents owned by user oxy.
 * NO writes. Prints { name, _id, status, type } sorted by name + total count.
 *
 * Run (inside oxy-api image, working dir /app):
 *   bun run packages/api/scripts/list-oxy-applications.ts
 */

import mongoose from 'mongoose';
import { Application } from '../src/models/Application';
import { logger } from '../src/utils/logger';

const OXY_ID = '69b2d3df5d12f58c9800d651';

async function run(): Promise<void> {
  const oxyId = new mongoose.Types.ObjectId(OXY_ID);
  const apps = await Application.find({ createdByUserId: oxyId })
    .select('_id name status type')
    .sort({ name: 1 })
    .lean();

  const list = apps.map((a) => ({
    name: a.name,
    _id: String(a._id),
    status: a.status,
    type: a.type,
  }));

  console.log(
    'LIST_JSON=' +
      JSON.stringify({ oxyId: OXY_ID, total: list.length, applications: list }, null, 2),
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB (read-only list)');
  try {
    await run();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'List failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'list-oxy-applications', method: 'main' },
  );
  process.exit(1);
});
