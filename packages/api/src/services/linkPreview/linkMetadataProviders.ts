import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { safeFetch, SsrfRejection, type SafeFetchResult } from '@oxyhq/core/server';
import { logger } from '../../utils/logger';
import { LINK_PREVIEW_TIMEOUT_MS } from './constants';
import type { RawLinkMetadata } from './types';

/**
 * Server-side oEmbed provider layer for link previews (ported from Mention).
 *
 * YouTube / Spotify (and others) anti-bot-wall HTML scrapes coming from a
 * datacenter IP (`google.com/sorry`, consent gates), which leaves only a hollow
 * hostname-only preview. Their OFFICIAL oEmbed endpoints return canonical
 * title/thumbnail metadata server-side and never trip those walls.
 *
 * This sits IN FRONT of the generic Open Graph scraper: the first provider whose
 * {@link LinkMetadataProvider.matches | matches} is true gets to
 * {@link LinkMetadataProvider.resolve | resolve} the URL; a `null` result falls
 * through to the generic scrape unchanged.
 *
 * Every fetch stays SERVER-SIDE over the SSRF-safe {@link safeFetch}. We only
 * consume title/image/description metadata (NO iframe or player is embedded).
 * Provider thumbnails are returned RAW here; the service re-hosts them onto Oxy
 * media exactly like an og:image, so privacy is preserved.
 */
export interface LinkMetadataProvider {
  /** Stable provider id (used in logs): `'youtube' | 'vimeo' | 'spotify'`. */
  readonly id: string;
  /** Cheap host/path test — NO network. */
  matches(url: URL): boolean;
  /**
   * Resolve metadata via the provider's official oEmbed endpoint. Returns `null`
   * to fall through to the generic scraper (no extractable id, private/unknown
   * media, or an oEmbed fetch/parse failure).
   */
  resolve(url: URL): Promise<RawLinkMetadata | null>;
}

/**
 * Hard cap on bytes read from an oEmbed response. oEmbed JSON payloads are tiny
 * (well under a KB); 64 KB is a generous ceiling that bounds worst-case memory
 * for a misbehaving endpoint without ever truncating a real response.
 */
const OEMBED_MAX_BYTES = 64 * 1024;

/** User-Agent presented to provider oEmbed endpoints. */
const OEMBED_USER_AGENT = 'Mozilla/5.0 (compatible; OxyLinkPreview/1.0; +https://oxy.so)';

/** The subset of oEmbed fields we consume (all optional, all string). */
interface OembedResponse {
  title?: string;
  description?: string;
  author_name?: string;
  thumbnail_url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read a non-empty string field from a parsed object, else `undefined`. */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Parse an oEmbed JSON body into the typed subset; `null` on non-object/invalid JSON. */
function parseOembed(raw: string): OembedResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return {
    title: readString(parsed, 'title'),
    description: readString(parsed, 'description'),
    author_name: readString(parsed, 'author_name'),
    thumbnail_url: readString(parsed, 'thumbnail_url'),
  };
}

