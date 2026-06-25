#!/usr/bin/env bun
/**
 * READ-ONLY freeze audit of LOCAL "test-like" user accounts.
 *
 * STRICTLY READ-ONLY. This script performs ONLY `.find`, `.countDocuments`,
 * and `.lean()` read operations. It NEVER writes, updates, deletes, or inserts
 * anything. There is NO `.save`, `.create`, `.insertOne`/`.insertMany`,
 * `.updateOne`/`.updateMany`, `.deleteOne`/`.deleteMany`, `.findOneAndUpdate`,
 * `.findOneAndDelete`, `.findByIdAndUpdate`, `.findByIdAndDelete`,
 * `.bulkWrite`, `.replaceOne`, or `.remove*` anywhere below. The Mongoose
 * connection is opened, queried, and closed; no mutation is ever issued.
 *
 * Purpose: produce an EXACT, FROZEN list of all LOCAL test-like users to use as
 * an immutable target for a LATER deletion performed elsewhere. This script DOES
 * NOT delete anything and MUST NOT be used to delete anything.
 *
 * It evaluates TWO criteria in the same run so they can be compared:
 *   - CRITERION_NEW: the user's exact criterion (4 email domains + 8 username
 *     prefixes).
 *   - CRITERION_OLD: the broader criterion copied verbatim from
 *     audit-junk-users.ts (TEST_EMAIL_REGEX / TEST_USERNAME_REGEX), used to
 *     reproduce the prior run's testLikeTotal and compute the delta.
 *
 * Output: a single structured line `FREEZE_JSON=<json>` for log capture.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/audit-test-like-freeze.ts
 */

import mongoose from 'mongoose';
import { User } from '../src/models/User';
import Follow from '../src/models/Follow';
import Session from '../src/models/Session';
import { RefreshToken } from '../src/models/RefreshToken';
import Notification from '../src/models/Notification';
import { logger } from '../src/utils/logger';

type ObjId = mongoose.Types.ObjectId;

// ── "local" criterion: type === 'local' OR type absent/null. ──
const LOCAL_FILTER = {
  $or: [
    { type: 'local' },
    { type: { $exists: false } },
    { type: null },
  ],
} as const;

// ── CRITERION_NEW (user's exact spec) ──
// 4 email domains, exact, anchored to end, case-insensitive.
const NEW_EMAIL_REGEX = /@(example\.com|oxytest\.dev|testus\.com|testeo\.com)$/i;
// 8 username prefixes, case-insensitive prefix match.
const NEW_USERNAME_REGEX = /^(dup|oxyqa|oxytest|sessbug|rtverify|cbverify|fcmtest|c4test)/i;

// Concrete NEW domains/prefixes, used to report which concrete value matched.
const NEW_EMAIL_DOMAINS = ['example.com', 'oxytest.dev', 'testus.com', 'testeo.com'] as const;
const NEW_USERNAME_PREFIXES = [
  'dup',
  'oxyqa',
  'oxytest',
  'sessbug',
  'rtverify',
  'cbverify',
  'fcmtest',
  'c4test',
] as const;

// ── CRITERION_OLD (copied EXACTLY from audit-junk-users.ts) ──
const OLD_TEST_EMAIL_DOMAINS = [
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
const OLD_TEST_EMAIL_REGEX = new RegExp(
  '@(' + OLD_TEST_EMAIL_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|') + ')$',
  'i',
);
const OLD_TEST_USERNAME_REGEX = /^(oxyqa|oxytest|sessbug|dup|verify|test|qa|e2e|demo|tmp|temp|sample)/i;

const NEW_TEST_LIKE_FILTER = {
  $or: [
    { email: { $regex: NEW_EMAIL_REGEX } },
    { username: { $regex: NEW_USERNAME_REGEX } },
  ],
};

const OLD_TEST_LIKE_FILTER = {
  $or: [
    { email: { $regex: OLD_TEST_EMAIL_REGEX } },
    { username: { $regex: OLD_TEST_USERNAME_REGEX } },
  ],
};

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

interface NewUserRow {
  _id: string;
  username: string | null;
  email: string | null;
  type: string;
  createdAt: string | null;
  matchedRule: string;
  refreshTokens: number;
  notifications: number;
  followsAsFollower: number;
  followsAsFollowed: number;
  activeSessions: number;
}

interface OldUserRow {
  _id: string;
  username: string | null;
  email: string | null;
  createdAt: string | null;
}

/**
 * Re-test the NEW criterion in JS to determine which concrete rule(s) matched.
 * Leads with the email-domain rule when present (per spec: "lead with whichever;
 * report precisely"), then appends the username-prefix rule if it also matches.
 */
