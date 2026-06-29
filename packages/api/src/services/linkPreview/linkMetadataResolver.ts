import type { IncomingMessage, IncomingHttpHeaders } from 'http';
import { URL } from 'url';
import { safeFetch, SsrfRejection, type SafeFetchResult } from '@oxyhq/core/server';
import { logger } from '../../utils/logger';
import { linkMetadataProviders } from './linkMetadataProviders';
import {
  LINK_PREVIEW_HTML_MAX_BYTES,
  LINK_PREVIEW_MAX_URL_LENGTH,
  LINK_PREVIEW_TIMEOUT_MS,
} from './constants';
import type { RawLinkMetadata } from './types';

/**
 * Generic link-metadata resolver (ported from Mention's `linkMetadataService`).
 *
 * Pipeline per URL:
 *   1. oEmbed provider chain (YouTube/Vimeo/Spotify) — see linkMetadataProviders.
 *   2. Generic Open Graph / Twitter-card scrape over the SSRF-safe {@link safeFetch}
 *      (head-bounded read that early-stops at `</head>`).
 *
 * Output is RAW metadata — `imageUrl` / `faviconUrl` are the absolute REMOTE
 * (origin) URLs. The link-preview service re-hosts them onto Oxy media before
 * returning anything to a client (privacy invariant). The resolver itself never
 * touches S3/CDN.
 *
 * SSRF: every outbound fetch (and every redirect hop) is validated and the TCP
 * connection pinned by {@link safeFetch}. There is no separate validate-then-fetch
 * window. The Bun `lookup {all:true}` array contract is owned inside safeFetch.
 */

/** The HTML head-close marker the streaming read stops at (ASCII, case-insensitive). */
const HEAD_CLOSE_MARKER = '</head>';

/** Browser-like UA so hosts that vary content for bots still serve OG tags. */
const SCRAPE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Matches any Google host (with or without a `www.` prefix), e.g. `google.com`, `www.google.co.uk`. */
const GOOGLE_HOST = /^(www\.)?google\.[a-z.]+$/;

/** Decode the common HTML entities that appear in OG/Twitter text fields. */
function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Read a single header value (collapsing the `string[] | undefined` shape). */
function headerStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Detect an anti-bot / consent / login interstitial page that serves a 200
 * response carrying no real Open Graph metadata. Following (or landing on) such
 * a page and parsing it caches junk — e.g. Google's `/sorry` wall renders the
 * request URL as its `<title>`, which then looks like a usable preview.
 *
 * Intentionally narrow so legitimate cross-domain redirects (`youtu.be` →
 * `youtube.com`) are still followed:
 *  - Google's `/sorry` anti-bot / CAPTCHA wall on any `google.<tld>` host.
 *  - Cookie-consent gates on any `consent.*` host.
 *  - The Google login wall at `accounts.google.com`.
 */
export function isBlockedInterstitialUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();

  if (GOOGLE_HOST.test(host) && url.pathname.toLowerCase().startsWith('/sorry')) {
    return true;
  }
  if (host.startsWith('consent.')) {
    return true;
  }
  if (host === 'accounts.google.com') {
    return true;
  }
  return false;
}

/** Normalize a raw input URL, defaulting a missing scheme to `https://`. */
export function normalizeUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  let normalized = url.trim();
  if (!normalized) return null;
  if (normalized.length > LINK_PREVIEW_MAX_URL_LENGTH) return null;

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function extractSiteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

/** Resolve a possibly-relative image/favicon URL against the page's base URL. */
function resolveAbsoluteUrl(value: string, baseUrl: string): string {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const base = new URL(baseUrl);
    if (trimmed.startsWith('//')) return `${base.protocol}${trimmed}`;
    if (trimmed.startsWith('/')) return `${base.protocol}//${base.host}${trimmed}`;
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return value;
  }
}

/**
 * Read a bounded amount of the response body for metadata extraction.
 *
 * Two early-stop conditions, both RESOLVING (never rejecting) so the parser
 * always receives whatever was read:
 *  - `</head>` appears → destroy the stream and resolve (all metadata lives in
 *    the head). Match is case-insensitive and boundary-safe (a small carryover
 *    from the previous chunk is searched together with the current one).
 *  - byte cap → resolve the truncated buffer.
 */
function readLimitedHtml(response: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    const carrySize = HEAD_CLOSE_MARKER.length - 1;
    let carry: Buffer = Buffer.alloc(0);

    const finish = (): void => {
      if (settled) return;
      settled = true;
      response.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    response.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalSize += chunk.length;
      chunks.push(chunk);

      const window = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      if (window.toString('latin1').toLowerCase().includes(HEAD_CLOSE_MARKER)) {
        finish();
        return;
      }
      carry = window.length > carrySize ? window.subarray(window.length - carrySize) : window;

      if (totalSize > maxBytes) {
        finish();
      }
    });
    response.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    response.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

