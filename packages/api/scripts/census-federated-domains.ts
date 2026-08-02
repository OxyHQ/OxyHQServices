#!/usr/bin/env bun
/**
 * READ-ONLY census of everything the Oxy platform holds on behalf of remote
 * federated instances, grouped by `User.federation.domain`.
 *
 * This script exists to answer one question before anything is ever deleted:
 * when an app (Mention) blocks a fediverse instance, how much data did that
 * instance leave behind in Oxy, and is any of it referenced by an app OTHER
 * than the one doing the blocking?
 *
 * It takes NO blocklist as input, deliberately. Oxy is not the authority on
 * which domains are blocked — the app that federates is (see
 * `packages/api/src/services/federation/blockedDomainPurge.service.ts` for how
 * a caller names one domain per purge request; Oxy never stores a blocklist).
 * Censusing every federated domain and letting the caller intersect keeps this
 * script honest about the fact that it does not know, and cannot decide, what
 * is blocked.
 *
 * What it does:
 *   1. Aggregates federated `users` by `federation.domain`.
 *   2. For every domain, counts the rows keyed to those users' `_id`s:
 *      files (with bytes), follow edges in BOTH directions, blocks, restricts
 *      and notifications.
 *   3. Reports, per domain, which APPLICATION uploaded those files
 *      (`files.metadata.serviceAppId`), plus an explicit count of files with NO
 *      recorded application. A domain whose files come from more than one app is
 *      the multi-tenancy hazard: deleting it on one app's say-so would remove
 *      data another app legitimately holds.
 *
 *      Do NOT be tempted back to `files.links[].app` for this. An earlier
 *      version of this script grouped on it and reported a reassuring "0 domains
 *      with more than one app" — but `links[]` is empty on every federated file,
 *      so that check could not tell "exactly one app" from "no attribution
 *      recorded at all" and would have printed the same zero either way.
 *      `serviceAppId` is what the federated upload path actually writes, and the
 *      unattributed count is reported rather than folded away.
 *   4. Reports the two footprints that CANNOT be attributed to a domain from
 *      Oxy's data at all: the evictable federation media cache namespace, and
 *      link previews (which carry a URL but no user).
 *
 * Safety: read-only by construction. It issues only `aggregate`, `countDocuments`
 * and `distinct`. It opens no write path, takes no confirmation flag, and has no
 * branch that mutates — there is nothing to put behind a DRY_RUN, because every
 * path is a dry one.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/census-federated-domains.ts
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   NODE_ENV      selects the DB name via getDbName() (e.g. oxy-prod)
 *   TOP_DOMAINS   how many domains to print in the per-domain table (default 40).
 *                 The machine-readable CENSUS_JSON line always carries ALL of
 *                 them, so this only bounds human-readable output.
 */

import mongoose from 'mongoose';
import { getDbName } from '../src/config/db';
import { logger } from '../src/utils/logger';

const COMPONENT = 'census-federated-domains';

/** Synthetic owner of the evictable remote-media cache. Not a real user. */
const FEDERATION_CACHE_OWNER_ID = '__federation_media_cache__';
/** Synthetic owner used for federation avatars fetched before a user existed. */
const FEDERATION_AVATAR_OWNER_ID = '__federation__';

/** Bucket for files with no recorded uploading application. */
const UNATTRIBUTED = '<none>';

interface DomainCensus {
  domain: string;
  users: number;
  usersArchived: number;
  files: number;
  fileBytes: number;
  fileAvatars: number;
  fileMedia: number;
  /** Edges where a remote actor of this domain follows someone. */
  followsOutbound: number;
  /** Edges where someone follows a remote actor of this domain. */
  followsInbound: number;
  /** Of {@link followsInbound}, how many followers are LOCAL Oxy users. */
  followsInboundFromLocal: number;
  blocks: number;
  restricts: number;
  notifications: number;
  /** Distinct `files.metadata.serviceAppId` values across this domain's files. */
  serviceAppIds: string[];
  /** Files with NO recorded uploading application — counted, never folded away. */
  filesUnattributed: number;
}

interface UnattributableCensus {
  cacheFiles: number;
  cacheBytes: number;
  orphanAvatarFiles: number;
  orphanAvatarBytes: number;
  linkPreviews: number;
}

function db(): mongoose.mongo.Db {
  const handle = mongoose.connection.db;
  if (!handle) {
    throw new Error('No database handle after connect');
  }
  return handle;
}

