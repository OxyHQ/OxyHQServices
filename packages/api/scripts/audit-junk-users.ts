#!/usr/bin/env bun
/**
 * READ-ONLY audit of "junk" user accounts (test/QA users, and especially users
 * WITHOUT a username) before any cleanup decision is made.
 *
 * STRICTLY READ-ONLY. This script performs ONLY `.aggregate`, `.find`,
 * `.countDocuments`, and `.distinct` operations. It NEVER writes, updates,
 * deletes, or inserts anything. No `.save`, `.create`, `.updateOne`,
 * `.deleteOne`, `.findOneAndUpdate`, `.bulkWrite`, etc. anywhere below.
 *
 * Output: a single structured line `AUDIT_JSON=<json>` (mirrors the
 * `DIAG_JSON=` convention in diag-oxy-applications.ts) for log capture.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/audit-junk-users.ts
 */

import mongoose from 'mongoose';
import { User } from '../src/models/User';
import Follow from '../src/models/Follow';
import Session from '../src/models/Session';
import { ApplicationCredential } from '../src/models/ApplicationCredential';
import { ApplicationMember } from '../src/models/ApplicationMember';
import { RefreshToken } from '../src/models/RefreshToken';
import Block from '../src/models/Block';
import Restricted from '../src/models/Restricted';
import Notification from '../src/models/Notification';
import { logger } from '../src/utils/logger';

type ObjId = mongoose.Types.ObjectId;

// ── Shared predicate fragments (read-only filter expressions) ──

// "missing username": absent, null, or empty/whitespace-only string.
const MISSING_USERNAME = {
  $or: [
    { username: { $exists: false } },
    { username: null },
    { username: { $type: 'string', $regex: /^\s*$/ } },
  ],
};

// "missing real name": name.first AND name.last both absent/empty/whitespace.
const MISSING_REAL_NAME = {
  $and: [
    {
      $or: [
        { 'name.first': { $exists: false } },
        { 'name.first': null },
        { 'name.first': { $type: 'string', $regex: /^\s*$/ } },
      ],
    },
    {
      $or: [
        { 'name.last': { $exists: false } },
        { 'name.last': null },
        { 'name.last': { $type: 'string', $regex: /^\s*$/ } },
      ],
    },
  ],
};

const MISSING_BIO_AND_DESCRIPTION = {
  $and: [
    {
      $or: [
        { bio: { $exists: false } },
        { bio: null },
        { bio: { $type: 'string', $regex: /^\s*$/ } },
      ],
    },
    {
      $or: [
        { description: { $exists: false } },
        { description: null },
        { description: { $type: 'string', $regex: /^\s*$/ } },
      ],
    },
  ],
};

const MISSING_AVATAR = {
  $or: [
    { avatar: { $exists: false } },
    { avatar: null },
    { avatar: { $type: 'string', $regex: /^\s*$/ } },
  ],
};

const MISSING_EMAIL = {
  $or: [
    { email: { $exists: false } },
    { email: null },
    { email: { $type: 'string', $regex: /^\s*$/ } },
  ],
};

const HAS_PUBLIC_KEY = {
  publicKey: { $exists: true, $type: 'string', $regex: /\S/ },
};

// "local" criterion: type === 'local' OR type absent/null (legacy docs that are
// NOT federated/agent/automated). Reported explicitly in the output.
const LOCAL_FILTER = {
  $or: [
    { type: 'local' },
    { type: { $exists: false } },
    { type: null },
  ],
};

// Test-like email domains. Case-insensitive.
const TEST_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'oxytest.dev',
  'testus.com',
  'testeo.com',
  'test.com',
  'mailinator.com',
  'tempmail.com',
];
const TEST_EMAIL_REGEX = new RegExp(
  '@(' + TEST_EMAIL_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|') + ')$',
  'i',
);
// Test-like username patterns.
const TEST_USERNAME_REGEX = /^(oxyqa|oxytest|sessbug|dup|verify|test|qa|e2e|demo|tmp|temp|sample)/i;

const TEST_LIKE_FILTER = {
  $or: [
    { email: { $regex: TEST_EMAIL_REGEX } },
    { username: { $regex: TEST_USERNAME_REGEX } },
  ],
};

// Peak-week window 2026-06-07 .. 2026-06-13 inclusive (UTC).
const PEAK_WEEK_START = new Date('2026-06-07T00:00:00.000Z');
const PEAK_WEEK_END = new Date('2026-06-14T00:00:00.000Z'); // exclusive upper bound = end of 06-13

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Count how many of `ids` are referenced across the linkage collections.
 * READ-ONLY: countDocuments / aggregate only.
 */