/** Extract `<title>` + meta/link tags from the HTML head (regex; no full DOM parse). */
function extractMetadataFromHtml(html: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch?.[1] ?? html.slice(0, 128 * 1024);
  const attrPattern = /([a-zA-Z_:.-]+)\s*=\s*(["'])(.*?)\2/g;

  for (const tagMatch of head.matchAll(
    /<(title|meta|link)\b[^>]*>([\s\S]*?)<\/\1>|<(meta|link)\b[^>]*\/?\s*>/gi,
  )) {
    const fullTag = tagMatch[0];
    const tagName = (tagMatch[1] || tagMatch[3] || '').toLowerCase();
    if (tagName === 'title') {
      metadata.title = decodeHtmlEntities(tagMatch[2] || '');
      continue;
    }

    const attrs: Record<string, string> = {};
    attrPattern.lastIndex = 0;
    for (const attr of fullTag.matchAll(attrPattern)) {
      attrs[attr[1].toLowerCase()] = decodeHtmlEntities(attr[3]);
    }

    if (tagName === 'meta') {
      const key = attrs.property || attrs.name;
      if (key && attrs.content) metadata[key.toLowerCase()] = attrs.content;
    } else if (tagName === 'link' && attrs.rel?.toLowerCase().includes('icon') && attrs.href) {
      metadata.favicon = attrs.href;
    }
  }

  return metadata;
}

/**
 * Fetch a page and extract its head metadata. `safeFetch` follows (and
 * re-validates) redirects internally, so this checks the interstitial guard on
 * BOTH the input URL (before fetching) and the final resolved URL (after).
 *
 * @throws on an interstitial wall, an SSRF rejection, or a transport/timeout
 *   failure. A non-2xx or non-HTML response resolves to empty metadata.
 */
async function fetchMetadataDocument(
  initialUrl: string,
): Promise<{ metadata: Record<string, string>; finalUrl: string }> {
  let parsedInput: URL;
  try {
    parsedInput = new URL(initialUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (isBlockedInterstitialUrl(parsedInput)) {
    throw new Error(`Blocked interstitial page: ${parsedInput.hostname}${parsedInput.pathname}`);
  }

  let result: SafeFetchResult;
  try {
    result = await safeFetch(initialUrl, {
      method: 'GET',
      headers: {
        'User-Agent': SCRAPE_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Encoding': 'identity',
      },
      headersTimeoutMs: LINK_PREVIEW_TIMEOUT_MS,
      signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof SsrfRejection) {
      logger.warn('[linkPreviewResolver] page fetch blocked by SSRF guard', {
        url: initialUrl,
        reason: error.message,
      });
      throw new Error('URL security validation failed');
    }
    throw error;
  }

  const { response, status, headers } = result;
  try {
    let finalParsed: URL;
    try {
      finalParsed = new URL(result.finalUrl);
    } catch {
      finalParsed = parsedInput;
    }
    if (isBlockedInterstitialUrl(finalParsed)) {
      throw new Error(`Blocked interstitial page: ${finalParsed.hostname}${finalParsed.pathname}`);
    }

    if (status < 200 || status >= 300) {
      return { metadata: {}, finalUrl: result.finalUrl };
    }

    const contentType = headerStr((headers as IncomingHttpHeaders)['content-type']).toLowerCase();
    if (contentType && !contentType.includes('html')) {
      return { metadata: {}, finalUrl: result.finalUrl };
    }

    const html = await readLimitedHtml(response, LINK_PREVIEW_HTML_MAX_BYTES);
    return { metadata: extractMetadataFromHtml(html), finalUrl: result.finalUrl };
  } finally {
    response.destroy();
  }
}

/** Decode + absolutize the raw metadata fields. */
function finalize(result: RawLinkMetadata, baseUrl: string): RawLinkMetadata {
  if (result.title) result.title = decodeHtmlEntities(result.title);
  if (result.description) result.description = decodeHtmlEntities(result.description);
  if (result.siteName) result.siteName = decodeHtmlEntities(result.siteName);
  if (result.imageUrl) result.imageUrl = resolveAbsoluteUrl(result.imageUrl, baseUrl);
  if (result.faviconUrl) result.faviconUrl = resolveAbsoluteUrl(result.faviconUrl, baseUrl);
  return result;
}

/**
 * Run the ordered oEmbed provider chain. Returns the first matching provider's
 * resolved metadata, or `null` when no provider matches / the provider yields
 * nothing (caller falls through to the generic scrape). When the provider
 * result carries no description, a best-effort generic OG scrape fills it; any
 * failure leaves the description undefined and never fails the provider result.
 */
async function resolveViaProvider(normalizedUrl: string): Promise<RawLinkMetadata | null> {
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  const provider = linkMetadataProviders.find((candidate) => candidate.matches(parsed));
  if (!provider) return null;

  let result: RawLinkMetadata | null;
  try {
    result = await provider.resolve(parsed);
  } catch (error) {
    logger.warn('[linkPreviewResolver] oEmbed provider failed; falling back to generic scrape', {
      provider: provider.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!result) return null;

  if (!result.description) {
    try {
      const { metadata } = await fetchMetadataDocument(result.url);
      const description = metadata['og:description'] || metadata['twitter:description'];
      if (description && description.trim().length > 0) {
        result.description = description;
      }
    } catch (error) {
      logger.debug('[linkPreviewResolver] provider description enrichment skipped', {
        url: result.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Resolve RAW link metadata for a NORMALIZED URL. Throws on a hard failure
 * (invalid URL, interstitial wall, SSRF rejection, timeout) so the caller marks
 * the URL empty/negative; returns raw metadata (possibly sparse) on success.
 */
export async function resolveLinkMetadata(normalizedUrl: string): Promise<RawLinkMetadata> {
  const providerResult = await resolveViaProvider(normalizedUrl);
  if (providerResult) {
    return finalize(providerResult, providerResult.url);
  }

  const { metadata, finalUrl } = await fetchMetadataDocument(normalizedUrl);
  const result: RawLinkMetadata = {
    url: finalUrl,
    title: metadata.title || metadata['og:title'] || metadata['twitter:title'],
    description:
      metadata.description || metadata['og:description'] || metadata['twitter:description'],
    imageUrl: metadata['og:image'] || metadata['twitter:image'] || metadata.image,
    siteName: metadata['og:site_name'] || extractSiteName(finalUrl),
    faviconUrl: metadata.favicon,
  };
  return finalize(result, finalUrl);
}