/** Read a bounded prefix of the response body as a UTF-8 string. */
async function readLimitedJson(response: IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

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
      if (totalSize > maxBytes) finish();
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

/**
 * Fetch and parse a provider oEmbed endpoint over the SSRF-safe {@link safeFetch}.
 * Returns `null` on any non-2xx status (e.g. 401/404 private/unknown media),
 * parse failure, or transport error — the caller then falls through to the
 * generic scrape.
 */
async function fetchOembed(endpoint: string): Promise<OembedResponse | null> {
  let result: SafeFetchResult;
  try {
    result = await safeFetch(endpoint, {
      method: 'GET',
      headers: {
        'User-Agent': OEMBED_USER_AGENT,
        Accept: 'application/json, text/javascript, */*;q=0.1',
        'Accept-Encoding': 'identity',
      },
      headersTimeoutMs: LINK_PREVIEW_TIMEOUT_MS,
      signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof SsrfRejection) {
      logger.warn('[linkPreviewProviders] oEmbed endpoint blocked by SSRF guard', {
        endpoint,
        reason: error.message,
      });
      return null;
    }
    logger.debug('[linkPreviewProviders] oEmbed request failed', {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  try {
    if (result.status < 200 || result.status >= 300) {
      result.response.destroy();
      return null;
    }
    const body = await readLimitedJson(result.response, OEMBED_MAX_BYTES);
    return parseOembed(body);
  } catch (error) {
    logger.debug('[linkPreviewProviders] oEmbed body read failed', {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

/** Path prefixes whose next segment is the video id: `/shorts/<id>`, `/embed/<id>`, `/live/<id>`. */
const YOUTUBE_ID_PATH_PREFIXES: ReadonlySet<string> = new Set(['shorts', 'embed', 'live']);

/** YouTube video ids are exactly 11 base64url (`[A-Za-z0-9_-]`) characters. */
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isValidYoutubeId(value: string | undefined): value is string {
  return typeof value === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

/**
 * Extract the 11-char YouTube video id from any of the canonical URL shapes:
 * `youtu.be/<id>`, `watch?v=<id>`, `/shorts/<id>`, `/embed/<id>`, `/live/<id>`
 * (extra params such as `?si=`/`&t=` are ignored). Returns `null` for any URL
 * that is not a single-video page.
 */
export function extractYoutubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const [first] = url.pathname.split('/').filter(Boolean);
    return isValidYoutubeId(first) ? first : null;
  }

  const fromQuery = url.searchParams.get('v') ?? undefined;
  if (isValidYoutubeId(fromQuery)) return fromQuery;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && YOUTUBE_ID_PATH_PREFIXES.has(segments[0].toLowerCase())) {
    return isValidYoutubeId(segments[1]) ? segments[1] : null;
  }

  return null;
}

const youtubeProvider: LinkMetadataProvider = {
  id: 'youtube',
  matches(url: URL): boolean {
    return YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
  },
  async resolve(url: URL): Promise<RawLinkMetadata | null> {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) return null;

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembed = await fetchOembed(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    );
    if (!oembed) return null;

    // YouTube oEmbed carries no description; the resolver fills it best-effort
    // off the response path.
    const result: RawLinkMetadata = { url: watchUrl, siteName: 'YouTube' };
    if (oembed.title) result.title = oembed.title;
    if (oembed.thumbnail_url) result.imageUrl = oembed.thumbnail_url;
    return result;
  },
};

const VIMEO_HOSTS: ReadonlySet<string> = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

const vimeoProvider: LinkMetadataProvider = {
  id: 'vimeo',
  matches(url: URL): boolean {
    return VIMEO_HOSTS.has(url.hostname.toLowerCase());
  },
  async resolve(url: URL): Promise<RawLinkMetadata | null> {
    const oembed = await fetchOembed(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url.toString())}`,
    );
    if (!oembed) return null;

    // Vimeo oEmbed includes a description — set it directly.
    const result: RawLinkMetadata = { url: url.toString(), siteName: 'Vimeo' };
    if (oembed.title) result.title = oembed.title;
    if (oembed.description) result.description = oembed.description;
    if (oembed.thumbnail_url) result.imageUrl = oembed.thumbnail_url;
    return result;
  },
};

const SPOTIFY_HOSTS: ReadonlySet<string> = new Set(['open.spotify.com']);

const spotifyProvider: LinkMetadataProvider = {
  id: 'spotify',
  matches(url: URL): boolean {
    return SPOTIFY_HOSTS.has(url.hostname.toLowerCase());
  },
  async resolve(url: URL): Promise<RawLinkMetadata | null> {
    const oembed = await fetchOembed(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url.toString())}`,
    );
    if (!oembed) return null;

    // Spotify oEmbed carries no description; the resolver fills it best-effort
    // off the response path.
    const result: RawLinkMetadata = { url: url.toString(), siteName: 'Spotify' };
    if (oembed.title) result.title = oembed.title;
    if (oembed.thumbnail_url) result.imageUrl = oembed.thumbnail_url;
    return result;
  },
};

/** Ordered oEmbed provider registry consulted before the generic scrape. */
export const linkMetadataProviders: LinkMetadataProvider[] = [
  youtubeProvider,
  vimeoProvider,
  spotifyProvider,
];
