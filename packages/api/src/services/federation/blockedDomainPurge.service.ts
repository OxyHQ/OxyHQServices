/**
 * Blocked-domain purge — the Oxy-platform half of "block an instance".
 *
 * When an app blocks a fediverse instance it stops federating with it and
 * deletes what it mirrored. But an ingested actor also leaves a trail on the Oxy
 * PLATFORM: a `type:'federated'` user row (minted by `PUT /users/resolve` or by
 * `federationService.resolveAndUpsert`), the avatar Oxy downloaded for it, and
 * the post media the app mirrored into Oxy storage. None of that is reachable
 * from the app's own database, so blocking used to leave it behind forever.
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is NOT a blocklist, and Oxy must never grow one. The set of blocked domains
 * is a MODERATION POLICY, and it belongs to the app that federates — committed,
 * reviewed and published there. Oxy is a multi-tenant platform underneath
 * several apps; a blocklist stored here would either be a stale replica of that
 * policy (two copies that disagree exactly when it matters, which is the moment
 * something irreversible fires) or, worse, would make one app's moderation
 * decisions binding on every other app. So this module accepts a domain from an
 * authenticated caller and reports or removes what Oxy holds for it. It never
 * decides WHETHER a domain is blocked, and it has no state that can be wrong:
 * the only way for the two sides to be out of step is work not yet done, which
 * a retry fixes. That is why every operation here is idempotent and resumable
 * rather than transactional.
 *
 * WHOSE DATA GETS DELETED
 * -----------------------
 * An Oxy federated user row is shared platform state. It is keyed on the
 * globally-unique `federation.actorUri`, so if two apps ever ingest the same
 * remote actor they get the SAME row — and deleting it because one app blocked
 * the instance would destroy data the other app legitimately holds.
 *
 * Today exactly one app federates, and federated rows were measured to carry no
 * sessions, reputation, wallets, grants or app data — so deleting the row is in
 * fact safe right now. That is a fact about the current DEPLOYMENT, not about
 * the data model, and it stops being true silently the day a second app
 * federates. So the rule is evaluated per actor from what is actually there:
 *
 *   - Files are deleted only when their `metadata.serviceAppId` is the
 *     AUTHENTICATED caller's application id (resolved from the service
 *     credential — never a value the caller supplies), plus the actor's own
 *     Oxy-fetched avatars, which belong to the row rather than to any app.
 *   - The row itself is deleted only when nothing ANOTHER app owns still
 *     references it. If something does, the row is archived and RETAINED, and
 *     the result names the app that caused the retention.
 *
 * The retention branch is unreachable in the current deployment. It is here
 * deliberately, because it is the thing that stops this from quietly becoming
 * "one app deletes another app's data" later, and it costs one query the plan
 * already needs.
 *
 * MATCHING
 * --------
 * A purge must match EXACTLY the hosts the federation engine refuses — never
 * more. Over-matching deletes content for a domain that was never blocked, and
 * that is irreversible. So host comparison goes through
 * {@link canonicalFederationHost} / {@link isSameFederationHost} from
 * `@oxyhq/federation` — the same functions `createDomainPolicy` is built from,
 * not a local copy that agrees today. Consequences, all deliberate:
 *
 *   - `www.` is stripped on both sides. Oxy's resolve paths store
 *     `federation.domain` lowercased but do NOT strip `www.`, so stored
 *     `www.example.com` rows exist and a naive equality query would miss them.
 *   - Subdomains do NOT match. `isBlockedDomain` is exact canonical-host set
 *     membership, so `sub.example.com` is untouched when `example.com` is
 *     blocked — the engine still federates with it.
 *   - A trailing dot does not match, matching the engine.
 *
 * The candidate query is an indexed `$in` over the two spellings that can
 * canonicalise to the target, and then EVERY candidate is re-verified with
 * `isSameFederationHost` before it is touched. A row that fails re-verification
 * is skipped and counted. So a query that somehow widens can only ever
 * under-delete — recoverable — and never over-delete.
 */

import mongoose from 'mongoose';
import { canonicalFederationHost, isSameFederationHost } from '@oxyhq/federation';
import { File } from '../../models/File';
import Follow from '../../models/Follow';
import User from '../../models/User';
import { logger } from '../../utils/logger';
import { assetService } from '../assetServiceSingleton';
import { isOwnFederationDomain } from '../federation.service';
import { userService } from '../user.service';

const COMPONENT = 'blockedDomainPurge';

/**
 * Default number of actors processed per call. Each actor costs a small number
 * of queries plus one S3 delete per file, so an unbounded run would hold a
 * request (or an ECS task) open for an arbitrary time on a large instance.
 * Callers loop until {@link BlockedDomainPurgeResult.done} is true, passing
 * {@link BlockedDomainPurgeResult.nextCursor} as `afterId` on each subsequent
 * call. Do NOT loop on {@link BlockedDomainPurgeResult.remaining} — retained
 * rows keep matching forever.
 */