function computeMatchedRule(username: string | null, email: string | null): string {
  const rules: string[] = [];

  const domain = emailDomain(email);
  if (email && NEW_EMAIL_REGEX.test(email) && domain) {
    const concreteDomain = NEW_EMAIL_DOMAINS.find((d) => d === domain) ?? domain;
    rules.push(`email-domain:${concreteDomain}`);
  }

  if (username) {
    const lower = username.toLowerCase();
    const prefix = NEW_USERNAME_PREFIXES.find((p) => lower.startsWith(p));
    if (prefix) {
      rules.push(`username-prefix:${prefix}`);
    }
  }

  return rules.join(' + ');
}

async function audit(): Promise<void> {
  const out: Record<string, unknown> = {};
  out.generatedAt = new Date().toISOString();
  out.note =
    'READ-ONLY freeze audit. Mention posts live in a SEPARATE DB (Mention) linked by oxyUserId — NOT queried here. Verify cross-DB post linkage before any deletion. This script performs ZERO writes.';

  out.criterionNew = {
    localDefinition: "type === 'local' OR type absent/null (NOT federated/agent/automated)",
    emailDomains: NEW_EMAIL_DOMAINS,
    emailRegex: NEW_EMAIL_REGEX.source,
    usernamePrefixes: NEW_USERNAME_PREFIXES,
    usernameRegex: NEW_USERNAME_REGEX.source,
    rtrlNote:
      'rtrl/rtrlc usernames are NOT a NEW username prefix. An rtrlc user only matches NEW via its @example.com email domain, never via username.',
  };
  out.criterionOld = {
    emailDomains: OLD_TEST_EMAIL_DOMAINS,
    emailRegex: OLD_TEST_EMAIL_REGEX.source,
    usernameRegex: OLD_TEST_USERNAME_REGEX.source,
  };

  const now = new Date();

  // ── CRITERION_NEW: full matched list + per-account linkage ──
  const newDocs = await User.find({ $and: [LOCAL_FILTER, NEW_TEST_LIKE_FILTER] })
    .select('_id username email type createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const newList: NewUserRow[] = [];
  for (const u of newDocs) {
    const userId = u._id as ObjId;
    const username = asString(u.username);
    const email = asString(u.email);

    const refreshTokens = await RefreshToken.countDocuments({ userId });
    const notifications = await Notification.countDocuments({
      $or: [{ recipientId: userId }, { actorId: userId }],
    });
    const followsAsFollower = await Follow.countDocuments({ followerUserId: userId });
    const followsAsFollowed = await Follow.countDocuments({ followedId: userId });
    const activeSessions = await Session.countDocuments({
      userId,
      isActive: true,
      expiresAt: { $gt: now },
    });

    newList.push({
      _id: String(userId),
      username,
      email,
      type: asString(u.type) ?? '__missing__',
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
      matchedRule: computeMatchedRule(username, email),
      refreshTokens,
      notifications,
      followsAsFollower,
      followsAsFollowed,
      activeSessions,
    });
  }

  // ── CRITERION_OLD: full matched list (set only — for delta) ──
  const oldDocs = await User.find({ $and: [LOCAL_FILTER, OLD_TEST_LIKE_FILTER] })
    .select('_id username email createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const oldList: OldUserRow[] = oldDocs.map((u) => ({
    _id: String(u._id),
    username: asString(u.username),
    email: asString(u.email),
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));

  // ── Delta both directions (by _id string) ──
  const newIdSet = new Set(newList.map((u) => u._id));
  const oldIdSet = new Set(oldList.map((u) => u._id));

  const deltaOldNotNew = oldList
    .filter((u) => !newIdSet.has(u._id))
    .map((u) => ({ _id: u._id, username: u.username, email: u.email, createdAt: u.createdAt }));
  const deltaNewNotOld = newList
    .filter((u) => !oldIdSet.has(u._id))
    .map((u) => ({
      _id: u._id,
      username: u.username,
      email: u.email,
      createdAt: u.createdAt,
      matchedRule: u.matchedRule,
    }));

  // frozenIds: newList _ids sorted by createdAt asc (newList already sorted).
  const frozenIds = newList.map((u) => u._id);

  out.newCount = newList.length;
  out.oldCount = oldList.length;
  out.newList = newList;
  out.oldList = oldList;
  out.deltaOldNotNew = deltaOldNotNew;
  out.deltaNewNotOld = deltaNewNotOld;
  out.frozenIds = frozenIds;

  console.log('FREEZE_JSON=' + JSON.stringify(out));
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB (read-only test-like freeze audit)');
  try {
    await audit();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Freeze audit failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'audit-test-like-freeze', method: 'main' },
  );
  process.exit(1);
});
