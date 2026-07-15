/**
 * Publish/admin operations for Oxy Updates: content-addressed asset upload
 * (init/complete), creating updates (channel-on-demand), and the lifecycle
 * operations (rollback, rollback-to-embedded, promote, rollout patch) plus the
 * read models the CLI and console consume.
 *
 * Asset upload mirrors the two-step presigned pattern in `routes/assets.ts`:
 * `initAssets` returns a presigned PUT for every asset not already held (dedup
 * by SHA-256), `completeAssets` HEADs each object and flips it to `uploaded`.
 * Only `uploaded` assets may back a published update.
 */

import mongoose from 'mongoose';
import type {
  AssetInitItem,
  AssetInitResponse,
  AssetCompleteResponse,
  CreateUpdateRequest,
  UpdatePlatform,
} from '@oxyhq/contracts';
import { s3Service } from '../assetServiceSingleton';
import { AppUpdate, type IAppUpdate } from '../../models/AppUpdate';
import { UpdateAsset } from '../../models/UpdateAsset';
import { UpdateChannel, type IUpdateChannel } from '../../models/UpdateChannel';
import { updateAssetS3Key } from './assetKeys';
import { BadRequestError, NotFoundError } from '../../utils/error';
import { logger } from '../../utils/logger';

/** Presigned PUT validity — generous enough for a large bundle upload. */
const ASSET_UPLOAD_URL_EXPIRY_SECONDS = 60 * 60; // 1h

/**
 * Cache-Control baked into every asset object. Update assets are content-addressed
 * (the URL contains the sha256), so the bytes at a URL never change — they can be
 * cached forever. This is a SIGNED header on the presigned PUT, so the client
 * replays it verbatim (see `assetUploadTicketSchema.cacheControl`).
 */
const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/* -------------------------------------------------------------------------- */
/*  Serializers (Mongoose doc → @oxyhq/contracts wire shape)                  */
/* -------------------------------------------------------------------------- */

export interface SerializedUpdate {
  id: string;
  applicationId: string;
  channel: string;
  runtimeVersion: string;
  platform: UpdatePlatform;
  status: string;
  rolloutPercent: number;
  launchAssetSha256: string;
  assetSha256s: string[];
  gitCommit?: string;
  gitBranch?: string;
  message?: string;
  promotedFromUpdateId?: string;
  createdAt: string;
  updatedAt: string;
}

function serializeUpdate(update: IAppUpdate, channelName: string): SerializedUpdate {
  return {
    id: update.updateId,
    applicationId: update.applicationId.toString(),
    channel: channelName,
    runtimeVersion: update.runtimeVersion,
    platform: update.platform,
    status: update.status,
    rolloutPercent: update.rolloutPercent,
    launchAssetSha256: update.launchAsset.sha256,
    assetSha256s: update.assets.map((asset) => asset.sha256),
    ...(update.gitCommit ? { gitCommit: update.gitCommit } : {}),
    ...(update.gitBranch ? { gitBranch: update.gitBranch } : {}),
    ...(update.message ? { message: update.message } : {}),
    ...(update.promotedFromUpdateId
      ? { promotedFromUpdateId: update.promotedFromUpdateId }
      : {}),
    createdAt: update.createdAt.toISOString(),
    updatedAt: update.updatedAt.toISOString(),
  };
}