export const DEFAULT_PURGE_LIMIT = 200;

/** Hard ceiling on `limit`, so a caller cannot ask for an unbounded run. */
export const MAX_PURGE_LIMIT = 1000;

export interface BlockedDomainPurgeOptions {
  /** Domain as the caller spells it; canonicalised before anything is read. */
  domain: string;
  /**
   * The application id resolved from the caller's service credential. NEVER a
   * client-supplied value — it decides whose files may be deleted.
   */
  callerAppId: string;
  /** When true (the default) compute the plan and apply nothing. */
  dryRun: boolean;
  /** Max actors to process this call. Clamped to {@link MAX_PURGE_LIMIT}. */
  limit: number;
  /**
   * Continuation cursor: process only actors whose `_id` sorts after this one.
   * Echo {@link BlockedDomainPurgeResult.nextCursor} back to continue.
   *
   * Progress CANNOT be left to "deleted rows stop matching", because retained
   * rows (shared with another application) and dry runs both leave every row in
   * place. Either would re-fetch the same head of the batch on every call and
   * never advance — a livelock, and on a dry run the caller would loop forever
   * over the first `limit` actors while believing it was making progress. An
   * `_id` cursor advances monotonically whatever each actor's outcome is.
   */
  afterId?: string;
}

/** Why a federated user row survived a purge that reached it. */
export interface RetainedActor {
  oxyUserId: string;
  username: string;
  /** Application ids, other than the caller, still holding files for this row. */
  referencedByAppIds: string[];
}

export interface BlockedDomainPurgeResult {
  /** The domain exactly as the caller sent it. */
  requestedDomain: string;
  /** The canonical host it was compared as. */
  canonicalDomain: string;
  dryRun: boolean;
  /** Federated user rows matched (before the batch limit). */
  actorsMatched: number;
  /** Actors this call processed. */
  actorsProcessed: number;
  /** Actors whose user row was (or would be) hard-deleted. */
  actorsDeleted: number;
  /** Actors archived and kept because another app still holds their data. */
  actorsRetained: RetainedActor[];
  /** Files owned by the caller's application that were (or would be) deleted. */
  filesDeleted: number;
  /** Bytes those files occupied. */
  bytesDeleted: number;
  /** Avatars Oxy fetched itself, deleted alongside a deleted row. */
  avatarsDeleted: number;
  /** Follow-graph edges removed by the actor teardown. */
  followEdgesRemoved: number;
  /**
   * Inbound follows from LOCAL Oxy users among the processed actors. A non-zero
   * value means the purge is user-visible: a real person loses a follow.
   */
  localFollowersAffected: number;
  /**
   * Candidates fetched by the indexed query that FAILED `isSameFederationHost`
   * re-verification and were skipped. Should be 0; a non-zero value means the
   * candidate query is wider than the canonical rule and wants investigating.
   */
  candidatesRejected: number;
  /**
   * Actors still matching the domain after this call. Reported for visibility,
   * NOT as the loop condition — retained rows keep matching forever, so a
   * caller that looped on `remaining > 0` would never stop.
   */
  remaining: number;
  /**
   * Pass as `afterId` on the next call. `null` when the scan reached the end.
   */
  nextCursor: string | null;
  /** True when this pass reached the end of the scan. THE loop condition. */
  done: boolean;
}

/** Raised when the requested domain must never be purged. */
export class UnpurgeableDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnpurgeableDomainError';
  }
}

/**
 * The two stored spellings that can canonicalise to `canonical`.
 *
 * `canonicalFederationHost` only trims, lowercases and strips a leading `www.`,
 * and stored `federation.domain` values are already written trimmed+lowercased,
 * so `{canonical, 'www.'+canonical}` is exhaustive. Both are exact values
 * against the sparse `federation.domain` index — no regex, no collection scan.
 * If a stored value ever escaped that normalisation the query would MISS it
 * (an under-delete, the safe direction) rather than over-reach.
 */
function candidateDomainSpellings(canonical: string): string[] {
  return [canonical, `www.${canonical}`];
}

interface ActorRow {
  _id: unknown;
  username?: string;
  federation?: { domain?: string };
}

/**
 * Files belonging to a federated actor, split by who owns them.
 *
 * `callerOwned` are the caller application's uploads — the only files this
 * purge may delete on that application's authority. `unattributed` are the
 * avatars Oxy downloaded itself (`source:'federation'`, no `serviceAppId`);
 * they belong to the user row, so they go only when the row itself goes.
 * `otherAppIds` is what makes the row shared: any other application id found
 * here blocks deletion of the row.
 */
