import { createHash } from 'node:crypto';
import type { UpdateQuery } from 'mongoose';
import { safeFetch, SsrfRejection, type SafeFetchResult } from '@oxyhq/core/server';
import type { LinkPreview } from '@oxyhq/contracts';
import { LinkPreview as LinkPreviewModel, type ILinkPreview } from '../../models/LinkPreview';
import { assetService } from '../assetServiceSingleton';
import { getAssetCdnUrl } from '../../config/cdn';
import { isAllowedCacheMime } from '../../constants/federationCache';
import { logger } from '../../utils/logger';
import { enqueueLinkPreviewWarm } from '../../queue/linkPreviewWarm.queue';
import { resolveLinkMetadata, normalizeUrl } from './linkMetadataResolver';
import { serializeLinkPreview } from './linkPreviewSerializer';
import {
  acquireResolveLock,
  isUsablePreview,
  markNegative,
  readHotPreview,
  readHotPreviews,
  releaseResolveLock,
  storeHotPreview,
} from './linkPreviewCache';
import {
  LINK_PREVIEW_IMAGE_MAX_BYTES,
  LINK_PREVIEW_MAX_URL_LENGTH,
  LINK_PREVIEW_REFRESH_TTL_SECONDS,
  LINK_PREVIEW_RESOLVER_VERSION,
  LINK_PREVIEW_SYNC_MAX_CONCURRENCY,
  LINK_PREVIEW_TIMEOUT_MS,
} from './constants';

/**
 * The ecosystem link-preview (URL unfurl) service.
 *
 * Read paths NEVER block on a remote fetch: a first-seen URL returns
 * `status:'pending'` immediately and is resolved in the background; a stored
 * preview is returned stale-while-revalidate. Only the explicit `wait` path
 * (compose-time) performs a bounded synchronous resolve.
 *
 * PRIVACY INVARIANT (enforced here + in the serializer + in the model):
 *  - The OG/oEmbed image is downloaded ONCE, server-side, over the SSRF-safe
 *    {@link safeFetch}, then re-hosted onto Oxy media; the client-facing
 *    `image` is ALWAYS a `cloud.oxy.so` URL, set only when re-host succeeds.
 *  - If re-host fails, `image` is OMITTED (retried on next warm) — the raw
 *    origin URL is NEVER returned to a client. It lives only in the server-only
 *    `originImageUrl` column.
 */
class LinkPreviewService {
  /**
   * Count of in-flight synchronous (`wait=1`) resolves, server-wide (this is a
   * process singleton). The `wait=1` path runs inline on the request, bypassing
   * the bounded warm worker, so it needs its OWN ceiling: without it, distributed
   * callers could pin an unbounded number of slow resolves + sockets open.
   */
  private syncInFlight = 0;

  /**
   * Try to claim a synchronous-resolve slot. Returns `true` (slot taken — caller
   * MUST release) or `false` when the {@link LINK_PREVIEW_SYNC_MAX_CONCURRENCY}
   * ceiling is saturated (caller degrades to a background warm).
   */
  private tryAcquireSyncSlot(): boolean {
    if (this.syncInFlight >= LINK_PREVIEW_SYNC_MAX_CONCURRENCY) return false;
    this.syncInFlight += 1;
    return true;
  }

  /** Release a previously claimed synchronous-resolve slot. */
  private releaseSyncSlot(): void {
    if (this.syncInFlight > 0) this.syncInFlight -= 1;
  }

  /** Primary key = SHA-256 hex of the normalized URL. */
  private hash(normalizedUrl: string): string {
    return createHash('sha256').update(normalizedUrl).digest('hex');
  }

  /** A stored preview is fresh while its version matches and it is within the refresh TTL. */
  private isFresh(doc: Pick<ILinkPreview, 'version' | 'resolvedAt'>): boolean {
    if (doc.version < LINK_PREVIEW_RESOLVER_VERSION) return false;
    if (!doc.resolvedAt) return false;
    const ageSeconds = (Date.now() - doc.resolvedAt.getTime()) / 1000;
    return ageSeconds < LINK_PREVIEW_REFRESH_TTL_SECONDS;
  }

