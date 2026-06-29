/**
 * Link-preview SERVICE tests — the privacy invariant end to end and the batch
 * response shape.
 *
 * Mocked: the resolver (so no real network for metadata), the Mongo model, the
 * asset service (re-host + CDN resolve), the warm queue, and `safeFetch` (the
 * image download). The Redis cache is the REAL module but degrades to a no-op
 * with REDIS_URL unset.
 */
import { Readable } from 'stream';
import { createHash } from 'node:crypto';

delete process.env.REDIS_URL;

const mockResolveLinkMetadata = jest.fn();
const mockSafeFetch = jest.fn();
const mockUpload = jest.fn();
const mockGetPublicCdnUrl = jest.fn();
const mockEnqueueWarm = jest.fn();
const mockFindById = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockFind = jest.fn();

jest.mock('../linkMetadataResolver', () => ({
  resolveLinkMetadata: (...args: unknown[]) => mockResolveLinkMetadata(...args),
  normalizeUrl: (url: string) => url, // identity — tests pass already-normalized URLs
}));

jest.mock('@oxyhq/core/server', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  SsrfRejection: class SsrfRejection extends Error {},
}));

jest.mock('../../assetServiceSingleton', () => ({
  assetService: {
    uploadLinkPreviewImageStream: (...args: unknown[]) => mockUpload(...args),
    getPublicCdnUrl: (...args: unknown[]) => mockGetPublicCdnUrl(...args),
  },
}));

jest.mock('../../../queue/linkPreviewWarm.queue', () => ({
  enqueueLinkPreviewWarm: (...args: unknown[]) => mockEnqueueWarm(...args),
}));

jest.mock('../../../models/LinkPreview', () => ({
  LinkPreview: {
    findById: (...args: unknown[]) => mockFindById(...args),
    findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args),
    find: (...args: unknown[]) => mockFind(...args),
  },
}));

import { linkPreviewService } from '../linkPreviewService';
import {
  LINK_PREVIEW_MAX_URL_LENGTH,
  LINK_PREVIEW_SYNC_MAX_CONCURRENCY,
} from '../constants';

function imageResponse(): unknown {
  return {
    response: Readable.from([Buffer.from('PNGDATA')]),
    status: 200,
    headers: { 'content-type': 'image/png' },
    finalUrl: 'https://cdn.evil.com/og.png',
  };
}

// Echo the upsert back as the "saved" document (apply $set, drop $unset).
function echoUpsert(id: string, update: { $set?: Record<string, unknown>; $unset?: Record<string, string> }) {
  const docObj: Record<string, unknown> = { _id: id, ...(update.$set ?? {}) };
  for (const key of Object.keys(update.$unset ?? {})) delete docObj[key];
  return Promise.resolve(docObj);
}

beforeEach(() => {
  mockResolveLinkMetadata.mockReset();
  mockSafeFetch.mockReset();
  mockUpload.mockReset();
  mockGetPublicCdnUrl.mockReset();
  mockEnqueueWarm.mockReset();
  mockFindById.mockReset();
  mockFindByIdAndUpdate.mockReset();
  mockFind.mockReset();
  mockFindByIdAndUpdate.mockImplementation((id: string, update) => echoUpsert(id, update));
});