/**
 * Every federated domain with at least one user row, plus that domain's user
 * counts. Domains come straight from `federation.domain`, which the resolve
 * paths already store trimmed and lowercased.
 */
async function censusDomains(): Promise<Map<string, DomainCensus>> {
  const rows = await db()
    .collection('users')
    .aggregate<{ _id: string; users: number; usersArchived: number }>(
      [
        { $match: { type: 'federated', 'federation.domain': { $type: 'string' } } },
        {
          $group: {
            _id: '$federation.domain',
            users: { $sum: 1 },
            usersArchived: {
              $sum: { $cond: [{ $eq: ['$accountStatus', 'archived'] }, 1, 0] },
            },
          },
        },
        { $sort: { users: -1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  const census = new Map<string, DomainCensus>();
  for (const row of rows) {
    census.set(row._id, {
      domain: row._id,
      users: row.users,
      usersArchived: row.usersArchived,
      files: 0,
      fileBytes: 0,
      fileAvatars: 0,
      fileMedia: 0,
      followsOutbound: 0,
      followsInbound: 0,
      followsInboundFromLocal: 0,
      blocks: 0,
      restricts: 0,
      notifications: 0,
      serviceAppIds: [],
      filesUnattributed: 0,
    });
  }
  return census;
}

/**
 * `_id` → domain for every federated user, as strings. `files.ownerUserId` is a
 * STRING column while the social-graph collections hold ObjectIds, so both
 * shapes are needed; building the map once avoids a per-domain query fan-out
 * across what is a small collection (federated actors, not all users).
 */
async function loadFederatedUserIds(): Promise<Map<string, string>> {
  const cursor = db()
    .collection('users')
    .find(
      { type: 'federated', 'federation.domain': { $type: 'string' } },
      { projection: { _id: 1, 'federation.domain': 1 } },
    );

  const byId = new Map<string, string>();
  for await (const doc of cursor) {
    const domain = (doc as { federation?: { domain?: string } }).federation?.domain;
    if (typeof domain === 'string' && domain.length > 0) {
      byId.set(String(doc._id), domain);
    }
  }
  return byId;
}

/** Files owned by federated users, grouped by owner, folded into the census. */
async function censusFiles(
  census: Map<string, DomainCensus>,
  userDomains: Map<string, string>,
): Promise<void> {
  const ownerIds = [...userDomains.keys()];
  const appsByDomain = new Map<string, Set<string>>();

  // `$ifNull` folds a missing `serviceAppId` into an explicit sentinel rather
  // than dropping the row, so unattributed files are counted, not invisible.
  const rows = await db()
    .collection('files')
    .aggregate<{
      _id: { owner: string; appId: string };
      files: number;
      bytes: number;
      avatars: number;
      media: number;
    }>(
      [
        { $match: { ownerUserId: { $in: ownerIds } } },
        {
          $group: {
            _id: {
              owner: '$ownerUserId',
              appId: { $ifNull: ['$metadata.serviceAppId', UNATTRIBUTED] },
            },
            files: { $sum: 1 },
            bytes: { $sum: { $ifNull: ['$size', 0] } },
            avatars: {
              $sum: { $cond: [{ $eq: ['$metadata.role', 'avatar'] }, 1, 0] },
            },
            media: {
              $sum: { $cond: [{ $ne: ['$metadata.role', 'avatar'] }, 1, 0] },
            },
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  let grouped = 0;
  for (const row of rows) {
    const domain = userDomains.get(row._id.owner);
    if (domain === undefined) continue;
    const entry = census.get(domain);
    if (entry === undefined) continue;

    entry.files += row.files;
    entry.fileBytes += row.bytes;
    entry.fileAvatars += row.avatars;
    entry.fileMedia += row.media;
    grouped += row.files;

    if (row._id.appId === UNATTRIBUTED) {
      entry.filesUnattributed += row.files;
    } else {
      let apps = appsByDomain.get(domain);
      if (apps === undefined) {
        apps = new Set<string>();
        appsByDomain.set(domain, apps);
      }
      apps.add(row._id.appId);
    }
  }

  for (const [domain, apps] of appsByDomain) {
    const entry = census.get(domain);
    if (entry !== undefined) entry.serviceAppIds = [...apps].sort();
  }

  // Vacuity floor: if the grouped total disagrees with a direct count, the
  // `$in` silently dropped owners and every per-domain number is understated.
  const direct = await db()
    .collection('files')
    .countDocuments({ ownerUserId: { $in: ownerIds } });
  if (direct !== grouped) {
    throw new Error(
      `file census is inconsistent: direct count ${direct} vs grouped ${grouped} — numbers cannot be trusted`,
    );
  }
}

/**
 * Social-graph rows keyed to federated user ids. Counted by grouping on the
 * federated side of each edge so one pass covers every domain.
 */
async function censusGraph(
  census: Map<string, DomainCensus>,
  userDomains: Map<string, string>,
): Promise<void> {
  const objectIds = [...userDomains.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const localUserIds = new Set(
    (
      await db()
        .collection('users')
        .distinct('_id', { type: { $ne: 'federated' } })
    ).map((id) => String(id)),
  );

  const fold = (
    rows: Array<{ _id: unknown; count: number }>,
    apply: (entry: DomainCensus, count: number) => void,
  ): void => {
    for (const row of rows) {
      const domain = userDomains.get(String(row._id));
      if (domain === undefined) continue;
      const entry = census.get(domain);
      if (entry !== undefined) apply(entry, row.count);
    }
  };

  fold(
    await db()
      .collection('follows')
      .aggregate<{ _id: unknown; count: number }>(
        [
          { $match: { followerUserId: { $in: objectIds } } },
          { $group: { _id: '$followerUserId', count: { $sum: 1 } } },
        ],
        { allowDiskUse: true },
      )
      .toArray(),
    (entry, count) => {
      entry.followsOutbound += count;
    },
  );

  // Inbound edges are split by whether the FOLLOWER is a local Oxy user, because
  // "a real person here follows this actor" is the signal that a purge would be
  // user-visible rather than merely janitorial.
  const inbound = await db()
    .collection('follows')
    .aggregate<{ _id: unknown; followers: unknown[] }>(
      [
        { $match: { followedId: { $in: objectIds } } },
        { $group: { _id: '$followedId', followers: { $push: '$followerUserId' } } },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  for (const row of inbound) {
    const domain = userDomains.get(String(row._id));
    if (domain === undefined) continue;
    const entry = census.get(domain);
    if (entry === undefined) continue;
    entry.followsInbound += row.followers.length;
    for (const follower of row.followers) {
      if (localUserIds.has(String(follower))) entry.followsInboundFromLocal += 1;
    }
  }

  for (const [collection, field, apply] of [
    ['blocks', 'blockedId', (e: DomainCensus, c: number) => { e.blocks += c; }],
    ['blocks', 'userId', (e: DomainCensus, c: number) => { e.blocks += c; }],
    ['restricteds', 'restrictedId', (e: DomainCensus, c: number) => { e.restricts += c; }],
    ['restricteds', 'userId', (e: DomainCensus, c: number) => { e.restricts += c; }],
    ['notifications', 'actorId', (e: DomainCensus, c: number) => { e.notifications += c; }],
    ['notifications', 'recipientId', (e: DomainCensus, c: number) => { e.notifications += c; }],
  ] as const) {
    fold(
      await db()
        .collection(collection)
        .aggregate<{ _id: unknown; count: number }>(
          [
            { $match: { [field]: { $in: objectIds } } },
            { $group: { _id: `$${field}`, count: { $sum: 1 } } },
          ],
          { allowDiskUse: true },
        )
        .toArray(),
      apply,
    );
  }
}

/** The footprints Oxy cannot attribute to any domain. */
async function censusUnattributable(): Promise<UnattributableCensus> {
  const sumBytes = async (filter: Record<string, unknown>): Promise<{ n: number; bytes: number }> => {
    const [row] = await db()
      .collection('files')
      .aggregate<{ n: number; bytes: number }>([
        { $match: filter },
        { $group: { _id: null, n: { $sum: 1 }, bytes: { $sum: { $ifNull: ['$size', 0] } } } },
      ])
      .toArray();
    return row ?? { n: 0, bytes: 0 };
  };

  const cache = await sumBytes({ ownerUserId: FEDERATION_CACHE_OWNER_ID });
  const orphanAvatars = await sumBytes({ ownerUserId: FEDERATION_AVATAR_OWNER_ID });
  const linkPreviews = await db().collection('linkpreviews').countDocuments({});

  return {
    cacheFiles: cache.n,
    cacheBytes: cache.bytes,
    orphanAvatarFiles: orphanAvatars.n,
    orphanAvatarBytes: orphanAvatars.bytes,
    linkPreviews,
  };
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function run(): Promise<void> {
  const census = await censusDomains();
  const userDomains = await loadFederatedUserIds();

  logger.info('Federated user census loaded', {
    component: COMPONENT,
    domains: census.size,
    federatedUsers: userDomains.size,
  });

  await censusFiles(census, userDomains);
  await censusGraph(census, userDomains);
  const unattributable = await censusUnattributable();

  const all = [...census.values()].sort((a, b) => b.users - a.users);
  const totals = all.reduce(
    (acc, d) => ({
      users: acc.users + d.users,
      files: acc.files + d.files,
      fileBytes: acc.fileBytes + d.fileBytes,
      followsOutbound: acc.followsOutbound + d.followsOutbound,
      followsInbound: acc.followsInbound + d.followsInbound,
      followsInboundFromLocal: acc.followsInboundFromLocal + d.followsInboundFromLocal,
      blocks: acc.blocks + d.blocks,
      restricts: acc.restricts + d.restricts,
      notifications: acc.notifications + d.notifications,
    }),
    {
      users: 0,
      files: 0,
      fileBytes: 0,
      followsOutbound: 0,
      followsInbound: 0,
      followsInboundFromLocal: 0,
      blocks: 0,
      restricts: 0,
      notifications: 0,
    },
  );

  const multiApp = all.filter((d) => d.serviceAppIds.length > 1);
  const topN = Number.parseInt(process.env.TOP_DOMAINS ?? '40', 10);

  /* eslint-disable no-console */
  console.log('');
  console.log('=== Oxy federated footprint census (READ-ONLY) ===');
  console.log(`domains=${all.length} federatedUsers=${totals.users}`);
  console.log(
    `files=${totals.files} (${mib(totals.fileBytes)}) ` +
      `follows(out/in/inFromLocal)=${totals.followsOutbound}/${totals.followsInbound}/${totals.followsInboundFromLocal} ` +
      `blocks=${totals.blocks} restricts=${totals.restricts} notifications=${totals.notifications}`,
  );
  console.log(
    `unattributable: mediaCache=${unattributable.cacheFiles} (${mib(unattributable.cacheBytes)}) ` +
      `orphanAvatars=${unattributable.orphanAvatarFiles} (${mib(unattributable.orphanAvatarBytes)}) ` +
      `linkPreviews=${unattributable.linkPreviews}`,
  );
  console.log(`domains whose files come from >1 application: ${multiApp.length}`);
  for (const d of multiApp.slice(0, 20)) {
    console.log(`  MULTI_APP ${d.domain} apps=${d.serviceAppIds.join(',')} files=${d.files}`);
  }
  console.log('');
  console.log(`--- top ${Math.min(topN, all.length)} domains by user count ---`);
  for (const d of all.slice(0, topN)) {
    console.log(
      `${d.domain}\tusers=${d.users}(arch:${d.usersArchived})\tfiles=${d.files}(${mib(d.fileBytes)})\t` +
        `follow out/in/local=${d.followsOutbound}/${d.followsInbound}/${d.followsInboundFromLocal}\t` +
        `notif=${d.notifications}\tapps=${d.serviceAppIds.join(',') || '-'}\tunattributedFiles=${d.filesUnattributed}`,
    );
  }
  console.log('');
  console.log('=== stored federation.domain shapes ===');
  for (const [label, pattern] of [
    ['wwwPrefixed', '^www\\.'],
    ['uppercase', '[A-Z]'],
    ['trailingDot', '\\.$'],
  ] as const) {
    // The resolve paths store `federation.domain` trimmed+lowercased but do NOT
    // strip `www.`, while the blocklist engine compares canonical hosts with
    // `www.` stripped. A stored `www.x` therefore never matches a blocked `x` on
    // a naive equality query — so the purge's candidate query must cover both
    // spellings, and these counts are the evidence for which shapes exist.
    const hits = await db()
      .collection('users')
      .distinct('federation.domain', {
        type: 'federated',
        'federation.domain': { $regex: pattern },
      });
    console.log(`DOMAIN_SHAPE ${label}=${hits.length} sample=${hits.slice(0, 10).join(',')}`);
  }

  console.log('');
  console.log('CENSUS_JSON=' + JSON.stringify({ totals, unattributable, domains: all }));
  /* eslint-enable no-console */
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required', new Error('MONGODB_URI is required'), {
      component: COMPONENT,
      method: 'main',
    });
    process.exit(1);
  }

  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  logger.info('Connected to MongoDB', { component: COMPONENT, dbName });

  try {
    await run();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed', { component: COMPONENT });
  }
}

main().catch((error) => {
  logger.error(
    'census-federated-domains failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: COMPONENT, method: 'main' },
  );
  process.exit(1);
});
