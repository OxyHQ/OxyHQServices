/**
 * Manifest resolution + multipart assembly for the public Oxy Updates endpoint.
 *
 * This is the hot, unauthenticated path (`GET /updates/v1/apps/:clientId/manifest`).
 * It resolves what a given device should receive for its `(channel,
 * runtimeVersion, platform)` and assembles the exact `multipart/mixed` bytes the
 * expo-updates v1 protocol requires, signing the manifest/directive part when
 * the client requested code signing.
 *
 * Decision precedence (matches the plan tree + Expo's reference server):
 *   1. Active `rollBackToEmbedded` directive for this runtime+platform → serve it
 *      (unless the client is already on its embedded update — avoids a loop).
 *   2. Otherwise resolve the rollout-aware HEAD update. If none, or the client is
 *      already running it → `noUpdateAvailable`.
 *   3. Otherwise serve the signed manifest for the head.
 *
 * On protocol version 0 (which predates directives) a directive decision degrades
 * to an empty `204` no-op; a real manifest is still served normally.
 */

import crypto from 'crypto';
import { AppUpdate, type IAppUpdate, type IUpdateAssetRef } from '../../models/AppUpdate';
import { UpdateChannel } from '../../models/UpdateChannel';
import type { UpdatePlatform } from '../../models/UpdateChannel';
import { updateAssetCdnUrl, sha256HexToBase64Url } from './assetKeys';
import { signPartBytes } from './signing.service';

/** Parsed, validated inputs for a manifest resolution. */
export interface ManifestRequest {
  /** Resolved Application `_id` (string). */
  applicationId: string;
  platform: UpdatePlatform;
  runtimeVersion: string;
  /** `expo-channel-name`; absent/unknown → noUpdateAvailable. */
  channelName?: string;
  /** `expo-current-update-id` — the update the client is currently running. */
  currentUpdateId?: string;
  /** `expo-embedded-update-id` — the update embedded in the client binary. */
  embeddedUpdateId?: string;
  /** Negotiated protocol version (0 or 1). */
  protocolVersion: 0 | 1;
  /** True when the client sent `expo-expect-signature` (wants a signed response). */
  expectSignature: boolean;
  /** Rollout device key from `expo-extra-params` `oxy-device-id`; absent → out of any partial rollout. */
  deviceKey?: string;
}

/** A fully-assembled HTTP response the route writes verbatim. */
export interface ManifestResponse {
  status: number;
  headers: Record<string, string>;
  body?: Buffer;
}

type ManifestDecision =
  | { kind: 'manifest'; update: IAppUpdate }
  | { kind: 'noUpdate' }
  | { kind: 'rollBackToEmbedded'; commitTime: Date };

/** How many newest published updates to consider when walking a partial rollout. */
const ROLLOUT_LOOKBACK = 25;

/**
 * Deterministic rollout membership: `sha256(updateId + ':' + deviceKey) % 10000 <
 * pct * 100`. A device without a key is out of any partial (<100) rollout. The
 * bucket is stable per (update, device), so a device's inclusion never flaps as
 * the percentage is raised.
 */
export function isInRollout(
  updateId: string,
  rolloutPercent: number,
  deviceKey: string | undefined
): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0) return false;
  if (!deviceKey) return false;
  const digest = crypto.createHash('sha256').update(`${updateId}:${deviceKey}`).digest();
  // Top 32 bits as an unsigned int → uniform bucket in [0, 10000).
  const bucket = digest.readUInt32BE(0) % 10000;
  return bucket < rolloutPercent * 100;
}

/** Resolve the rollout-aware head update, or null when none applies to this device. */
async function resolveHead(input: ManifestRequest, channelId: string): Promise<IAppUpdate | null> {
  const candidates = await AppUpdate.find({
    applicationId: input.applicationId,
    channelId,
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    status: 'published',
  })
    .sort({ createdAt: -1 })
    .limit(ROLLOUT_LOOKBACK);

  for (const candidate of candidates) {
    if (isInRollout(candidate.updateId, candidate.rolloutPercent, input.deviceKey)) {
      return candidate;
    }
  }
  return null;
}

/** Run the decision tree for a manifest request. */
async function decide(input: ManifestRequest): Promise<ManifestDecision> {
  if (!input.channelName) {
    return { kind: 'noUpdate' };
  }

  const channel = await UpdateChannel.findOne({
    applicationId: input.applicationId,
    name: input.channelName,
  });
  if (!channel) {
    return { kind: 'noUpdate' };
  }

  const rollback = channel.rollbacksToEmbedded.find(
    (entry) => entry.runtimeVersion === input.runtimeVersion && entry.platform === input.platform
  );
  if (rollback) {
    // The client is already on its embedded bundle — don't roll it back again.
    if (
      input.currentUpdateId &&
      input.embeddedUpdateId &&
      input.currentUpdateId === input.embeddedUpdateId
    ) {
      return { kind: 'noUpdate' };
    }
    return { kind: 'rollBackToEmbedded', commitTime: rollback.commitTime };
  }

  const head = await resolveHead(input, channel._id.toString());
  if (!head) {
    return { kind: 'noUpdate' };
  }
  if (head.updateId === input.currentUpdateId) {
    return { kind: 'noUpdate' };
  }
  return { kind: 'manifest', update: head };
}

