#!/usr/bin/env bun
/**
 * Admin one-shot: delete 18 approved test/QA users from the Oxy production DB
 * with a CLEAN CASCADE (email mailboxes/messages/S3 attachments + refresh
 * tokens + notifications), then delete the User document.
 *
 * This is an ALREADY-APPROVED, audited admin cleanup (operator: Nate). A fresh
 * verified Mongo backup exists prior to this run. The account
 * `69872d81dcebd961b05c3073` (`test`) is CONSERVED and MUST still exist after.
 *
 * Modes:
 *   - DRY-RUN (default): writes NOTHING. Loads + guards the 18, prints the plan
 *     with per-collection counts that WOULD be deleted.
 *   - EXECUTE: only when `process.env.DELETE_EXECUTE === '1'`. Performs the
 *     destructive cascade per user.
 *
 * Bootstrap mirrors the app: importing `emailService` transitively constructs
 * the real S3/assetService singletons from env. `deleteAllUserData` is the
 * canonical cascade used by `DELETE /me` (S3 unlink → Message.deleteMany →
 * Mailbox.deleteMany).
 *
 * Hard rule: if ANY guard fails, env is missing, or counts/identity don't match
 * EXACTLY — ABORT and exit non-zero. No partial deletes, no improvisation.
 *
 * Run (inside the oxy-api image, working dir /app/packages/api):
 *   bun /tmp/del.ts                  # dry-run
 *   DELETE_EXECUTE=1 bun /tmp/del.ts # execute
 */

import mongoose from 'mongoose';
import { emailService } from '../src/services/email.service';
import { User } from '../src/models/User';
import { Message } from '../src/models/Message';
import { Mailbox } from '../src/models/Mailbox';
import { RefreshToken } from '../src/models/RefreshToken';
import Notification from '../src/models/Notification';
import { logger } from '../src/utils/logger';

type ObjId = mongoose.Types.ObjectId;

interface ExpectedIdentity {
  id: string;
  username: string;
  email: string;
}

// ── TARGET — 18 ids with expected identity (drives the GUARD) ──
const TARGETS: ExpectedIdentity[] = [
  { id: '69a335a98cffe931ac79154e', username: 'c4test', email: 'c4test@testeo.com' },
  { id: '69d43c8e317eb5d40150ddd1', username: 'testus', email: 'testus@testus.com' },
  { id: '6a2a44f97345e6306a135178', username: 'oxytest1781155065', email: 'oxytest1781155065@oxy.so' },
  { id: '6a2a47597345e6306a1351c9', username: 'oxytest1781155673', email: 'oxytest1781155673@oxy.so' },
  { id: '6a2a90f47576d7b5587bd36f', username: 'fcmtest1781174515', email: 'fedcmtest_1781174515@oxytest.dev' },
  { id: '6a2a94c0d42f4945ee3a8aeb', username: 'oxyqa1781175481', email: 'oxyqa1781175481@oxy.so' },
  { id: '6a2a94cdd42f4945ee3a8b0e', username: 'oxyqa1781175481b', email: 'oxyqa1781175481b@oxy.so' },
  { id: '6a2a951ad42f4945ee3a8b2e', username: 'oxyqa1781175577', email: 'oxyqa1781175577@oxy.so' },
  { id: '6a2a9d8a9d2bba18d2094869', username: 'sessbug1781177737', email: 'sessbug+1781177737@example.com' },
  { id: '6a2ab6b77ddefa12861e7d1a', username: 'cbverify1781184182', email: 'coldboot.verify.1781184182@example.com' },
  { id: '6a2ac3463dbcd972aadb93a0', username: 'rtverify1658a7ca', email: 'rtverify+1658a7ca@example.com' },
  { id: '6a2ac38b3dbcd972aadb93c4', username: 'rtrlc2678a96', email: 'rtrl+c2678a96@example.com' },
  { id: '6a2bb8770c7b501a9ecc1856', username: 'dup1781250166905264119', email: 'dup1781250166905264119@oxy.so' },
  { id: '6a2bb87a0c7b501a9ecc1877', username: 'dup1781250170045803828', email: 'dup1781250170045803828@oxy.so' },
  { id: '6a2bb87e0c7b501a9ecc189b', username: 'dup1781250173140665048', email: 'dup1781250173140665048@oxy.so' },
  { id: '698a8cd4137140f62f2e58e5', username: 'demo', email: 'demo@oxy.so' },
  { id: '699dfcae6e987618868629d6', username: 'testeverest101', email: 'everesttest101@gmail.com' },
  { id: '69a31dfc6e9876188686301a', username: 'testeomucho', email: 'testeomucho@gmail.com' },
];

// CONSERVED account that MUST survive the run.
const CONSERVED_ID = '69872d81dcebd961b05c3073';
const CONSERVED_USERNAME = 'test';

const EXECUTE = process.env.DELETE_EXECUTE === '1';

/** A User lean doc is "local-or-untyped" iff type is local OR absent/null. */
function isLocalOrUntyped(type: unknown): boolean {
  return type === 'local' || type === undefined || type === null;
}