async function linkageForCategory(ids: ObjId[]): Promise<Record<string, number>> {
  if (ids.length === 0) {
    return {
      categorySize: 0,
      followAsFollower: 0,
      followAsFollowed: 0,
      referencedInOtherUsersFollowingArray: 0,
      referencedInOtherUsersFollowersArray: 0,
      ownNonEmptyFollowingOrFollowers: 0,
      activeSessions: 0,
      applicationCredentialsCreatedBy: 0,
      applicationMemberships: 0,
      refreshTokens: 0,
      blocksInitiatedOrTarget: 0,
      restrictedInitiatedOrTarget: 0,
      notificationsRecipientOrActor: 0,
    };
  }

  const followAsFollower = await Follow.countDocuments({ followerUserId: { $in: ids } });
  const followAsFollowed = await Follow.countDocuments({ followedId: { $in: ids } });

  // How many OTHER user docs embed one of these ids in their following/followers
  // arrays. Counts distinct referencing users, not occurrences.
  const referencedInFollowing = await User.countDocuments({ following: { $in: ids } });
  const referencedInFollowers = await User.countDocuments({ followers: { $in: ids } });

  // How many of the category have their OWN non-empty following/followers array.
  const ownNonEmptyGraph = await User.countDocuments({
    _id: { $in: ids },
    $or: [
      { 'following.0': { $exists: true } },
      { 'followers.0': { $exists: true } },
    ],
  });

  const now = new Date();
  const activeSessions = await Session.countDocuments({
    userId: { $in: ids },
    isActive: true,
    expiresAt: { $gt: now },
  });

  const appCreds = await ApplicationCredential.countDocuments({ createdByUserId: { $in: ids } });
  const appMembers = await ApplicationMember.countDocuments({ userId: { $in: ids } });
  const refreshTokens = await RefreshToken.countDocuments({ userId: { $in: ids } });

  const blocks = await Block.countDocuments({
    $or: [{ userId: { $in: ids } }, { blockedId: { $in: ids } }],
  });
  const restricted = await Restricted.countDocuments({
    $or: [{ userId: { $in: ids } }, { restrictedId: { $in: ids } }],
  });
  const notifications = await Notification.countDocuments({
    $or: [{ recipientId: { $in: ids } }, { actorId: { $in: ids } }],
  });

  return {
    categorySize: ids.length,
    followAsFollower,
    followAsFollowed,
    referencedInOtherUsersFollowingArray: referencedInFollowing,
    referencedInOtherUsersFollowersArray: referencedInFollowers,
    ownNonEmptyFollowingOrFollowers: ownNonEmptyGraph,
    activeSessions,
    applicationCredentialsCreatedBy: appCreds,
    applicationMemberships: appMembers,
    refreshTokens,
    blocksInitiatedOrTarget: blocks,
    restrictedInitiatedOrTarget: restricted,
    notificationsRecipientOrActor: notifications,
  };
}