/** Build a single expo manifest asset object from an embedded descriptor. */
function assetToManifest(
  ref: IUpdateAssetRef,
  isLaunchAsset: boolean
): Record<string, unknown> {
  const asset: Record<string, unknown> = {
    hash: sha256HexToBase64Url(ref.sha256),
    key: ref.key,
    contentType: ref.contentType,
    url: updateAssetCdnUrl(ref.sha256),
  };
  // The launch asset's fileExtension is ignored by clients and SHOULD be omitted.
  if (!isLaunchAsset && ref.fileExtension) {
    asset.fileExtension = ref.fileExtension;
  }
  return asset;
}

/** Build the manifest JSON object for a published update. */
export function buildManifestObject(update: IAppUpdate): Record<string, unknown> {
  return {
    id: update.updateId,
    createdAt: update.createdAt.toISOString(),
    runtimeVersion: update.runtimeVersion,
    launchAsset: assetToManifest(update.launchAsset, true),
    assets: update.assets.map((asset) => assetToManifest(asset, false)),
    metadata: update.metadata ?? {},
    extra: update.extra,
  };
}

interface MultipartPart {
  name: 'manifest' | 'directive' | 'extensions';
  contentType: string;
  body: Buffer;
  signature?: string;
}

/** Assemble a `multipart/mixed` body with exact bytes (no dependency on form-data). */
function assembleMultipart(parts: MultipartPart[]): { boundary: string; body: Buffer } {
  const boundary = `oxy-updates-${crypto.randomBytes(16).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="${part.name}"\r\n`;
    header += `Content-Type: ${part.contentType}\r\n`;
    if (part.signature) {
      header += `expo-signature: ${part.signature}\r\n`;
    }
    header += '\r\n';
    chunks.push(Buffer.from(header, 'utf8'), part.body, Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { boundary, body: Buffer.concat(chunks) };
}

/** Common expo-updates response headers for a multipart body. */
function multipartHeaders(boundary: string): Record<string, string> {
  return {
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${boundary}`,
  };
}

/** Wrap one signable JSON part (manifest or directive) into a full multipart response. */
function jsonPartResponse(
  name: 'manifest' | 'directive',
  json: Record<string, unknown>,
  expectSignature: boolean,
  extraParts: MultipartPart[] = []
): ManifestResponse {
  const body = Buffer.from(JSON.stringify(json), 'utf8');
  // signPartBytes throws CodeSigningNotConfiguredError when a signature is
  // required but no key is configured — the route maps that to a 500.
  const signature = expectSignature ? signPartBytes(body) : undefined;
  const part: MultipartPart = {
    name,
    contentType: 'application/json; charset=utf-8',
    body,
    signature,
  };
  const { boundary, body: multipart } = assembleMultipart([part, ...extraParts]);
  return { status: 200, headers: multipartHeaders(boundary), body: multipart };
}

/** Empty `204 No Content` response — a valid multipart no-op for protocol 0 directives. */
function noContentResponse(): ManifestResponse {
  return {
    status: 204,
    headers: { 'expo-protocol-version': '1', 'expo-sfv-version': '0' },
  };
}

/**
 * Resolve a manifest request into a fully-formed HTTP response (status, headers,
 * body). Pure of Express — the route adapts it. May throw
 * `CodeSigningNotConfiguredError` when a signature is required but unconfigured.
 */
export async function buildManifestResponse(input: ManifestRequest): Promise<ManifestResponse> {
  const decision = await decide(input);

  if (decision.kind === 'manifest') {
    const manifest = buildManifestObject(decision.update);
    // The (unsigned) extensions part carries asset request headers — empty here
    // because Oxy Update assets are public CDN objects needing no auth headers.
    const extensions: MultipartPart = {
      name: 'extensions',
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ assetRequestHeaders: {} }), 'utf8'),
    };
    return jsonPartResponse('manifest', manifest, input.expectSignature, [extensions]);
  }

  // Directives are unavailable on protocol 0 → empty 204 no-op.
  if (input.protocolVersion === 0) {
    return noContentResponse();
  }

  if (decision.kind === 'rollBackToEmbedded') {
    return jsonPartResponse(
      'directive',
      {
        type: 'rollBackToEmbedded',
        parameters: { commitTime: decision.commitTime.toISOString() },
      },
      input.expectSignature
    );
  }

  return jsonPartResponse('directive', { type: 'noUpdateAvailable' }, input.expectSignature);
}
