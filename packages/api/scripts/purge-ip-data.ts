#!/usr/bin/env bun
/**
 * One-shot purge of historical IP data (privacy invariant: no user IPs at rest).
 *
 * Removes: securityactivities.ipAddress, sessions.deviceInfo.{ipAddress,location},
 * apikeyusages.ipAddress. Idempotent. DRY_RUN=1 counts without writing.
 *
 * A salted hash of an IPv4 address is brute-forceable by anyone with server
 * access, so historical IPs (even where hashed) are removed outright rather than
 * re-hashed. Run as a one-shot ECS task AFTER deploying the api that stops new
 * IP writes (see docs/superpowers/specs/2026-07-14-no-ip-storage-design.md,
 * "Rollout order").
 *
 * Run:
 *   cd packages/api && bun run scripts/purge-ip-data.ts
 *
 * Env:
 *   MONGODB_URI   Mongo connection string (required)
 *   DRY_RUN=1     Report counts without writing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }
  const dryRun = process.env.DRY_RUN === '1';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No database handle after connect');
  }

  const targets = [
    { collection: 'securityactivities', filter: { ipAddress: { $exists: true } }, unset: { ipAddress: 1 } },
    {
      collection: 'sessions',
      filter: { $or: [{ 'deviceInfo.ipAddress': { $exists: true } }, { 'deviceInfo.location': { $exists: true } }] },
      unset: { 'deviceInfo.ipAddress': 1, 'deviceInfo.location': 1 },
    },
    { collection: 'apikeyusages', filter: { ipAddress: { $exists: true } }, unset: { ipAddress: 1 } },
  ] as const;

  for (const target of targets) {
    if (dryRun) {
      const count = await db.collection(target.collection).countDocuments(target.filter);
      console.log(`[DRY_RUN] ${target.collection}: ${count} docs would be updated`);
    } else {
      const result = await db.collection(target.collection).updateMany(target.filter, { $unset: target.unset });
      console.log(`${target.collection}: ${result.modifiedCount} docs purged`);
    }
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
