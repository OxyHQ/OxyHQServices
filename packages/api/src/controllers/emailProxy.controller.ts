/**
 * Email Proxy Controller
 *
 * Proxies external images and fonts for email content to bypass CORS restrictions
 * and provide tracking protection for users.
 */

import { Request, Response } from 'express';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { BadRequestError } from '../utils/error';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// ─── Configuration ────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_REDIRECTS = 5;
const TRACKING_PIXEL_THRESHOLD = 100; // bytes
const FONT_EXTENSIONS = /\.(ttf|otf|woff2?|eot)(\?|$)/i;
const FONT_MIME: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
};

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
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // Carrier-grade NAT
  /^192\.0\.0\./,                   // IETF protocol assignments
  /^192\.0\.2\./,                   // TEST-NET-1
  /^198\.(1[89])\./,                 // Benchmarking
  /^198\.51\.100\./,                // TEST-NET-2
  /^203\.0\.113\./,                 // TEST-NET-3
  /^22[4-9]\./,                       // Multicast/reserved
  /^23[0-9]\./,                       // Multicast/reserved
  /^24[0-9]\./,                       // Multicast/reserved
  /^25[0-5]\./,                       // Multicast/reserved
  /^fc00:/i,                         // IPv6 private
  /^fd[0-9a-f]{2}:/i,                // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^::1$/,                           // IPv6 loopback
  /^::$/,                            // IPv6 unspecified
  /^localhost$/i,
];

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)]$/, '$1').toLowerCase();
}

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(normalizeHostname(hostname)));
}

function isPublicIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized.startsWith('::ffff:')) {
    return isPublicIp(normalized.slice('::ffff:'.length));
  }
  if (net.isIP(normalized) === 0) return false;
  return !isPrivateHost(normalized);
}

async function assertPublicDnsTarget(url: URL): Promise<void> {
  const hostname = normalizeHostname(url.hostname);
  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new BadRequestError('Private network URLs are not allowed');
    return;
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadRequestError('Unable to resolve proxy URL hostname');
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new BadRequestError('Private network URLs are not allowed');
  }
}

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

  if (isPrivateHost(url.hostname)) {
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

interface ProxyFetchResponse {
  ok: boolean;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  buffer: Buffer;
  finalUrl: URL;
}

async function fetchPublicResource(url: URL, signal: AbortSignal, redirectsRemaining = MAX_REDIRECTS): Promise<ProxyFetchResponse> {
  await assertPublicDnsTarget(url);

  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        signal,
        headers: {
          'User-Agent': 'OxyMail/1.0 (Image Proxy)',
          Accept: 'image/*,font/*,*/*',
        },
        lookup: (hostname, options, callback) => {
          const lookupOptions = typeof options === 'number'
            ? { family: options }
            : { family: options.family, hints: options.hints };
          dns.lookup(hostname, lookupOptions, (error, address, family) => {
            if (error) return callback(error, address, family);
            const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
            if (addresses.some((entry) => !isPublicIp(entry))) {
              return callback(new Error('Private network URLs are not allowed'), address, family);
            }
            callback(null, address, family);
          });
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          if (redirectsRemaining <= 0) {
            reject(new BadRequestError('Too many redirects'));
            return;
          }

          const redirectUrl = validateProxyUrl(new URL(location, url).href);
          fetchPublicResource(redirectUrl, signal, redirectsRemaining - 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        let totalLength = 0;

        response.on('data', (chunk: Buffer) => {
          totalLength += chunk.length;
          if (totalLength > MAX_IMAGE_SIZE) {
            req.destroy(new BadRequestError('Resource too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            statusCode,
            headers: response.headers,
            buffer: Buffer.concat(chunks),
            finalUrl: url,
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
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
    const response = await fetchPublicResource(url, controller.signal);

    if (!response.ok) {
      clearTimeout(timeoutId);
      return sendTransparentGif(res, 3600);
    }

    const contentTypeHeader = response.headers['content-type'];
    const contentType = Array.isArray(contentTypeHeader)
      ? contentTypeHeader[0]
      : contentTypeHeader || 'application/octet-stream';

    // Validate content type — allow octet-stream for font files (many servers
    // serve .ttf/.woff as application/octet-stream instead of font/*)
    const isAllowedType = /^(image\/|font\/|application\/(font|x-font))/i.test(contentType);
    const isFontByExtension = contentType === 'application/octet-stream' && FONT_EXTENSIONS.test(response.finalUrl.pathname);
    if (!isAllowedType && !isFontByExtension) {
      clearTimeout(timeoutId);
      throw new BadRequestError('Only images and fonts allowed');
    }

    clearTimeout(timeoutId);
    const { buffer } = response;

    // Block tracking pixels (very small images)
    if (buffer.length < TRACKING_PIXEL_THRESHOLD) {
      logger.debug('Blocked tracking pixel', { url: decodedUrl, size: buffer.length });
      return sendTransparentGif(res);
    }

    // Use correct MIME when upstream sends generic octet-stream for fonts
    let resolvedType = contentType;
    if (isFontByExtension) {
      const ext = response.finalUrl.pathname.match(/\.\w+/)?.[0]?.toLowerCase();
      if (ext && FONT_MIME[ext]) resolvedType = FONT_MIME[ext];
    }

    addToCache(cacheKey, buffer, resolvedType);
    sendProxiedResponse(res, buffer, resolvedType, false);
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