  /** A `cloud.oxy.so/<fileId>` by-id URL (resolves via `GET /cdn/:id`). */
  private cdnByIdUrl(fileId: string): string {
    return `${getAssetCdnUrl()}/${fileId}`;
  }

  /**
   * Resolve a single URL for the `GET /links/preview` endpoint.
   *
   * - Hot cache / fresh Mongo doc → return it.
   * - `wait` → bounded synchronous resolve UNDER the server-wide concurrency
   *   ceiling; if that ceiling is saturated, degrade gracefully (no block, no
   *   error) to a background warm + the current best.
   * - otherwise → enqueue a background warm and return the stale doc (if any) or
   *   a `pending` placeholder.
   */
  async get(requestedUrl: string, opts: { wait: boolean }): Promise<LinkPreview> {
    const normalized = normalizeUrl(requestedUrl);
    if (!normalized) {
      return { url: requestedUrl, status: 'empty' };
    }

    const hot = await readHotPreview(normalized);
    if (hot === 'negative') {
      return { url: normalized, status: 'empty' };
    }
    if (hot) {
      return hot;
    }

    const doc = await LinkPreviewModel.findById(this.hash(normalized));
    if (doc && this.isFresh(doc)) {
      const dto = serializeLinkPreview(doc);
      void storeHotPreview(normalized, dto);
      return dto;
    }

    // wait=1 runs a bounded inline resolve, but ONLY while a server-wide slot is
    // free. When saturated it falls through to the same degraded tail as wait=0
    // (background warm + current best) so a flood of slow synchronous resolves
    // can never pile up unbounded.
    if (opts.wait && this.tryAcquireSyncSlot()) {
      try {
        return await this.resolveAndStore(normalized);
      } finally {
        this.releaseSyncSlot();
      }
    }

    enqueueLinkPreviewWarm(normalized);
    return doc ? serializeLinkPreview(doc) : { url: normalized, status: 'pending' };
  }

  /**
   * Resolve a batch of URLs for `POST /links/previews`. The returned record is
   * keyed by the EXACT requested url (the string the caller sent), so a caller
   * can always look its own input back up; the canonical url is on each DTO.
   */
  async getBatch(requestedUrls: string[]): Promise<Record<string, LinkPreview>> {
    const out: Record<string, LinkPreview> = {};

    // requested → normalized (null when invalid). Dedupe the normalized set so a
    // batch with duplicate/variant URLs does one lookup + one warm per URL.
    const requestedToNorm = new Map<string, string | null>();
    const normToHash = new Map<string, string>();
    for (const requested of requestedUrls) {
      // Cheap per-element length cap (defense-in-depth alongside the contracts
      // schema): drop an oversized url to `empty` BEFORE any normalize/fetch
      // work so it never costs a resolve.
      if (requested.length > LINK_PREVIEW_MAX_URL_LENGTH) {
        requestedToNorm.set(requested, null);
        continue;
      }
      const normalized = normalizeUrl(requested);
      requestedToNorm.set(requested, normalized);
      if (normalized) normToHash.set(normalized, this.hash(normalized));
    }

    const { previews, misses } = await readHotPreviews([...normToHash.keys()]);
    const resolvedByNorm = new Map<string, LinkPreview>(previews);

    if (misses.length > 0) {
      const missHashes = misses.map((n) => normToHash.get(n)).filter((h): h is string => Boolean(h));
      const docs = missHashes.length
        ? await LinkPreviewModel.find({ _id: { $in: missHashes } })
        : [];
      const docByHash = new Map<string, ILinkPreview>(docs.map((d) => [d._id, d]));

      for (const normalized of misses) {
        const docHash = normToHash.get(normalized);
        const doc = docHash ? docByHash.get(docHash) : undefined;
        if (doc && this.isFresh(doc)) {
          const dto = serializeLinkPreview(doc);
          resolvedByNorm.set(normalized, dto);
          void storeHotPreview(normalized, dto);
        } else {
          enqueueLinkPreviewWarm(normalized);
          resolvedByNorm.set(
            normalized,
            doc ? serializeLinkPreview(doc) : { url: normalized, status: 'pending' },
          );
        }
      }
    }

    for (const [requested, normalized] of requestedToNorm) {
      out[requested] = normalized
        ? resolvedByNorm.get(normalized) ?? { url: normalized, status: 'pending' }
        : { url: requested, status: 'empty' };
    }

    return out;
  }

