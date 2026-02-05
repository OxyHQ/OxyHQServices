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

interface AuthRequest extends Request {
  user?: { id: string };
}

// ─── Configuration ────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT = 10000; // 10 seconds

// Transparent 1x1 GIF for blocked tracking pixels
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ─── SSRF Protection ──────────────────────────────────────────────

const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'file:', 'ftp:', 'blob:'];

// Private IP ranges that should never be accessed
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
  /^localhost$/i,                    // Localhost hostname
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
}

function validateProxyUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new BadRequestError('Invalid URL format');
  }

  // Only allow http and https
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestError('Only HTTP(S) URLs are allowed');
  }

  // Check for blocked protocols in the URL string itself
  const lowerUrl = urlString.toLowerCase();
  if (BLOCKED_PROTOCOLS.some((p) => lowerUrl.includes(p))) {
    throw new BadRequestError('Blocked URL protocol');
  }

  // Block private/internal IPs
  if (isPrivateHost(url.hostname)) {
    throw new BadRequestError('Private network URLs are not allowed');
  }

  return url;
}

// ─── Tracking Protection ──────────────────────────────────────────

const TRACKING_DOMAINS = [
  /mailtrack\./i,
  /getnotify\./i,
  /readnotify\./i,
  /yesware\./i,
  /bananatag\./i,
  /mailchimp\.com.*\/track/i,
  /list-manage\.com.*\/track/i,
  /sendgrid\.net.*\/wf\//i,
  /\.doubleclick\./i,
  /pixel\./i,
  /beacon\./i,
];

const TRACKING_PATH_PATTERNS = [
  /\/track(ing)?[\/\?]/i,
  /\/pixel[\/\?]/i,
  /\/beacon[\/\?]/i,
  /\/open[\/\?]/i,
  /\/wf\/open/i,
  /\/t\.gif/i,
  /\/o\.gif/i,
];

function isTrackingUrl(url: URL): boolean {
  const fullUrl = url.href;

  // Check domain patterns
  if (TRACKING_DOMAINS.some((pattern) => pattern.test(fullUrl))) {
    return true;
  }

  // Check path patterns
  if (TRACKING_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname + url.search))) {
    return true;
  }

  return false;
}

// Detect tracking pixels by content (small images)
function isTrackingPixel(
  contentType: string,
  contentLength: number | undefined
): boolean {
  // Very small images (< 100 bytes) are likely tracking pixels
  if (contentLength !== undefined && contentLength < 100) {
    return true;
  }
  return false;
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

  // Check if expired
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    currentCacheSize -= entry.buffer.length;
    cache.delete(key);
    return undefined;
  }

  return entry;
}

function addToCache(key: string, buffer: Buffer, contentType: string): void {
  // Don't cache if it would exceed max size
  if (buffer.length > MAX_CACHE_SIZE / 10) return; // Single item max 10% of cache

  // Evict old entries if needed
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

  cache.set(key, {
    buffer,
    contentType,
    timestamp: Date.now(),
  });
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
}, 60 * 60 * 1000).unref(); // Run every hour

// ─── Controller ───────────────────────────────────────────────────

export async function proxyResource(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const { url: encodedUrl } = req.query;

  if (!encodedUrl || typeof encodedUrl !== 'string') {
    throw new BadRequestError('URL parameter is required');
  }

  // Decode URL (support both base64 and URI encoding)
  let decodedUrl: string;
  try {
    // Try base64 first
    const base64Decoded = Buffer.from(encodedUrl, 'base64').toString('utf-8');
    // Check if it looks like a valid URL
    if (base64Decoded.startsWith('http://') || base64Decoded.startsWith('https://')) {
      decodedUrl = base64Decoded;
    } else {
      // Fall back to URI decoding
      decodedUrl = decodeURIComponent(encodedUrl);
    }
  } catch {
    decodedUrl = decodeURIComponent(encodedUrl);
  }

  // Validate URL and check for SSRF
  const url = validateProxyUrl(decodedUrl);

  // Check for tracking URLs - return transparent GIF
  if (isTrackingUrl(url)) {
    logger.debug('Blocked tracking URL', { url: decodedUrl, userId: req.user?.id });
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(TRANSPARENT_GIF);
    return;
  }

  // Check cache
  const cacheKey = getCacheKey(decodedUrl);
  const cached = getFromCache(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Cache', 'HIT');
    res.send(cached.buffer);
    return;
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
      // Return transparent GIF for failed requests
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(TRANSPARENT_GIF);
      return;
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    const parsedLength = contentLength ? parseInt(contentLength, 10) : undefined;

    // Validate content type - only allow images and fonts
    const allowedTypes = /^(image\/|font\/|application\/font|application\/x-font)/i;
    if (!allowedTypes.test(contentType)) {
      throw new BadRequestError('Invalid content type - only images and fonts allowed');
    }

    // Check for tracking pixels by size
    if (parsedLength !== undefined && isTrackingPixel(contentType, parsedLength)) {
      logger.debug('Blocked tracking pixel by size', { url: decodedUrl, size: parsedLength });
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(TRANSPARENT_GIF);
      return;
    }

    // Read the response body
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Check size limit
    if (buffer.length > MAX_IMAGE_SIZE) {
      throw new BadRequestError('Resource too large');
    }

    // Double-check for tracking pixel after receiving content
    if (isTrackingPixel(contentType, buffer.length)) {
      logger.debug('Blocked tracking pixel by actual size', { url: decodedUrl, size: buffer.length });
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(TRANSPARENT_GIF);
      return;
    }

    // Cache the response
    addToCache(cacheKey, buffer, contentType);

    // Send response
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Cache', 'MISS');
    res.send(buffer);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Proxy request timeout', { url: decodedUrl });
      res.setHeader('Content-Type', 'image/gif');
      res.send(TRANSPARENT_GIF);
      return;
    }

    // For other errors, return transparent GIF to avoid breaking email display
    logger.error('Proxy request failed', { url: decodedUrl, error });
    res.setHeader('Content-Type', 'image/gif');
    res.send(TRANSPARENT_GIF);
  }
}
