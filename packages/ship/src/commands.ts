import path from 'node:path';
import {
  stringFlag,
  requireString,
  rolloutFlag,
  platformsFlag,
  type ParsedArgs,
} from './args';
import {
  collectPlatformAssets,
  readExportMetadata,
  resolveRuntimeVersion,
  type PlatformBundle,
  type ShipAssetRef,
} from './metadata';
import { runExpoExport, readExpoPublicConfig } from './exec';
import { createShipClient } from './config';
import type { UpdatePlatform } from '@oxyhq/contracts';

type Flags = ParsedArgs['flags'];

/** De-duplicate the asset set across platforms (content-addressed by sha256). */
function uniqueAssets(bundles: PlatformBundle[]): Map<string, ShipAssetRef> {
  const bySha = new Map<string, ShipAssetRef>();
  for (const bundle of bundles) {
    for (const asset of [bundle.launchAsset, ...bundle.assets]) {
      if (!bySha.has(asset.sha256)) {
        bySha.set(asset.sha256, asset);
      }
    }
  }
  return bySha;
}

export async function publishCommand(flags: Flags): Promise<void> {
  const channel = requireString(flags, 'channel', 'OXY_SHIP_CHANNEL');
  const platforms = platformsFlag(flags);
  const rolloutPercent = rolloutFlag(flags);
  const message = stringFlag(flags, 'message');
  const gitCommit = stringFlag(flags, 'git-commit', 'GITHUB_SHA');
  const projectDir = path.resolve(stringFlag(flags, 'project-dir', undefined, '.') as string);
  const distDir = path.resolve(projectDir, stringFlag(flags, 'dist-dir', undefined, 'dist') as string);
  const runtimeOverride = stringFlag(flags, 'runtime-version');
  const dryRun = flags['dry-run'] === true;
  const skipExport = flags['skip-export'] === true;

  if (!skipExport) {
    console.log(`Exporting (${platforms.join(', ')}) → ${distDir} …`);
    runExpoExport(projectDir, platforms, distDir);
  }

  const config = readExpoPublicConfig(projectDir);
  const runtimeVersion = resolveRuntimeVersion(config, runtimeOverride);

  const metadata = readExportMetadata(distDir);
  const bundles = platforms.map((platform) => collectPlatformAssets(distDir, metadata, platform));
  const bySha = uniqueAssets(bundles);

  console.log(
    `Runtime ${runtimeVersion} · channel ${channel} · ${bySha.size} unique assets across ${platforms.length} platform(s)`
  );

  if (dryRun) {
    for (const bundle of bundles) {
      console.log(
        `  [dry-run] ${bundle.platform}: launch ${bundle.launchAsset.sha256.slice(0, 12)} + ${bundle.assets.length} assets`
      );
    }
    console.log('Dry run — no API calls made.');
    return;
  }

  const client = createShipClient(flags);

  const initItems = [...bySha.values()].map((asset) => ({
    sha256: asset.sha256,
    contentType: asset.contentType,
    size: asset.size,
  }));
  const init = await client.initAssets(initItems);
  console.log(`Assets: ${init.existing.length} already stored, ${init.missing.length} to upload.`);

  for (const ticket of init.missing) {
    const asset = bySha.get(ticket.sha256);
    if (!asset) {
      throw new Error(`Server asked for an asset we did not offer: ${ticket.sha256}`);
    }
    await client.uploadAsset(ticket.uploadUrl, ticket.contentType, asset.absPath);
  }

  const complete = await client.completeAssets([...bySha.keys()]);
  const notUploaded = complete.assets.filter((asset) => asset.status !== 'uploaded');
  if (notUploaded.length > 0) {
    throw new Error(
      `${notUploaded.length} asset(s) failed to upload: ${notUploaded.map((a) => a.sha256.slice(0, 12)).join(', ')}`
    );
  }

  for (const bundle of bundles) {
    const update = await client.createUpdate({
      channel,
      runtimeVersion,
      platform: bundle.platform,
      launchAsset: {
        sha256: bundle.launchAsset.sha256,
        key: bundle.launchAsset.key,
        contentType: bundle.launchAsset.contentType,
      },
      assets: bundle.assets.map((asset) => ({
        sha256: asset.sha256,
        key: asset.key,
        contentType: asset.contentType,
        ...(asset.fileExtension ? { fileExtension: asset.fileExtension } : {}),
      })),
      extra: { expoClient: config },
      ...(rolloutPercent !== undefined ? { rolloutPercent } : {}),
      ...(gitCommit ? { gitCommit } : {}),
      ...(message ? { message } : {}),
    });
    console.log(`Published ${bundle.platform}: ${update.id}  (rollout ${update.rolloutPercent}%)`);
  }
}

export async function rollbackCommand(flags: Flags): Promise<void> {
  const channel = requireString(flags, 'channel', 'OXY_SHIP_CHANNEL');
  const runtimeVersion = requireString(flags, 'runtime-version', 'OXY_SHIP_RUNTIME_VERSION');
  const platform = requirePlatform(flags);
  const client = createShipClient(flags);
  const result = await client.rollback(channel, runtimeVersion, platform);
  console.log(`Rolled back ${result.rolledBack.id}; new head: ${result.head?.id ?? '(none)'}`);
}

export async function rollbackToEmbeddedCommand(flags: Flags): Promise<void> {
  const channel = requireString(flags, 'channel', 'OXY_SHIP_CHANNEL');
  const runtimeVersion = requireString(flags, 'runtime-version', 'OXY_SHIP_RUNTIME_VERSION');
  const platform = requirePlatform(flags);
  const client = createShipClient(flags);
  await client.rollbackToEmbedded(channel, runtimeVersion, platform);
  console.log(`Set rollback-to-embedded on ${channel} for ${runtimeVersion}/${platform}.`);
}

export async function promoteCommand(flags: Flags): Promise<void> {
  const updateId = requireString(flags, 'update-id', 'OXY_SHIP_UPDATE_ID');
  const toChannel = requireString(flags, 'to-channel', 'OXY_SHIP_TO_CHANNEL');
  const rolloutPercent = rolloutFlag(flags);
  const client = createShipClient(flags);
  const update = await client.promote(toChannel, updateId, rolloutPercent);
  console.log(`Promoted ${updateId} → ${toChannel} as ${update.id} (rollout ${update.rolloutPercent}%)`);
}

export async function channelListCommand(flags: Flags): Promise<void> {
  const client = createShipClient(flags);
  const channels = await client.listChannels();
  if (channels.length === 0) {
    console.log('No channels yet.');
    return;
  }
  for (const channel of channels) {
    const rollbacks = channel.rollbacksToEmbedded
      .map((entry) => `${entry.runtimeVersion}/${entry.platform}`)
      .join(', ');
    console.log(`${channel.name}${rollbacks ? `  (rollback-to-embedded: ${rollbacks})` : ''}`);
  }
}

function requirePlatform(flags: Flags): UpdatePlatform {
  const value = stringFlag(flags, 'platform', 'OXY_SHIP_PLATFORM');
  if (value !== 'ios' && value !== 'android') {
    throw new Error('--platform must be ios or android for this command');
  }
  return value;
}