/**
 * S3 ENV PRECHECK. The assetService singleton constructs the S3 client from
 * these at import time, but it tolerates empty strings — so we assert the real
 * cascade can actually unlink S3 attachments BEFORE touching anything.
 */
function assertS3Env(): void {
  const missing: string[] = [];
  if (!process.env.AWS_S3_BUCKET) missing.push('AWS_S3_BUCKET');
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  if (missing.length > 0) {
    throw new Error(
      `ABORT: required S3 env missing (${missing.join(', ')}). ` +
        'The email/S3 cascade cannot run cleanly. No deletion performed.',
    );
  }
}

interface GuardedTarget extends ExpectedIdentity {
  objectId: ObjId;
}

/**
 * GUARD: load all 18 by _id. Assert EXACTLY 18 exist, each matches its expected
 * username (exact) + email (case-insensitive) and is local/untyped. ABORT on
 * any mismatch.
 */
async function guard(): Promise<GuardedTarget[]> {
  const ids = TARGETS.map((t) => new mongoose.Types.ObjectId(t.id));

  // The conserved account must NOT be in the target set.
  if (TARGETS.some((t) => t.id === CONSERVED_ID)) {
    throw new Error(`ABORT: conserved account ${CONSERVED_ID} is present in the target set.`);
  }

  const docs = await User.find({ _id: { $in: ids } })
    .select('_id username email type')
    .lean();

  const byId = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    byId.set(String(d._id), d);
  }

  const mismatches: string[] = [];
  const guarded: GuardedTarget[] = [];

  for (const t of TARGETS) {
    const doc = byId.get(t.id);
    if (!doc) {
      mismatches.push(`${t.id} (${t.username}): NOT FOUND in DB`);
      continue;
    }
    const actualUsername = typeof doc.username === 'string' ? doc.username : null;
    const actualEmail = typeof doc.email === 'string' ? doc.email : null;
    const actualType = doc.type;

    if (actualUsername !== t.username) {
      mismatches.push(`${t.id}: username expected "${t.username}" got "${actualUsername ?? '<missing>'}"`);
      continue;
    }
    if ((actualEmail ?? '').toLowerCase() !== t.email.toLowerCase()) {
      mismatches.push(`${t.id}: email expected "${t.email}" got "${actualEmail ?? '<missing>'}"`);
      continue;
    }
    if (!isLocalOrUntyped(actualType)) {
      mismatches.push(`${t.id}: type must be local/untyped, got "${String(actualType)}"`);
      continue;
    }
    guarded.push({ ...t, objectId: new mongoose.Types.ObjectId(t.id) });
  }

  // Reject any extra docs returned beyond the target set (defensive).
  const extra = docs.filter((d) => !TARGETS.some((t) => t.id === String(d._id)));
  if (extra.length > 0) {
    mismatches.push(`unexpected extra docs returned: ${extra.map((d) => String(d._id)).join(', ')}`);
  }

  if (docs.length !== TARGETS.length) {
    mismatches.push(`expected EXACTLY ${TARGETS.length} users, found ${docs.length}`);
  }

  if (mismatches.length > 0 || guarded.length !== TARGETS.length) {
    throw new Error('ABORT: guard failed:\n  - ' + mismatches.join('\n  - '));
  }

  return guarded;
}

interface PlanCounts {
  mailboxes: number;
  messages: number;
  refreshTokens: number;
  notifications: number;
}

async function computePlanCounts(ids: ObjId[]): Promise<PlanCounts> {
  const mailboxes = await Mailbox.countDocuments({ userId: { $in: ids } });
  const messages = await Message.countDocuments({ userId: { $in: ids } });
  const refreshTokens = await RefreshToken.countDocuments({ userId: { $in: ids } });
  const notifications = await Notification.countDocuments({
    $or: [{ recipientId: { $in: ids } }, { actorId: { $in: ids } }],
  });
  return { mailboxes, messages, refreshTokens, notifications };
}