describe('resolveAndStore — privacy invariant', () => {
  it('OMITS image (never the origin URL) when re-host fails, and stores the origin server-side', async () => {
    mockResolveLinkMetadata.mockResolvedValueOnce({
      url: 'https://ex.com/a',
      title: 'Title',
      description: 'Desc',
      siteName: 'Ex',
      imageUrl: 'https://cdn.evil.com/og.png',
    });
    mockSafeFetch.mockResolvedValueOnce(imageResponse());
    // Re-host throws — but must drain the stream it was handed.
    mockUpload.mockImplementationOnce((src: Readable) => {
      src.resume();
      return Promise.reject(new Error('rehost boom'));
    });

    const dto = await linkPreviewService.resolveAndStore('https://ex.com/a');

    // Usable (has title + description) → resolved, but with NO image this round.
    expect(dto.status).toBe('resolved');
    expect(dto.image).toBeUndefined();
    expect('image' in dto).toBe(false);
    // The origin image URL must never appear in the client DTO.
    expect(JSON.stringify(dto)).not.toContain('evil.com');

    // ...but it IS persisted server-side for re-host on the next refresh.
    const update = mockFindByIdAndUpdate.mock.calls[0][1];
    expect(update.$set.originImageUrl).toBe('https://cdn.evil.com/og.png');
    expect(update.$unset.imageUrl).toBe('');
  });

  it('returns a cloud.oxy.so by-id image URL when re-host succeeds', async () => {
    mockResolveLinkMetadata.mockResolvedValueOnce({
      url: 'https://ex.com/a',
      title: 'Title',
      imageUrl: 'https://cdn.evil.com/og.png',
    });
    mockSafeFetch.mockResolvedValueOnce(imageResponse());
    mockUpload.mockImplementationOnce((src: Readable) => {
      src.resume();
      return Promise.resolve({ _id: 'file123' });
    });
    mockGetPublicCdnUrl.mockResolvedValueOnce('https://cloud.oxy.so/content/2026/01/abc.png');

    const dto = await linkPreviewService.resolveAndStore('https://ex.com/a');

    expect(dto.status).toBe('resolved');
    expect(dto.image).toMatch(/\/file123$/);
    expect(dto.image?.startsWith('http')).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('evil.com');
  });

  it('stores empty + omits image when the resolver throws', async () => {
    mockResolveLinkMetadata.mockRejectedValueOnce(new Error('timeout'));

    const dto = await linkPreviewService.resolveAndStore('https://dead.example/x');

    expect(dto.status).toBe('empty');
    expect(dto.image).toBeUndefined();
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});

describe('getBatch — response shape', () => {
  it('keys by requested url and returns pending for misses (warming them)', async () => {
    mockFind.mockResolvedValueOnce([]); // no stored docs

    const data = await linkPreviewService.getBatch(['https://a.com', 'https://b.com']);

    expect(Object.keys(data).sort()).toEqual(['https://a.com', 'https://b.com']);
    expect(data['https://a.com']).toEqual({ url: 'https://a.com', status: 'pending' });
    expect(data['https://b.com']).toEqual({ url: 'https://b.com', status: 'pending' });
    expect(mockEnqueueWarm).toHaveBeenCalledTimes(2);
  });

  it('returns a fresh stored doc without warming', async () => {
    const url = 'https://fresh.example/post';
    const id = createHash('sha256').update(url).digest('hex');
    mockFind.mockResolvedValueOnce([
      {
        _id: id,
        requestedUrl: url,
        canonicalUrl: url,
        title: 'Fresh',
        imageUrl: 'https://cloud.oxy.so/file999',
        status: 'resolved',
        version: 1,
        resolvedAt: new Date(),
      },
    ]);

    const data = await linkPreviewService.getBatch([url]);

    expect(data[url].status).toBe('resolved');
    expect(data[url].title).toBe('Fresh');
    expect(data[url].image).toBe('https://cloud.oxy.so/file999');
    expect(mockEnqueueWarm).not.toHaveBeenCalled();
  });

  it('drops an oversized batch url to empty WITHOUT warming or fetching', async () => {
    mockFind.mockResolvedValueOnce([]);
    const longUrl = `https://x.com/${'a'.repeat(LINK_PREVIEW_MAX_URL_LENGTH + 100)}`;

    const data = await linkPreviewService.getBatch([longUrl, 'https://ok.com/p']);

    expect(data[longUrl]).toEqual({ url: longUrl, status: 'empty' });
    expect(data['https://ok.com/p'].status).toBe('pending');
    // Only the valid url was warmed — the oversized one costs no resolve work.
    expect(mockEnqueueWarm).toHaveBeenCalledTimes(1);
    expect(mockEnqueueWarm).toHaveBeenCalledWith('https://ok.com/p');
  });
});

describe('get — wait=1 concurrency ceiling', () => {
  it('degrades wait=1 to pending when the sync-concurrency ceiling is saturated', async () => {
    mockFindById.mockResolvedValue(null);

    // A resolve that parks until released, shared by every held synchronous
    // resolve so they all hold their slot simultaneously.
    let release: (value: unknown) => void = () => undefined;
    const parked = new Promise((res) => {
      release = res;
    });
    mockResolveLinkMetadata.mockReturnValue(parked);

    // Saturate every synchronous-resolve slot.
    const held: Promise<unknown>[] = [];
    for (let i = 0; i < LINK_PREVIEW_SYNC_MAX_CONCURRENCY; i++) {
      held.push(linkPreviewService.get(`https://held-${i}.example/x`, { wait: true }));
    }
    // Let each held get acquire its slot and park on the resolve.
    await new Promise((r) => setImmediate(r));

    // The next wait=1 finds no free slot → background warm + immediate pending.
    const degraded = await linkPreviewService.get('https://overflow.example/x', { wait: true });
    expect(degraded).toEqual({ url: 'https://overflow.example/x', status: 'pending' });
    expect(mockEnqueueWarm).toHaveBeenCalledWith('https://overflow.example/x');

    // Release the held resolves so slots free and nothing leaks.
    release({ url: 'https://held.example/x', title: 'X' });
    await Promise.all(held);
  });
});