export function serializeChannel(channel: IUpdateChannel) {
  return {
    id: channel._id.toString(),
    applicationId: channel.applicationId.toString(),
    name: channel.name,
    rollbacksToEmbedded: channel.rollbacksToEmbedded.map((entry) => ({
      runtimeVersion: entry.runtimeVersion,
      platform: entry.platform,
      commitTime: entry.commitTime.toISOString(),
    })),
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Assets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * For each declared asset, return a presigned PUT when we do not already hold the
 * content (`uploaded`), or list it as `existing`. A `pending` record is
 * (re)created for every missing asset so `completeAssets` can find it.
 */
export async function initAssets(
  applicationId: string,
  assets: AssetInitItem[]
): Promise<AssetInitResponse> {
  const missing: AssetInitResponse['missing'] = [];
  const existing: string[] = [];

  // Collapse duplicate sha256s in the request so we never presign the same key
  // twice or double-count.
  const bySha = new Map<string, AssetInitItem>();
  for (const asset of assets) {
    if (!bySha.has(asset.sha256)) {
      bySha.set(asset.sha256, asset);
    }
  }

  for (const asset of bySha.values()) {
    const found = await UpdateAsset.findOne({ sha256: asset.sha256 });
    if (found && found.status === 'uploaded') {
      existing.push(asset.sha256);
      continue;
    }

    const s3Key = updateAssetS3Key(asset.sha256);
    if (!found) {
      await UpdateAsset.create({
        sha256: asset.sha256,
        s3Key,
        contentType: asset.contentType,
        size: asset.size,
        status: 'pending',
      });
    } else {
      // Refresh the declared metadata on a re-init of a still-pending asset.
      found.contentType = asset.contentType;
      found.size = asset.size;
      await found.save();
    }

    const uploadUrl = await s3Service.getPresignedUploadUrl(s3Key, {
      contentType: asset.contentType,
      cacheControl: ASSET_CACHE_CONTROL,
      expiresIn: ASSET_UPLOAD_URL_EXPIRY_SECONDS,
    });
    missing.push({
      sha256: asset.sha256,
      uploadUrl,
      storageKey: s3Key,
      contentType: asset.contentType,
      cacheControl: ASSET_CACHE_CONTROL,
    });
  }

  logger.info('Oxy Updates assets init', {
    applicationId,
    requested: bySha.size,
    missing: missing.length,
    existing: existing.length,
  });

  return { missing, existing };
}

/**
 * Verify each claimed-complete asset actually exists in S3 (HEAD) and flip it to
 * `uploaded`, recording the object's true byte size. An object that is absent or
 * empty stays `pending` and is reported as such — the caller must re-PUT it
 * before the assets can back a published update.
 */
export async function completeAssets(
  applicationId: string,
  sha256s: string[]
): Promise<AssetCompleteResponse> {
  const results: AssetCompleteResponse['assets'] = [];
  const unique = Array.from(new Set(sha256s));

  for (const sha256 of unique) {
    const asset = await UpdateAsset.findOne({ sha256 });
    if (!asset) {
      throw new BadRequestError(`Asset ${sha256} was never initialised`);
    }

    if (asset.status === 'uploaded') {
      results.push({ sha256, status: 'uploaded', size: asset.size });
      continue;
    }

    const head = await s3Service.headObject(asset.s3Key);
    if (!head || head.size <= 0) {
      logger.warn('Oxy Updates asset complete: object missing or empty', {
        applicationId,
        sha256,
        s3Key: asset.s3Key,
      });
      results.push({ sha256, status: 'pending', size: 0 });
      continue;
    }

    asset.size = head.size;
    asset.status = 'uploaded';
    await asset.save();
    results.push({ sha256, status: 'uploaded', size: head.size });
  }

  return { assets: results };
}

/* -------------------------------------------------------------------------- */
/*  Channels                                                                   */
/* -------------------------------------------------------------------------- */

/** Find or create a channel by name for an application (CI-friendly for `pr-<n>`). */
async function ensureChannel(applicationId: string, name: string): Promise<IUpdateChannel> {
  const appId = new mongoose.Types.ObjectId(applicationId);
  const channel = await UpdateChannel.findOneAndUpdate(
    { applicationId: appId, name },
    { $setOnInsert: { applicationId: appId, name, rollbacksToEmbedded: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // findOneAndUpdate with upsert+new always returns a document.
  if (!channel) {
    throw new NotFoundError('Channel could not be resolved');
  }
  return channel;
}

/** Remove any active rollback-to-embedded entry for a runtime+platform (a fresh publish clears it). */
async function clearRollbackToEmbedded(
  channelId: mongoose.Types.ObjectId,
  runtimeVersion: string,
  platform: UpdatePlatform
): Promise<void> {
  await UpdateChannel.updateOne(
    { _id: channelId },
    { $pull: { rollbacksToEmbedded: { runtimeVersion, platform } } }
  );
}

/* -------------------------------------------------------------------------- */
/*  Create update                                                              */
/* -------------------------------------------------------------------------- */

/** Assert every referenced asset is present and `uploaded`; otherwise 400. */
async function assertAssetsUploaded(shas: string[]): Promise<void> {
  const unique = Array.from(new Set(shas));
  const uploaded = await UpdateAsset.find({
    sha256: { $in: unique },
    status: 'uploaded',
  }).select('sha256');
  const have = new Set(uploaded.map((asset) => asset.sha256));
  const notUploaded = unique.filter((sha) => !have.has(sha));
  if (notUploaded.length > 0) {
    throw new BadRequestError(
      `Cannot publish: ${notUploaded.length} asset(s) not uploaded (${notUploaded
        .slice(0, 3)
        .join(', ')}${notUploaded.length > 3 ? ', …' : ''})`
    );
  }
}

export async function createUpdate(
  input: CreateUpdateRequest
): Promise<SerializedUpdate> {
  const referenced = [input.launchAsset.sha256, ...input.assets.map((a) => a.sha256)];
  await assertAssetsUploaded(referenced);

  const channel = await ensureChannel(input.applicationId, input.channel);
  // A fresh publish supersedes any active rollback-to-embedded for this tuple.
  await clearRollbackToEmbedded(channel._id, input.runtimeVersion, input.platform);

  const update = await AppUpdate.create({
    applicationId: new mongoose.Types.ObjectId(input.applicationId),
    channelId: channel._id,
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    status: 'published',
    launchAsset: {
      sha256: input.launchAsset.sha256,
      key: input.launchAsset.key,
      contentType: input.launchAsset.contentType,
      fileExtension: input.launchAsset.fileExtension,
    },
    assets: input.assets.map((asset) => ({
      sha256: asset.sha256,
      key: asset.key,
      contentType: asset.contentType,
      fileExtension: asset.fileExtension,
    })),
    extra: input.extra,
    metadata: input.metadata ?? {},
    rolloutPercent: input.rolloutPercent ?? 100,
    gitCommit: input.gitCommit,
    gitBranch: input.gitBranch,
    message: input.message,
  });

  logger.info('Oxy Update published', {
    applicationId: input.applicationId,
    channel: input.channel,
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    updateId: update.updateId,
    rolloutPercent: update.rolloutPercent,
  });

  return serializeUpdate(update, channel.name);
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle: rollback / rollback-to-embedded / promote / rollout            */
/* -------------------------------------------------------------------------- */

async function resolveChannel(applicationId: string, name: string): Promise<IUpdateChannel> {
  const channel = await UpdateChannel.findOne({
    applicationId: new mongoose.Types.ObjectId(applicationId),
    name,
  });
  if (!channel) {
    throw new NotFoundError(`Channel '${name}' not found`);
  }
  return channel;
}

/** Find the current head (newest published) for a channel + runtime + platform. */
async function findHead(
  applicationId: string,
  channelId: mongoose.Types.ObjectId,
  runtimeVersion: string,
  platform: UpdatePlatform
): Promise<IAppUpdate | null> {
  return AppUpdate.findOne({
    applicationId: new mongoose.Types.ObjectId(applicationId),
    channelId,
    runtimeVersion,
    platform,
    status: 'published',
  }).sort({ createdAt: -1 });
}

/**
 * Mark the current head `rolled_back` so the previous published update becomes
 * head again. Nothing is deleted. Returns the rolled-back update and the new head.
 */
export async function rollback(
  applicationId: string,
  channelName: string,
  runtimeVersion: string,
  platform: UpdatePlatform
): Promise<{ rolledBack: SerializedUpdate; head: SerializedUpdate | null }> {
  const channel = await resolveChannel(applicationId, channelName);
  const head = await findHead(applicationId, channel._id, runtimeVersion, platform);
  if (!head) {
    throw new NotFoundError('No published update to roll back for this runtime/platform');
  }

  head.status = 'rolled_back';
  await head.save();

  const newHead = await findHead(applicationId, channel._id, runtimeVersion, platform);

  logger.info('Oxy Update rolled back', {
    applicationId,
    channel: channelName,
    runtimeVersion,
    platform,
    rolledBackUpdateId: head.updateId,
    newHeadUpdateId: newHead?.updateId ?? null,
  });

  return {
    rolledBack: serializeUpdate(head, channel.name),
    head: newHead ? serializeUpdate(newHead, channel.name) : null,
  };
}

/**
 * Record a `rollBackToEmbedded` directive for a runtime+platform so clients fall
 * back to the update embedded in their binary. Replaces any existing directive
 * for the same tuple; `commitTime` is set to now.
 */
export async function rollbackToEmbedded(
  applicationId: string,
  channelName: string,
  runtimeVersion: string,
  platform: UpdatePlatform
): Promise<ReturnType<typeof serializeChannel>> {
  const channel = await resolveChannel(applicationId, channelName);
  const commitTime = new Date();

  // Replace any existing directive for the tuple, then push the fresh one.
  await UpdateChannel.updateOne(
    { _id: channel._id },
    { $pull: { rollbacksToEmbedded: { runtimeVersion, platform } } }
  );
  const updated = await UpdateChannel.findOneAndUpdate(
    { _id: channel._id },
    { $push: { rollbacksToEmbedded: { runtimeVersion, platform, commitTime } } },
    { new: true }
  );
  if (!updated) {
    throw new NotFoundError('Channel disappeared during rollback-to-embedded');
  }

  logger.info('Oxy Update rollback-to-embedded set', {
    applicationId,
    channel: channelName,
    runtimeVersion,
    platform,
    commitTime: commitTime.toISOString(),
  });

  return serializeChannel(updated);
}

/**
 * Promote an existing update into a channel by creating a NEW update (new UUID)
 * pointing at the SAME assets. Creates the target channel on demand.
 */
export async function promote(
  applicationId: string,
  fromUpdateId: string,
  toChannelName: string,
  rolloutPercent?: number
): Promise<SerializedUpdate> {
  const source = await AppUpdate.findOne({
    applicationId: new mongoose.Types.ObjectId(applicationId),
    updateId: fromUpdateId,
  });
  if (!source) {
    throw new NotFoundError(`Update ${fromUpdateId} not found`);
  }

  const channel = await ensureChannel(applicationId, toChannelName);
  await clearRollbackToEmbedded(channel._id, source.runtimeVersion, source.platform);

  const promoted = await AppUpdate.create({
    applicationId: source.applicationId,
    channelId: channel._id,
    runtimeVersion: source.runtimeVersion,
    platform: source.platform,
    status: 'published',
    launchAsset: source.launchAsset,
    assets: source.assets,
    extra: source.extra,
    metadata: source.metadata,
    rolloutPercent: rolloutPercent ?? 100,
    gitCommit: source.gitCommit,
    gitBranch: source.gitBranch,
    message: source.message,
    promotedFromUpdateId: source.updateId,
  });

  logger.info('Oxy Update promoted', {
    applicationId,
    fromUpdateId,
    toChannel: toChannelName,
    newUpdateId: promoted.updateId,
    rolloutPercent: promoted.rolloutPercent,
  });

  return serializeUpdate(promoted, channel.name);
}

/** Adjust an update's rollout percentage in place. */
export async function setRollout(
  applicationId: string,
  updateId: string,
  rolloutPercent: number
): Promise<SerializedUpdate> {
  const update = await AppUpdate.findOne({
    applicationId: new mongoose.Types.ObjectId(applicationId),
    updateId,
  });
  if (!update) {
    throw new NotFoundError(`Update ${updateId} not found`);
  }
  update.rolloutPercent = rolloutPercent;
  await update.save();

  const channel = await UpdateChannel.findById(update.channelId).select('name');

  logger.info('Oxy Update rollout adjusted', { applicationId, updateId, rolloutPercent });

  return serializeUpdate(update, channel?.name ?? '');
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listChannels(applicationId: string) {
  const channels = await UpdateChannel.find({
    applicationId: new mongoose.Types.ObjectId(applicationId),
  }).sort({ name: 1 });
  return channels.map(serializeChannel);
}

export async function listUpdates(
  applicationId: string,
  channelName?: string,
  runtimeVersion?: string,
  platform?: UpdatePlatform,
  limit = 50
): Promise<SerializedUpdate[]> {
  const appId = new mongoose.Types.ObjectId(applicationId);

  let channelId: mongoose.Types.ObjectId | undefined;
  let resolvedChannelName = channelName ?? '';
  if (channelName) {
    const channel = await UpdateChannel.findOne({ applicationId: appId, name: channelName });
    if (!channel) {
      return [];
    }
    channelId = channel._id;
    resolvedChannelName = channel.name;
  }

  const query: Record<string, unknown> = { applicationId: appId };
  if (channelId) query.channelId = channelId;
  if (runtimeVersion) query.runtimeVersion = runtimeVersion;
  if (platform) query.platform = platform;

  const updates = await AppUpdate.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200));

  // When not filtered to one channel, resolve each update's channel name.
  const channelNames = new Map<string, string>();
  if (!channelId) {
    const ids = Array.from(new Set(updates.map((u) => u.channelId.toString())));
    const channels = await UpdateChannel.find({ _id: { $in: ids } }).select('name');
    for (const channel of channels) {
      channelNames.set(channel._id.toString(), channel.name);
    }
  }

  return updates.map((update) =>
    serializeUpdate(
      update,
      channelId ? resolvedChannelName : channelNames.get(update.channelId.toString()) ?? ''
    )
  );
}