async function classifyActorFiles(
  oxyUserId: string,
  callerAppId: string,
): Promise<{
  callerOwned: Array<{ id: string; size: number }>;
  unattributed: Array<{ id: string; size: number }>;
  otherAppIds: string[];
}> {
  const files = await File.find({ ownerUserId: oxyUserId })
    .select('_id size metadata')
    .lean();

  const callerOwned: Array<{ id: string; size: number }> = [];
  const unattributed: Array<{ id: string; size: number }> = [];
  const otherAppIds = new Set<string>();

  for (const file of files) {
    const metadata = (file.metadata ?? {}) as Record<string, unknown>;
    const serviceAppId = metadata.serviceAppId;
    const entry = { id: String(file._id), size: typeof file.size === 'number' ? file.size : 0 };

    if (typeof serviceAppId === 'string' && serviceAppId.length > 0) {
      if (serviceAppId === callerAppId) {
        callerOwned.push(entry);
      } else {
        otherAppIds.add(serviceAppId);
      }
      continue;
    }

    // No owning application, so no app can claim it and no app is blocked by
    // it. Oxy's own federation avatar fetch (`source:'federation'`, no
    // `serviceAppId`) is the case that actually occurs; anything else
    // unattributed is treated identically, because a file nobody claims is
    // still tied to the row and must not outlive it as an orphan.
    unattributed.push(entry);
  }

  return { callerOwned, unattributed, otherAppIds: [...otherAppIds].sort() };
}

/**
 * Delete one file through the asset service so S3 objects, variants and the
 * backfilled public copy all go with it. `force` is required because federation
 * media may carry link rows; the row is being removed regardless.
 *
 * A single file failing must not abandon the rest of the purge — the run is
 * resumable, so the right behaviour is to log the specific file and carry on,
 * leaving it to be retried on the next pass. Returns whether it succeeded so
 * the caller only counts real deletions.
 */
