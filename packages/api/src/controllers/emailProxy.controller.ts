/**
 * Email Proxy Controller
 *
 * Proxies external images and fonts for email content to bypass CORS restrictions
 * and provide tracking protection for users.
 */

import { Request, Response } from 'express';
import { BadRequestError } from '../utils/error';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// ─── Configuration ────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT = 10000; // 10 seconds
const TRACKING_PIXEL_THRESHOLD = 100; // bytes

// Transparent 1x1 GIF for blocked tracking pixels
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ─── SSRF Protection ──────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^0\./,                            // Current network
  /^10\./,                           // Private Class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./,   // Private Class B
  /^192\.168\./,                     // Private Class C
  /^169\.254\./,                     // Link-local
  /^fc00:/i,                         // IPv6 private
  /^fe80:/i,                         // IPv6 link-local
  /^::1$/,                           // IPv6 loopback
  /^localhost$/i,
];

function validateProxyUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new BadRequestError('Invalid URL format');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestError('Only HTTP(S) URLs are allowed');
  }

  if (PRIVATE_IP_PATTERNS.some((p) => p.test(url.hostname))) {
    throw new BadRequestError('Private network URLs are not allowed');
  }

  return url;
}

// ─── Tracking Protection ──────────────────────────────────────────

const TRACKING_PATTERNS = [
  /mailtrack\./i,
  /getnotify\./i,
  /readnotify\./i,
  /yesware\./i,
  /bananatag\./i,
  /\.doubleclick\./i,
  /\/track(ing)?[\/\?]/i,
  /\/pixel[\/\?]/i,
  /\/beacon[\/\?]/i,
  /\/wf\/open/i,
  /\/[to]\.gif$/i,
];

function isTrackingUrl(url: URL): boolean {
  const fullUrl = url.href;
  return TRACKING_PATTERNS.some((p) => p.test(fullUrl));
}

// ─── Caching ──────────────────────────────────────────────────────

interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500 MB
let currentCacheSize = 0;

function getCacheKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function getFromCache(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.timestamp > CACHE_TTL) {
    currentCacheSize -= entry.buffer.length;
    cache.delete(key);
    return undefined;
  }

  return entry;
}

function addToCache(key: string, buffer: Buffer, contentType: string): void {
  if (buffer.length > MAX_CACHE_SIZE / 10) return;

  while (currentCacheSize + buffer.length > MAX_CACHE_SIZE && cache.size > 0) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      const oldEntry = cache.get(oldestKey);
      if (oldEntry) {
        currentCacheSize -= oldEntry.buffer.length;
        cache.delete(oldestKey);
      }
    }
  }

  cache.set(key, { buffer, contentType, timestamp: Date.now() });
  currentCacheSize += buffer.length;
}

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      currentCacheSize -= entry.buffer.length;
      cache.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

// ─── Response Helpers ─────────────────────────────────────────────

function sendTransparentGif(res: Response, cacheTime = 86400): void {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', `public, max-age=${cacheTime}`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(TRANSPARENT_GIF);
}

function sendProxiedResponse(
  res: Response,
  buffer: Buffer,
  contentType: string,
  cacheHit: boolean
): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
  res.send(buffer);
}

// ─── Controller ───────────────────────────────────────────────────

export async function proxyResource(req: Request, res: Response): Promise<void> {
  const { url: encodedUrl } = req.query;

  if (!encodedUrl || typeof encodedUrl !== 'string') {
    throw new BadRequestError('URL parameter is required');
  }

  // Decode URL (support both base64 and URI encoding)
  let decodedUrl: string;
  try {
    const base64Decoded = Buffer.from(encodedUrl, 'base64').toString('utf-8');
    decodedUrl = base64Decoded.startsWith('http') ? base64Decoded : decodeURIComponent(encodedUrl);
  } catch {
    decodedUrl = decodeURIComponent(encodedUrl);
  }

  const url = validateProxyUrl(decodedUrl);

  // Block tracking URLs
  if (isTrackingUrl(url)) {
    logger.debug('Blocked tracking URL', { url: decodedUrl });
    return sendTransparentGif(res);
  }

  // Check cache
  const cacheKey = getCacheKey(decodedUrl);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return sendProxiedResponse(res, cached.buffer, cached.contentType, true);
  }

  // Fetch the resource
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'OxyMail/1.0 (Image Proxy)',
        Accept: 'image/*,font/*,*/*',
      },
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return sendTransparentGif(res, 3600);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Validate content type
    if (!/^(image\/|font\/|application\/(font|x-font))/i.test(contentType)) {
      throw new BadRequestError('Only images and fonts allowed');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new BadRequestError('Resource too large');
    }

    // Block tracking pixels (very small images)
    if (buffer.length < TRACKING_PIXEL_THRESHOLD) {
      logger.debug('Blocked tracking pixel', { url: decodedUrl, size: buffer.length });
      return sendTransparentGif(res);
    }

    addToCache(cacheKey, buffer, contentType);
    sendProxiedResponse(res, buffer, contentType, false);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof BadRequestError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Proxy request timeout', { url: decodedUrl });
    } else {
      logger.error('Proxy request failed', { url: decodedUrl, error });
    }

    sendTransparentGif(res);
  }
}
