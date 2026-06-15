#!/usr/bin/env bun
/**
 * READ-ONLY diagnostic: why does console.oxy.so show 0 applications for "oxy"?
 *
 * NO writes. Reports:
 *   1. All users with username 'oxy' (exact) and any user with email 'nate@oxy.so'.
 *   2. For the username:'oxy' user: Application.countDocuments({createdByUserId})
 *      and ApplicationMember.countDocuments({userId, status:'active'}).
 *   3. The 12 ApplicationMember docs for that user with raw type info on userId.
 *   4. One sample Application doc created for that user.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/diag-oxy-applications.ts
 */

import mongoose from 'mongoose';
import { Application } from '../src/models/Application';
import { ApplicationMember } from '../src/models/ApplicationMember';
import { User } from '../src/models/User';
import { logger } from '../src/utils/logger';

function bsonTypeOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof mongoose.Types.ObjectId) return 'ObjectId';
  return typeof v;
}

async function diag(): Promise<void> {
  const out: Record<string, unknown> = {};

  // ── 1. Users ──
  const oxyUsers = await User.find({ username: 'oxy' })
    .select('_id username email')
    .lean();
  const nateUsers = await User.find({ email: 'nate@oxy.so' })
    .select('_id username email')
    .lean();

  out.usersUsernameOxy = oxyUsers.map((u) => ({
    _id: String(u._id),
    username: u.username ?? null,
    email: u.email ?? null,
  }));
  out.usersEmailNate = nateUsers.map((u) => ({
    _id: String(u._id),
    username: u.username ?? null,
    email: u.email ?? null,
  }));

  // ── Resolve the seeded oxy id (username 'oxy') ──
  const oxy = oxyUsers[0];
  if (!oxy?._id) {
    out.error = "No user with username 'oxy' found";
    console.log('DIAG_JSON=' + JSON.stringify(out));
    return;
  }
  const oxyId = oxy._id as mongoose.Types.ObjectId;
  out.oxyId = String(oxyId);

  // ── 2. Counts ──
  const appCount = await Application.countDocuments({ createdByUserId: oxyId });
  const memberActiveCount = await ApplicationMember.countDocuments({
    userId: oxyId,
    status: 'active',
  });
  const memberAnyCount = await ApplicationMember.countDocuments({ userId: oxyId });
  out.counts = {
    applicationsCreatedByOxy: appCount,
    applicationMembersActiveForOxy: memberActiveCount,
    applicationMembersAnyStatusForOxy: memberAnyCount,
  };

  // ── 3. Dump ApplicationMember docs for oxy (raw type info) ──
  const members = await ApplicationMember.find({ userId: oxyId }).lean();
  out.membersForOxy = members.map((m) => ({
    _id: String(m._id),
    applicationId: String(m.applicationId),
    applicationIdType: bsonTypeOf(m.applicationId),
    userId: String(m.userId),
    userIdType: bsonTypeOf(m.userId),
    role: m.role,
    status: m.status,
  }));

  // Also: is there ANY member row whose userId is stored as the oxy id STRING
  // (data-shape mismatch) rather than ObjectId? Query by string id.
  const membersByStringId = await ApplicationMember.find({
    userId: String(oxyId) as unknown as mongoose.Types.ObjectId,
  }).lean();
  out.membersMatchedByStringUserId = membersByStringId.length;

  // ── 4. Sample one Application created for oxy ──
  const sampleApp = await Application.findOne({ createdByUserId: oxyId }).lean();
  if (sampleApp) {
    out.sampleApplication = {
      _id: String(sampleApp._id),
      name: sampleApp.name,
      status: sampleApp.status,
      type: sampleApp.type,
      isOfficial: sampleApp.isOfficial,
      createdByUserId: String(sampleApp.createdByUserId),
      createdByUserIdType: bsonTypeOf(sampleApp.createdByUserId),
    };
  } else {
    out.sampleApplication = null;
  }

  console.log('DIAG_JSON=' + JSON.stringify(out, null, 2));
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB (read-only diagnostic)');
  try {
    await diag();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Diag failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'diag-oxy-applications', method: 'main' },
  );
  process.exit(1);
});