async function deleteFileBestEffort(fileId: string, context: Record<string, unknown>): Promise<boolean> {
  try {
    await assetService.deleteFile(fileId, true);
    return true;
  } catch (error) {
    logger.warn('blockedDomainPurge: file delete failed, will retry on next pass', {
      component: COMPONENT,
      fileId,
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Plan and (unless `dryRun`) apply a blocked-domain purge for ONE domain.
 *
 * The plan is computed identically on both paths — `dryRun` gates only whether
 * it is applied — so the numbers an operator approves are the numbers that
 * execute.
 */
export async function purgeBlockedDomain(
  options: BlockedDomainPurgeOptions,
): Promise<BlockedDomainPurgeResult> {
  const { domain, callerAppId, dryRun } = options;
  const limit = Math.min(Math.max(1, options.limit), MAX_PURGE_LIMIT);

  const canonicalDomain = canonicalFederationHost(domain);
  if (canonicalDomain.length === 0) {
    throw new UnpurgeableDomainError('domain is empty after canonicalisation');
  }

  // A blank or absent caller id would make `serviceAppId === callerAppId` match
  // nothing, so the purge would silently delete no files while still deleting
  // rows. Refuse rather than run a half-purge.
  if (callerAppId.length === 0) {
    throw new UnpurgeableDomainError('caller application id is required');
  }

  // HARD GUARD: our own apex is a federation domain to the rest of the network,
  // but its handles denote LOCAL users. Purging it would tear down real
  // accounts' graphs. Refuse before reading anything.
  if (isOwnFederationDomain(canonicalDomain)) {
    throw new UnpurgeableDomainError(
      `${canonicalDomain} is an own federation domain and can never be purged`,
    );
  }

  const spellings = candidateDomainSpellings(canonicalDomain);
  const matchFilter = {
    type: 'federated' as const,
    'federation.domain': { $in: spellings },
  };

  const actorsMatched = await User.countDocuments(matchFilter);
  // Scan in `_id` order from the cursor. The sort is what makes `afterId` a
  // total order rather than an arbitrary one, so a resumed pass cannot skip or
  // repeat an actor.
  const scanFilter =
    options.afterId === undefined
      ? matchFilter
      : { ...matchFilter, _id: { $gt: new mongoose.Types.ObjectId(options.afterId) } };
  const candidates = (await User.find(scanFilter)
    .select('_id username federation.domain')
    .sort({ _id: 1 })
    .limit(limit)
    .lean()) as unknown as ActorRow[];

  const result: BlockedDomainPurgeResult = {
    requestedDomain: domain,
    canonicalDomain,
    dryRun,
    actorsMatched,
    actorsProcessed: 0,
    actorsDeleted: 0,
    actorsRetained: [],
    filesDeleted: 0,
    bytesDeleted: 0,
    avatarsDeleted: 0,
    followEdgesRemoved: 0,
    localFollowersAffected: 0,
    candidatesRejected: 0,
    remaining: 0,
    // The scan reached the end when it came back short of a full batch. This is
    // the ONLY loop condition: it holds identically for a dry run, for retained
    // rows and for deletions, none of which it depends on.
    nextCursor: candidates.length > 0 ? String(candidates[candidates.length - 1]._id) : null,
    done: candidates.length < limit,
  };

  for (const candidate of candidates) {
    const storedDomain = candidate.federation?.domain;
    // RE-VERIFY against the shared canonical rule. The query above is an
    // optimisation; THIS is the authority on whether the row belongs to the
    // domain we were asked to purge.
    if (typeof storedDomain !== 'string' || !isSameFederationHost(storedDomain, canonicalDomain)) {
      result.candidatesRejected += 1;
      logger.warn('blockedDomainPurge: candidate rejected by canonical re-verification', {
        component: COMPONENT,
        oxyUserId: String(candidate._id),
        storedDomain,
        canonicalDomain,
      });
      continue;
    }

    const oxyUserId = String(candidate._id);
    const username = typeof candidate.username === 'string' ? candidate.username : '';
    result.actorsProcessed += 1;

    const { callerOwned, unattributed, otherAppIds } = await classifyActorFiles(
      oxyUserId,
      callerAppId,
    );

    result.localFollowersAffected += await countLocalFollowers(oxyUserId);

    // The row is shared with another application: delete only what the caller
    // owns, archive the row, and report who kept it alive.
    const retainRow = otherAppIds.length > 0;

    for (const file of callerOwned) {
      if (dryRun || (await deleteFileBestEffort(file.id, { oxyUserId, canonicalDomain }))) {
        result.filesDeleted += 1;
        result.bytesDeleted += file.size;
      }
    }

    if (retainRow) {
      if (!dryRun) {
        // Same semantics as `POST /federation/actor-gone`: single whitelisted
        // field, with `type:'federated'` re-asserted in the filter so a
        // concurrent type change can never let this touch a real account.
        await User.updateOne(
          { _id: oxyUserId, type: 'federated' },
          { $set: { accountStatus: 'archived' } },
        );
      }
      result.actorsRetained.push({ oxyUserId, username, referencedByAppIds: otherAppIds });
      logger.info('blockedDomainPurge: actor retained, referenced by another application', {
        component: COMPONENT,
        oxyUserId,
        canonicalDomain,
        referencedByAppIds: otherAppIds,
        dryRun,
      });
      continue;
    }

    // Nothing else holds this row: the platform-level avatars go too, then the
    // row and its whole social graph.
    for (const file of unattributed) {
      if (dryRun || (await deleteFileBestEffort(file.id, { oxyUserId, canonicalDomain }))) {
        result.avatarsDeleted += 1;
        result.bytesDeleted += file.size;
      }
    }

    if (dryRun) {
      result.actorsDeleted += 1;
      continue;
    }

    // Reuses the shared teardown so edge deletion, counterparty `_count` repair
    // and block/restrict/graph cache invalidation stay in ONE place. Its caller
    // contract requires `type:'federated'`, which the query filter and the
    // re-verification above both established, and which its own terminal
    // `deleteOne` filter re-asserts atomically.
    const { followEdgesRemoved } = await userService.deleteFederatedActor(oxyUserId);
    result.followEdgesRemoved += followEdgesRemoved;
    result.actorsDeleted += 1;

    logger.info('blockedDomainPurge: federated actor purged', {
      component: COMPONENT,
      oxyUserId,
      username,
      canonicalDomain,
      followEdgesRemoved,
    });
  }

  // Re-counted rather than derived by arithmetic, so it reflects concurrent
  // ingest (which is live — the corpus grows while a purge runs). Purely
  // informational: `done` is the cursor's business, not this number's.
  result.remaining = await User.countDocuments(matchFilter);

  logger.info('blockedDomainPurge: pass complete', {
    component: COMPONENT,
    canonicalDomain,
    dryRun,
    callerAppId,
    actorsMatched: result.actorsMatched,
    actorsProcessed: result.actorsProcessed,
    actorsDeleted: result.actorsDeleted,
    actorsRetained: result.actorsRetained.length,
    filesDeleted: result.filesDeleted,
    bytesDeleted: result.bytesDeleted,
    localFollowersAffected: result.localFollowersAffected,
    candidatesRejected: result.candidatesRejected,
    remaining: result.remaining,
    done: result.done,
  });

  return result;
}

/**
 * Inbound follows from LOCAL (non-federated) users. Reported so an operator can
 * see, before executing, that a purge will remove real people's follows.
 */
async function countLocalFollowers(oxyUserId: string): Promise<number> {
  const followerIds = await Follow.distinct('followerUserId', { followedId: oxyUserId });
  if (followerIds.length === 0) return 0;
  return User.countDocuments({ _id: { $in: followerIds }, type: { $ne: 'federated' } });
}