  /**
   * Fully resolve a NORMALIZED url and persist it: run the resolver pipeline,
   * re-host the image/favicon, upsert the Mongo doc, and update the caches.
   * Single-flight via the Redis resolve lock. Used by the warm worker and the
   * `wait=1` path. Never throws — a hard failure stores an `empty` preview.
   */
  async resolveAndStore(normalized: string): Promise<LinkPreview> {
    const locked = await acquireResolveLock(normalized);
    if (!locked) {
      // Another worker/instance is resolving this URL — return the current best.
      const existing = await LinkPreviewModel.findById(this.hash(normalized));
      return existing ? serializeLinkPreview(existing) : { url: normalized, status: 'pending' };
    }

    try {
      const raw = await resolveLinkMetadata(normalized).catch((error: unknown) => {
        logger.debug('[linkPreviewService] resolve failed; storing empty', {
          url: normalized,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

      if (!raw) {
        return this.storeEmpty(normalized);
      }

      // Re-host image + favicon server-side (privacy invariant). Each is
      // independent and best-effort; a failure omits that field this round.
      const [imageUrl, favicon] = await Promise.all([
        raw.imageUrl ? this.rehostImage(raw.imageUrl) : Promise.resolve(undefined),
        raw.faviconUrl ? this.rehostImage(raw.faviconUrl) : Promise.resolve(undefined),
      ]);

      const usable = isUsablePreview({
        title: raw.title,
        description: raw.description,
        image: imageUrl,
        url: raw.url,
      });
      const status: ILinkPreview['status'] = usable ? 'resolved' : 'empty';

      const set: Record<string, unknown> = {
        requestedUrl: normalized,
        canonicalUrl: raw.url || normalized,
        status,
        version: LINK_PREVIEW_RESOLVER_VERSION,
        resolvedAt: new Date(),
      };
      const unset: Record<string, ''> = {};
      const assign = (field: string, value: string | undefined): void => {
        if (value !== undefined && value !== null && value !== '') set[field] = value;
        else unset[field] = '';
      };
      assign('title', raw.title);
      assign('description', raw.description);
      assign('siteName', raw.siteName);
      assign('imageUrl', imageUrl);
      assign('favicon', favicon);
      assign('originImageUrl', raw.imageUrl);
      assign('originFaviconUrl', raw.faviconUrl);

      const update: UpdateQuery<ILinkPreview> = { $set: set };
      if (Object.keys(unset).length > 0) update.$unset = unset;

      const doc = await LinkPreviewModel.findByIdAndUpdate(this.hash(normalized), update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });

      const dto = serializeLinkPreview(doc ?? this.fallbackDoc(normalized, status));
      if (status === 'resolved') {
        await storeHotPreview(normalized, dto);
      } else {
        await markNegative(normalized);
      }
      return dto;
    } finally {
      await releaseResolveLock(normalized);
    }
  }

  /** Persist a hollow/failed resolution as an `empty` preview + negative marker. */
  private async storeEmpty(normalized: string): Promise<LinkPreview> {
    const update: UpdateQuery<ILinkPreview> = {
      $set: {
        requestedUrl: normalized,
        canonicalUrl: normalized,
        status: 'empty',
        version: LINK_PREVIEW_RESOLVER_VERSION,
        resolvedAt: new Date(),
      },
      $unset: {
        title: '',
        description: '',
        siteName: '',
        imageUrl: '',
        favicon: '',
        originImageUrl: '',
        originFaviconUrl: '',
      },
    };
    const doc = await LinkPreviewModel.findByIdAndUpdate(this.hash(normalized), update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    await markNegative(normalized);
    return serializeLinkPreview(doc ?? this.fallbackDoc(normalized, 'empty'));
  }

  /** Minimal in-memory doc for serialization when a write returned no document. */
  private fallbackDoc(normalized: string, status: ILinkPreview['status']): SerializableFallback {
    return {
      requestedUrl: normalized,
      canonicalUrl: normalized,
      status,
      resolvedAt: new Date(),
    };
  }

  /**
   * Download a remote image over the SSRF-safe {@link safeFetch} and re-host it
   * onto PUBLIC Oxy media, returning the `cloud.oxy.so/<fileId>` URL. Returns
   * `undefined` on ANY failure (blocked/non-image/oversized/transport/private
   * dedup) so the caller omits the image — the origin URL is never returned.
   */
  private async rehostImage(originUrl: string): Promise<string | undefined> {
    let result: SafeFetchResult;
    try {
      result = await safeFetch(originUrl, {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
          'User-Agent': 'OxyLinkPreview/1.0 (+https://oxy.so)',
        },
        headersTimeoutMs: LINK_PREVIEW_TIMEOUT_MS,
        signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof SsrfRejection) {
        logger.warn('[linkPreviewService] image re-host blocked by SSRF guard', {
          url: originUrl,
          reason: error.message,
        });
      } else {
        logger.debug('[linkPreviewService] image download failed', {
          url: originUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return undefined;
    }

    try {
      if (result.status < 200 || result.status >= 300) {
        result.response.destroy();
        return undefined;
      }
      const contentType = result.headers['content-type'];
      const mime = (Array.isArray(contentType) ? contentType[0] : contentType ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      // image/* only (and never SVG — isAllowedCacheMime rejects it as a stored-XSS vector).
      if (!mime.startsWith('image/') || !isAllowedCacheMime(mime)) {
        result.response.destroy();
        return undefined;
      }
      const lengthHeader = result.headers['content-length'];
      const declaredLength = Number(Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader);
      if (Number.isFinite(declaredLength) && declaredLength > LINK_PREVIEW_IMAGE_MAX_BYTES) {
        result.response.destroy();
        return undefined;
      }

      const file = await assetService.uploadLinkPreviewImageStream(
        result.response,
        mime,
        this.imageName(originUrl),
        LINK_PREVIEW_IMAGE_MAX_BYTES,
      );

      // Confirm the stored file is actually public + CDN-reachable before
      // handing out a by-id URL (a content-addressed dedup could, in theory,
      // match a pre-existing private file whose by-id URL would 404).
      const cdnUrl = await assetService.getPublicCdnUrl(file);
      if (!cdnUrl) {
        return undefined;
      }
      return this.cdnByIdUrl(file._id.toString());
    } catch (error) {
      logger.debug('[linkPreviewService] image re-host failed', {
        url: originUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /** A bounded, human-ish original name for the re-hosted image. */
  private imageName(originUrl: string): string {
    try {
      const { pathname } = new URL(originUrl);
      const base = pathname.split('/').filter(Boolean).pop();
      if (base && base.length > 0) return base.slice(0, 255);
    } catch {
      // fall through
    }
    return 'link-preview-image';
  }
}

/** The minimal shape the serializer needs when no Mongo document is available. */
type SerializableFallback = Pick<
  ILinkPreview,
  'requestedUrl' | 'canonicalUrl' | 'status' | 'resolvedAt'
>;

export const linkPreviewService = new LinkPreviewService();