async function run(): Promise<number> {
  // 1) S3 env precheck (before any read or write).
  assertS3Env();
  logger.info('S3 env precheck passed', {
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.AWS_S3_BUCKET,
    endpoint: process.env.AWS_ENDPOINT_URL || '<default-aws>',
  });

  // 2) GUARD.
  const guarded = await guard();
  const ids = guarded.map((g) => g.objectId);
  logger.info('GUARD PASSED', { confirmedCount: guarded.length });
  console.log(`GUARD_PASSED count=${guarded.length}`);
  for (const g of guarded) {
    console.log(`  CONFIRMED ${g.id}  ${g.username}  ${g.email}`);
  }

  // 3) Conserved account check.
  const conserved = await User.findById(CONSERVED_ID).select('_id username').lean();
  if (!conserved || conserved.username !== CONSERVED_USERNAME) {
    throw new Error(
      `ABORT: conserved account ${CONSERVED_ID} (${CONSERVED_USERNAME}) not found or wrong username ` +
        `(got "${conserved?.username ?? '<missing>'}"). Refusing to proceed.`,
    );
  }
  console.log(
    `CONSERVED_OK ${CONSERVED_ID} (${CONSERVED_USERNAME}) exists and is NOT in the target set.`,
  );

  // 4) Plan counts (computed BEFORE any deletion so the summary is accurate;
  //    deleteAllUserData removes messages/mailboxes internally).
  const plan = await computePlanCounts(ids);
  console.log('PLAN_COUNTS=' + JSON.stringify({ users: guarded.length, ...plan }));
  console.log(
    `PLAN: would delete users=${guarded.length} mailboxes=${plan.mailboxes} ` +
      `messages=${plan.messages} refreshTokens=${plan.refreshTokens} ` +
      `notifications=${plan.notifications} (+ S3 attachments via deleteAllUserData)`,
  );

  if (!EXECUTE) {
    console.log('DRY_RUN: no writes performed. Set DELETE_EXECUTE=1 to execute.');
    logger.info('Dry-run complete; nothing written');
    return 0;
  }

  // 5) EXECUTE — destructive cascade, per user, in target order.
  console.log('EXECUTE: starting destructive cascade...');
  const summary = {
    users: 0,
    mailboxes: 0,
    messages: 0,
    refreshTokens: 0,
    notifications: 0,
  };
  // S3 attachments are unlinked inside deleteAllUserData; we record the
  // pre-delete attachment-bearing message count as a lower-bound signal.
  let s3AttachmentMessages = 0;

  for (const g of guarded) {
    const userId = g.id;

    // Per-user counts BEFORE deletion (deleteAllUserData removes these).
    const userMailboxes = await Mailbox.countDocuments({ userId: g.objectId });
    const userMessages = await Message.countDocuments({ userId: g.objectId });
    const userAttachMsgs = await Message.countDocuments({
      userId: g.objectId,
      'attachments.0': { $exists: true },
    });

    // (a) canonical email cascade: S3 unlink → Message.deleteMany → Mailbox.deleteMany
    await emailService.deleteAllUserData(userId);

    // (b) delete the user document
    await User.findByIdAndDelete(userId);

    // (c) refresh tokens + notifications
    const rt = await RefreshToken.deleteMany({ userId: g.objectId });
    const notif = await Notification.deleteMany({
      $or: [{ recipientId: g.objectId }, { actorId: g.objectId }],
    });

    summary.users += 1;
    summary.mailboxes += userMailboxes;
    summary.messages += userMessages;
    summary.refreshTokens += rt.deletedCount ?? 0;
    summary.notifications += notif.deletedCount ?? 0;
    s3AttachmentMessages += userAttachMsgs;

    console.log(
      `DELETED ${g.id} ${g.username}: mailboxes=${userMailboxes} messages=${userMessages} ` +
        `refreshTokens=${rt.deletedCount ?? 0} notifications=${notif.deletedCount ?? 0} ` +
        `attachmentMessages=${userAttachMsgs}`,
    );
  }

  // 6) POST-RUN assertions.
  const remaining = await User.find({ _id: { $in: ids } }).select('_id').lean();
  if (remaining.length !== 0) {
    throw new Error(
      `ABORT: post-run integrity FAILED — ${remaining.length} of the 18 users still exist: ` +
        remaining.map((r) => String(r._id)).join(', '),
    );
  }
  if (summary.users !== TARGETS.length) {
    throw new Error(
      `ABORT: post-run integrity FAILED — deleted ${summary.users} users, expected ${TARGETS.length}.`,
    );
  }
  const conservedAfter = await User.findById(CONSERVED_ID).select('_id username').lean();
  if (!conservedAfter || conservedAfter.username !== CONSERVED_USERNAME) {
    throw new Error(
      `ABORT: post-run integrity FAILED — conserved account ${CONSERVED_ID} (${CONSERVED_USERNAME}) ` +
        `is missing after the run.`,
    );
  }

  console.log(
    'EXECUTE_SUMMARY=' +
      JSON.stringify({ ...summary, s3AttachmentMessages, conservedStillExists: true }),
  );
  console.log(
    `EXECUTE done: users=${summary.users} mailboxes=${summary.mailboxes} ` +
      `messages=${summary.messages} refreshTokens=${summary.refreshTokens} ` +
      `notifications=${summary.notifications} s3AttachmentMessages=${s3AttachmentMessages}`,
  );
  console.log(`CONSERVED_STILL_EXISTS ${CONSERVED_ID} (${CONSERVED_USERNAME}) OK`);
  console.log('POST_RUN_OK: exactly 18 users deleted, conserved account intact.');
  logger.info('Execute complete', summary);
  return 0;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('ABORT: MONGODB_URI is required');
    console.log('ABORT: MONGODB_URI is required');
    process.exit(1);
  }

  console.log(`MODE=${EXECUTE ? 'EXECUTE' : 'DRY_RUN'}`);
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB (delete-junk-users)', { mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN' });

  let code = 0;
  try {
    code = await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('delete-junk-users aborted', error instanceof Error ? error : new Error(message), {
      component: 'delete-junk-users',
      method: 'main',
    });
    console.log(message);
    code = 1;
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
  process.exit(code);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('delete-junk-users fatal', error instanceof Error ? error : new Error(message), {
    component: 'delete-junk-users',
    method: 'main',
  });
  console.log('FATAL: ' + message);
  process.exit(1);
});
