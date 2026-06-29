/**
 * Serializer tests — the privacy invariant at the mapping layer: the client DTO
 * NEVER carries the server-only `originImageUrl` / `originFaviconUrl`, and
 * `image` / `favicon` come only from the Oxy-hosted columns.
 */
import { serializeLinkPreview } from '../linkPreviewSerializer';
import type { ILinkPreview } from '../../../models/LinkPreview';

function doc(over: Partial<ILinkPreview>): ILinkPreview {
  return {
    _id: 'hash',
    requestedUrl: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    status: 'resolved',
    version: 1,
    resolvedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as ILinkPreview;
}

describe('serializeLinkPreview', () => {
  it('maps Oxy-hosted image/favicon and NEVER the origin URLs', () => {
    const dto = serializeLinkPreview(
      doc({
        title: 'T',
        description: 'D',
        siteName: 'S',
        imageUrl: 'https://cloud.oxy.so/file123',
        favicon: 'https://cloud.oxy.so/fav456',
        // server-only fields that must never leak:
        originImageUrl: 'https://tracker.evil.com/og.png',
        originFaviconUrl: 'https://tracker.evil.com/fav.ico',
      }),
    );

    expect(dto.image).toBe('https://cloud.oxy.so/file123');
    expect(dto.favicon).toBe('https://cloud.oxy.so/fav456');
    expect(dto.resolvedAt).toBe('2026-01-01T00:00:00.000Z');

    // The origin URLs must not appear anywhere in the serialized output.
    expect('originImageUrl' in dto).toBe(false);
    expect('originFaviconUrl' in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain('evil.com');
  });

  it('omits resolvedAt for a non-resolved preview', () => {
    const dto = serializeLinkPreview(doc({ status: 'empty', imageUrl: undefined }));
    expect(dto.status).toBe('empty');
    expect(dto.resolvedAt).toBeUndefined();
    expect(dto.image).toBeUndefined();
  });

  it('falls back to requestedUrl when canonicalUrl is empty', () => {
    const dto = serializeLinkPreview(doc({ canonicalUrl: '' }));
    expect(dto.url).toBe('https://example.com/a');
  });
});