async function audit(): Promise<void> {
  const out: Record<string, unknown> = {};
  out.generatedAt = new Date().toISOString();
  out.note =
    'READ-ONLY audit. Mention posts live in a SEPARATE DB (Mention) linked by oxyUserId — NOT queried here. Nate must verify post linkage cross-DB before any deletion.';
  out.criteria = {
    localDefinition: "type === 'local' OR type absent/null (NOT federated/agent/automated)",
    missingUsername: 'absent, null, or empty/whitespace-only string',
    testEmailDomains: TEST_EMAIL_DOMAINS,
    testUsernamePatterns: TEST_USERNAME_REGEX.source,
    peakWeek: { startInclusive: PEAK_WEEK_START.toISOString(), endInclusive: '2026-06-13 (exclusive bound ' + PEAK_WEEK_END.toISOString() + ')' },
  };

  // ── A) Global counts ──
  const totalUsers = await User.countDocuments({});
  const byTypeAgg = await User.aggregate<{ _id: string; count: number }>([
    { $group: { _id: { $ifNull: ['$type', '__missing__'] }, count: { $sum: 1 } } },
  ]);
  const byType: Record<string, number> = {};
  for (const row of byTypeAgg) {
    byType[row._id] = row.count;
  }
  out.A_globalCounts = { totalUsers, byType };

  // ── B) LOCAL users ──
  const localTotal = await User.countDocuments(LOCAL_FILTER);
  const localNoUsername = await User.countDocuments({ $and: [LOCAL_FILTER, MISSING_USERNAME] });
  const localNoRealName = await User.countDocuments({ $and: [LOCAL_FILTER, MISSING_REAL_NAME] });
  const localNoBioDesc = await User.countDocuments({ $and: [LOCAL_FILTER, MISSING_BIO_AND_DESCRIPTION] });
  const localNoAvatar = await User.countDocuments({ $and: [LOCAL_FILTER, MISSING_AVATAR] });
  const localKeyOnly = await User.countDocuments({
    $and: [LOCAL_FILTER, HAS_PUBLIC_KEY, MISSING_EMAIL, MISSING_USERNAME],
  });
  const localTestLike = await User.countDocuments({ $and: [LOCAL_FILTER, TEST_LIKE_FILTER] });

  const localTestLikeSampleDocs = await User.find({ $and: [LOCAL_FILTER, TEST_LIKE_FILTER] })
    .select('_id username email createdAt type')
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();
  const localTestLikeSample = localTestLikeSampleDocs.map((u) => ({
    _id: String(u._id),
    username: asString(u.username),
    email: asString(u.email),
    type: asString(u.type) ?? '__missing__',
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));

  const peakWeekRange = { createdAt: { $gte: PEAK_WEEK_START, $lt: PEAK_WEEK_END } };
  const localPeakWeekTotal = await User.countDocuments({ $and: [LOCAL_FILTER, peakWeekRange] });
  const localPeakWeekTestLike = await User.countDocuments({
    $and: [LOCAL_FILTER, peakWeekRange, TEST_LIKE_FILTER],
  });

  out.B_localUsers = {
    localTotal,
    noUsername: localNoUsername,
    noRealName: localNoRealName,
    noBioAndNoDescription: localNoBioDesc,
    noAvatar: localNoAvatar,
    keyOnly_publicKeyButNoEmailNoUsername: localKeyOnly,
    testLikeTotal: localTestLike,
    testLikeSample: localTestLikeSample,
    peakWeek_2026_06_07_to_13: {
      total: localPeakWeekTotal,
      testLike: localPeakWeekTestLike,
    },
  };

  // ── C) FEDERATED users WITHOUT username (most important) ──
  const fedNoUsernameFilter = { $and: [{ type: 'federated' }, MISSING_USERNAME] };
  const fedTotal = await User.countDocuments({ type: 'federated' });
  const fedNoUsername = await User.countDocuments(fedNoUsernameFilter);
  const fedNoUsernameWithActorUri = await User.countDocuments({
    $and: [
      { type: 'federated' },
      MISSING_USERNAME,
      { 'federation.actorUri': { $exists: true, $type: 'string', $regex: /\S/ } },
    ],
  });
  const fedNoUsernameNoActorUri = fedNoUsername - fedNoUsernameWithActorUri;

  const fedNoUsernameSampleDocs = await User.find(fedNoUsernameFilter)
    .select('_id username federation createdAt')
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();
  const fedNoUsernameSample = fedNoUsernameSampleDocs.map((u) => {
    const fed = (u.federation ?? {}) as {
      actorUri?: unknown;
      domain?: unknown;
      actorId?: unknown;
    };
    return {
      _id: String(u._id),
      username: asString(u.username),
      actorUri: asString(fed.actorUri),
      domain: asString(fed.domain),
      actorId: asString(fed.actorId),
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
    };
  });

  // Oldest + newest createdAt among federated-no-username (to test the
  // "legacy import" hypothesis against the current guards).
  const fedNoUsernameByAgeOldest = await User.find(fedNoUsernameFilter)
    .select('_id createdAt')
    .sort({ createdAt: 1 })
    .limit(1)
    .lean();
  const fedNoUsernameByAgeNewest = await User.find(fedNoUsernameFilter)
    .select('_id createdAt')
    .sort({ createdAt: -1 })
    .limit(1)
    .lean();

  // Group federated-no-username by federation.domain (top 10).
  const fedNoUsernameByDomain = await User.aggregate<{ _id: string; count: number }>([
    { $match: { type: 'federated', ...MISSING_USERNAME } },
    { $group: { _id: { $ifNull: ['$federation.domain', '__missing__'] }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  out.C_federatedNoUsername = {
    federatedTotal: fedTotal,
    federatedNoUsername: fedNoUsername,
    federatedNoUsernameWithActorUri: fedNoUsernameWithActorUri,
    federatedNoUsernameWithoutActorUri: fedNoUsernameNoActorUri,
    oldestCreatedAt: fedNoUsernameByAgeOldest[0]?.createdAt
      ? new Date(fedNoUsernameByAgeOldest[0].createdAt).toISOString()
      : null,
    newestCreatedAt: fedNoUsernameByAgeNewest[0]?.createdAt
      ? new Date(fedNoUsernameByAgeNewest[0].createdAt).toISOString()
      : null,
    topDomains: fedNoUsernameByDomain.map((d) => ({ domain: d._id, count: d.count })),
    sample: fedNoUsernameSample,
  };

  // ── D) Linkage downstream for the 3 candidate categories ──
  // (1) test-like locals, (2) key-only locals, (3) federated-no-username.
  const testLikeIds = (
    await User.find({ $and: [LOCAL_FILTER, TEST_LIKE_FILTER] }).select('_id').lean()
  ).map((u) => u._id as ObjId);
  const keyOnlyIds = (
    await User.find({ $and: [LOCAL_FILTER, HAS_PUBLIC_KEY, MISSING_EMAIL, MISSING_USERNAME] })
      .select('_id')
      .lean()
  ).map((u) => u._id as ObjId);
  const fedNoUsernameIds = (
    await User.find(fedNoUsernameFilter).select('_id').lean()
  ).map((u) => u._id as ObjId);

  out.D_linkage = {
    testLikeLocals: await linkageForCategory(testLikeIds),
    keyOnlyLocals: await linkageForCategory(keyOnlyIds),
    federatedNoUsername: await linkageForCategory(fedNoUsernameIds),
  };

  console.log('AUDIT_JSON=' + JSON.stringify(out));
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB (read-only junk-user audit)');
  try {
    await audit();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Audit failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'audit-junk-users', method: 'main' },
  );
  process.exit(1);
});
