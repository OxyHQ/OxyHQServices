/**
 * Federation Service
 *
 * Resolves fediverse (ActivityPub) handles to Oxy user profiles.
 * Handles WebFinger discovery, actor profile fetching, avatar download, and user upsert.
 */

import crypto from 'crypto';
import User, { IUser } from '../models/User';
// File model not directly imported — avatar management goes through AssetService
import { AssetService } from './assetService';
import { createS3Service } from './s3Service';
import { logger } from '../utils/logger';

const AP_ACCEPT_TYPES = [
  'application/activity+json',
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
];

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

/** Lazy-init asset service (shares the same S3 config as the rest of the app). */
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

class FederationService {
  /**
   * Resolve a WebFinger acct to an ActivityPub actor URI.
   * @param acct - e.g. "alice@mastodon.social" or "@alice@mastodon.social"
   */
  async resolveWebFinger(acct: string): Promise<string | null> {
    const cleaned = acct.replace(/^@/, '');
    const atIndex = cleaned.indexOf('@');
    if (atIndex === -1) return null;

    const domain = cleaned.substring(atIndex + 1);
    const resource = `acct:${cleaned}`;
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
   * Returns the fields needed for an Oxy User upsert, or null on failure.
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
      const res = await fetch(actorUri, {
        headers: {
          Accept: AP_ACCEPT_TYPES[0],
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
      });
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
  private async downloadAndStoreAvatar(
    avatarUrl: string,
    existingAvatarFileId?: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(avatarUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;

      const contentType = res.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/')) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) return null; // max 5MB

      const assetService = getAssetService();

      // Delete old avatar file if it exists
      if (existingAvatarFileId) {
        try {
          await assetService.deleteFile(existingAvatarFileId, true);
        } catch {
          // Old file may already be gone — not critical
        }
      }

      // Determine extension from content type
      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      const ext = extMap[contentType] || 'png';
      const filename = `federated-avatar-${crypto.randomBytes(8).toString('hex')}.${ext}`;

      const file = await assetService.uploadFileDirect(
        FEDERATION_SYSTEM_USER,
        buffer,
        contentType,
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
   * 3. Fetch actor profile
   * 4. Download avatar to Oxy Cloud
   * 5. Upsert as Oxy user with type=federated
   */
  async resolveAndUpsert(handle: string): Promise<IUser | null> {
    const cleaned = handle.replace(/^@/, '');
    const atIndex = cleaned.indexOf('@');
    if (atIndex === -1) return null;

    // Check cache: existing user fetched recently
    const existing = await User.findOne({ username: cleaned, type: 'federated' })
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;

    if (existing?.updatedAt && Date.now() - new Date(existing.updatedAt).getTime() < STALE_MS) {
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
        existing?.avatar || undefined,
      );
      if (storedId) avatarFileId = storedId;
    }

    // Upsert into Oxy users collection
    const setFields: Record<string, unknown> = {
      type: 'federated',
      username: profile.username,
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
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;

    if (user) {
      logger.info(`Resolved fediverse user: ${profile.username} (${profile.actorUri})`);
    }

    return user;
  }
}

export const federationService = new FederationService();
export default federationService;
