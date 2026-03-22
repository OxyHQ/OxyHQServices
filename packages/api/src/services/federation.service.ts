/**
 * Federation Service
 *
 * Resolves fediverse (ActivityPub) handles to Oxy user profiles.
 * Handles WebFinger discovery, actor profile fetching, avatar download, and user upsert.
 * Signs outgoing requests with HTTP Signatures for servers that enforce authorized fetch.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import { AssetService } from './assetService';
import { createS3Service } from './s3Service';
import { logger } from '../utils/logger';

const AP_ACCEPT_TYPES = [
  'application/activity+json',
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
];

const AP_DOMAIN = process.env.FEDERATION_DOMAIN || 'api.oxy.so';
const USER_AGENT = 'OxyHQ/1.0 (ActivityPub)';
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

const FEDIVERSE_HANDLE_REGEX = /^@?[\w.-]+@[\w.-]+\.\w+$/;

// System user ID for federated avatar ownership
const FEDERATION_SYSTEM_USER = '__federation__';

/**
 * Check if a string looks like a fediverse handle (@user@domain or user@domain).
 */
export function isFediverseHandle(query: string): boolean {
  return FEDIVERSE_HANDLE_REGEX.test(query.trim());
}

// ============================================================
// HTTP Signature Signing
// ============================================================

/** Mongoose model for the instance key pair (lazy-created collection). */
const keyPairSchema = new mongoose.Schema({
  keyId: { type: String, required: true, unique: true },
  publicKeyPem: { type: String, required: true },
  privateKeyPem: { type: String, required: true },
}, { timestamps: true });

const FederationKeyPair = mongoose.models.FederationKeyPair
  || mongoose.model('FederationKeyPair', keyPairSchema, 'federation_keypairs');

