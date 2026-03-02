import crypto from 'crypto';
import { SenderAvatar } from '../models/SenderAvatar';
import User from '../models/User';
import { extractUsername } from '../config/email.config';

const CACHE_TTL_DAYS = 7;

/** Build a base64-encoded proxy path for an external URL. */
function proxyPath(url: string): string {
  const encoded = Buffer.from(url, 'utf-8').toString('base64');
  return `/email/proxy?url=${encoded}`;
}

/**
 * Resolve avatar for a single email address.
 * Returns a relative path (prepend API base URL on the client) or null.
 */
async function resolveAvatar(email: string): Promise<{ avatarPath: string | null; source: 'oxy' | 'gravatar' | 'favicon' | 'none' }> {
  const normalized = email.trim().toLowerCase();

  // 1. Oxy user — look up by username
  const username = extractUsername(normalized);
  if (username) {
    try {
      const user = await User.findOne({ username }).select('avatar').lean();
      if (user && user.avatar) {
        return { avatarPath: `/api/assets/${user.avatar}/stream`, source: 'oxy' };
      }
    } catch {
      // User lookup failed — continue to fallbacks
    }
  }

  // 2. Gravatar — HEAD check
  const md5Hash = crypto.createHash('md5').update(normalized).digest('hex');
  const gravatarUrl = `https://www.gravatar.com/avatar/${md5Hash}?d=404&s=80`;
  try {
    const res = await fetch(gravatarUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      return { avatarPath: proxyPath(gravatarUrl), source: 'gravatar' };
    }
  } catch {
    // Gravatar check failed — continue
  }

  // 3. Domain favicon — HEAD check
  const domain = normalized.split('@')[1];
  if (domain) {
    const faviconUrl = `https://${domain}/favicon.ico`;
    try {
      const res = await fetch(faviconUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.startsWith('image/') || ct.includes('icon')) {
          return { avatarPath: proxyPath(faviconUrl), source: 'favicon' };
        }
      }
    } catch {
      // Favicon check failed
    }
  }

  return { avatarPath: null, source: 'none' };
}

/**
 * Resolve a single sender's avatar with DB caching.
 */
export async function getAvatarPath(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();

  // Check cache
  const cached = await SenderAvatar.findOne({ email: normalized }).lean();
  if (cached) {
    return cached.avatarPath;
  }

  // Resolve and cache
  const { avatarPath, source } = await resolveAvatar(normalized);
  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await SenderAvatar.updateOne(
    { email: normalized },
    { $set: { avatarPath, source, resolvedAt: new Date(), expiresAt } },
    { upsert: true },
  );

  return avatarPath;
}

/**
 * Batch-resolve sender avatars. Returns a map of email → relative avatar path.
 * Cache hits are returned immediately; misses are resolved in parallel (capped concurrency).
 */
export async function getAvatarPathsBatch(emails: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  const result = new Map<string, string | null>();

  if (unique.length === 0) return result;

  // Bulk cache lookup
  const cached = await SenderAvatar.find({ email: { $in: unique } }).lean();
  const cachedMap = new Map(cached.map((c) => [c.email, c.avatarPath]));

  const misses: string[] = [];
  for (const email of unique) {
    if (cachedMap.has(email)) {
      result.set(email, cachedMap.get(email)!);
    } else {
      misses.push(email);
    }
  }

  // Resolve misses in parallel with concurrency cap
  if (misses.length > 0) {
    const CONCURRENCY = 5;
    for (let i = 0; i < misses.length; i += CONCURRENCY) {
      const batch = misses.slice(i, i + CONCURRENCY);
      const resolved = await Promise.allSettled(
        batch.map(async (email) => {
          const path = await getAvatarPath(email);
          return { email, path };
        }),
      );
      for (const r of resolved) {
        if (r.status === 'fulfilled') {
          result.set(r.value.email, r.value.path);
        } else {
          // Resolution failed entirely — set null, don't cache
          result.set(misses[resolved.indexOf(r)], null);
        }
      }
    }
  }

  return result;
}