interface KeyPairDoc {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

let _cachedKeyPair: KeyPairDoc | null = null;

/**
 * Get or create the instance-level RSA key pair used for signing fetch requests.
 * The key pair is generated once, stored in MongoDB, and cached in memory.
 */
async function getInstanceKeyPair(): Promise<KeyPairDoc> {
  if (_cachedKeyPair) return _cachedKeyPair;

  const keyId = `https://${AP_DOMAIN}/ap/actor#main-key`;
  const existing = await FederationKeyPair.findOne({ keyId }).lean() as KeyPairDoc | null;
  if (existing) {
    _cachedKeyPair = existing;
    return existing;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const doc = await FederationKeyPair.create({
    keyId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  });

  _cachedKeyPair = { keyId: doc.keyId, publicKeyPem: doc.publicKeyPem, privateKeyPem: doc.privateKeyPem };
  return _cachedKeyPair;
}

/**
 * Build HTTP Signature headers per draft-cavage-http-signatures-12.
 */
function signRequest(
  privateKeyPem: string,
  keyId: string,
  method: string,
  url: string,
): Record<string, string> {
  const parsedUrl = new URL(url);
  const date = new Date().toUTCString();
  const signedHeaderNames = ['(request-target)', 'host', 'date'];
  const signingString = [
    `(request-target): ${method.toLowerCase()} ${parsedUrl.pathname}`,
    `host: ${parsedUrl.host}`,
    `date: ${date}`,
  ].join('\n');

  const signer = crypto.createSign('sha256');
  signer.update(signingString);
  signer.end();
  const signature = signer.sign(privateKeyPem, 'base64');

  return {
    Host: parsedUrl.host,
    Date: date,
    Signature: [
      `keyId="${keyId}"`,
      'algorithm="rsa-sha256"',
      `headers="${signedHeaderNames.join(' ')}"`,
      `signature="${signature}"`,
    ].join(','),
  };
}

/**
 * Fetch a URL with HTTP Signature authentication.
 * Required by servers that enforce authorized fetch (e.g., Threads).
 */
async function signedFetch(url: string, accept: string): Promise<Response> {
  const keyPair = await getInstanceKeyPair();
  const sigHeaders = signRequest(keyPair.privateKeyPem, keyPair.keyId, 'GET', url);

  return fetch(url, {
    headers: {
      Accept: accept,
      'User-Agent': USER_AGENT,
      ...sigHeaders,
    },
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * Returns the instance actor JSON-LD document for HTTP Signature key verification.
 * Served at GET /ap/actor by the routes layer.
 */
export async function getInstanceActor(): Promise<Record<string, unknown>> {
  const keyPair = await getInstanceKeyPair();
  const actorUrl = `https://${AP_DOMAIN}/ap/actor`;

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: actorUrl,
    type: 'Application',
    preferredUsername: 'oxy',
    inbox: `${actorUrl}/inbox`,
    outbox: `${actorUrl}/outbox`,
    publicKey: {
      id: keyPair.keyId,
      owner: actorUrl,
      publicKeyPem: keyPair.publicKeyPem,
    },
  };
}

// ============================================================
// Asset Service (lazy init)
// ============================================================

let _assetService: AssetService | null = null;
function getAssetService(): AssetService {
  if (!_assetService) {
    const s3 = createS3Service({
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      bucketName: process.env.AWS_S3_BUCKET || '',
      endpointUrl: process.env.AWS_ENDPOINT_URL,
    });
    _assetService = new AssetService(s3);
  }
  return _assetService;
}

// ============================================================
// Federation Service
// ============================================================

class FederationService {
  /**
   * Resolve a WebFinger acct to an ActivityPub actor URI.
   * @param acct - e.g. "alice@mastodon.social" or "@alice@mastodon.social"
   */
  async resolveWebFinger(acct: string): Promise<string | null> {
    const cleaned = acct.replace(/^@/, '');
    const atIndex = cleaned.indexOf('@');
    if (atIndex === -1) return null;

    const rawDomain = cleaned.substring(atIndex + 1);
    const domain = rawDomain.replace(/^www\./i, '');
    const normalizedAcct = `${cleaned.substring(0, atIndex)}@${domain}`;
    const resource = `acct:${normalizedAcct}`;
    const url = `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/jrd+json, application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        links?: Array<{ rel?: string; type?: string; href?: string }>;
      };

      const link = data.links?.find(
        (l) => l.rel === 'self' && l.type && AP_ACCEPT_TYPES.includes(l.type),
      );
      return link?.href || null;
    } catch (err) {
      logger.warn(`WebFinger resolution failed for ${acct}: ${err}`);
      return null;
    }
  }

  /**
   * Fetch an ActivityPub actor by URI and extract user-profile fields.
   * Uses HTTP Signature for servers that enforce authorized fetch.
   */
  async fetchActorProfile(actorUri: string): Promise<{
    actorUri: string;
    domain: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    bio?: string;
  } | null> {
    try {
      const res = await signedFetch(actorUri, AP_ACCEPT_TYPES[0]);
      if (!res.ok) return null;

      const actor = (await res.json()) as Record<string, unknown>;
      if (!actor.id || !actor.inbox) return null;

      const domain = new URL(actor.id as string).hostname;
      const username = (actor.preferredUsername as string) || (actor.name as string) || 'unknown';
      const acct = `${username}@${domain}`;

      return {
        actorUri: actor.id as string,
        domain,
        username: acct,
        displayName: (actor.name as string) || username,
        avatarUrl: (actor.icon as Record<string, unknown>)?.url as string | undefined,
        bio: (actor.summary as string)?.replace(/<[^>]*>/g, '') || undefined,
      };
    } catch (err) {
      logger.warn(`Failed to fetch actor profile ${actorUri}: ${err}`);
      return null;
    }
  }

  /**
   * Download a remote avatar image, upload it to Oxy Cloud, and return the file ID.
   * If the user already has an avatar file, deletes the old one first.
   */
  /**
   * Download a remote avatar image, upload it to Oxy Cloud, and return the file ID.
   * If the user already has an avatar file, deletes the old one first.
   */
  async downloadAndStoreAvatar(
    avatarUrl: string,
    existingAvatarFileId?: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(avatarUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        logger.warn(`Avatar download failed: HTTP ${res.status} for ${avatarUrl}`);
        return null;
      }

      // Sanitize content-type: strip parameters (e.g. "image/jpeg; charset=utf-8" → "image/jpeg")
      const rawContentType = res.headers.get('content-type') || 'image/png';
      const contentType = rawContentType.split(';')[0].trim().toLowerCase();

      // Accept image/* and common binary types that CDNs return for images
      if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
        logger.warn(`Avatar download skipped: non-image content-type "${rawContentType}" for ${avatarUrl}`);
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null; // max 5MB

      // For application/octet-stream, infer MIME from URL extension or default to png
      let mime = contentType;
      if (mime === 'application/octet-stream') {
        const urlLower = avatarUrl.toLowerCase();
        if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) mime = 'image/jpeg';
        else if (urlLower.endsWith('.webp')) mime = 'image/webp';
        else if (urlLower.endsWith('.gif')) mime = 'image/gif';
        else mime = 'image/png';
      }

      const assetService = getAssetService();

      // Delete old avatar file if it exists (skip if it looks like a URL, not a file ID)
      if (existingAvatarFileId && !existingAvatarFileId.startsWith('http')) {
        try {
          await assetService.deleteFile(existingAvatarFileId, true);
        } catch {
          // Old file may already be gone — not critical
        }
      }

      // Determine extension from sanitized content type
      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      const ext = extMap[mime] || 'png';
      const filename = `federated-avatar-${crypto.randomBytes(8).toString('hex')}.${ext}`;

      const file = await assetService.uploadFileDirect(
        FEDERATION_SYSTEM_USER,
        buffer,
        mime,
        filename,
        'public',
      );

      return file._id.toString();
    } catch (err) {
      logger.warn(`Failed to download/store federated avatar: ${err}`);
      return null;
    }
  }

  /**
   * Full pipeline: resolve a fediverse handle to an Oxy user.
   * 1. Check local cache (existing user with matching federation.actorUri, <24h old)
   * 2. WebFinger → actor URI
   * 3. Fetch actor profile (with HTTP Signature)
   * 4. Download avatar to Oxy Cloud
   * 5. Upsert as Oxy user with type=federated
   */
  async resolveAndUpsert(handle: string): Promise<IUser | null> {
    const cleaned = handle.replace(/^@/, '');
    const atIndex = cleaned.indexOf('@');
    if (atIndex === -1) return null;

    const domain = cleaned.substring(atIndex + 1);

    // Check cache: existing user fetched recently.
    // Fediverse usernames are case-insensitive; we store them lowercased.
    const existing = await User.findOne({
      type: 'federated',
      'federation.domain': domain,
      username: cleaned.toLowerCase(),
    })
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;

    // An avatar stored as a URL (from PUT /users/resolve) must be re-downloaded
    // so it becomes a proper Oxy file. Skip the cache shortcut in that case.
    const avatarNeedsDownload = existing?.avatar
      && typeof existing.avatar === 'string'
      && existing.avatar.startsWith('http');

    if (
      existing?.updatedAt
      && Date.now() - new Date(existing.updatedAt).getTime() < STALE_MS
      && !avatarNeedsDownload
    ) {
      return existing;
    }

    // WebFinger resolution
    const actorUri = await this.resolveWebFinger(cleaned);
    if (!actorUri) return null;

    // Fetch actor profile
    const profile = await this.fetchActorProfile(actorUri);
    if (!profile) return null;

    // Download avatar to Oxy Cloud (replaces old avatar if exists)
    let avatarFileId: string | undefined;
    if (profile.avatarUrl) {
      const storedId = await this.downloadAndStoreAvatar(
        profile.avatarUrl,
        existing?.avatar,
      );
      if (storedId) avatarFileId = storedId;
    }

    // Upsert into Oxy users collection
    const setFields: Record<string, unknown> = {
      type: 'federated',
      username: profile.username.toLowerCase(),
      'name.first': profile.displayName,
      'federation.actorUri': profile.actorUri,
      'federation.domain': profile.domain,
    };

    if (avatarFileId) {
      setFields.avatar = avatarFileId;
    }
    if (profile.bio) {
      setFields.bio = profile.bio;
      setFields.description = profile.bio;
    }

    const user = await User.findOneAndUpdate(
      { 'federation.actorUri': profile.actorUri },
      { $set: setFields },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
      .select('-password -refreshToken');

    if (user) {
      logger.info(`Resolved fediverse user: ${profile.username} (${profile.actorUri})`);
    }

    return user;
  }
}

export const federationService = new FederationService();
export default federationService;
