/**
 * `isUsablePreview` gate tests (no Redis required — the cache degrades to no-op
 * without REDIS_URL; this function is pure).
 */
import { isUsablePreview } from '../linkPreviewCache';

describe('isUsablePreview', () => {
  it('is usable with an image', () => {
    expect(isUsablePreview({ image: 'https://cloud.oxy.so/abc' })).toBe(true);
  });
  it('is usable with a description', () => {
    expect(isUsablePreview({ description: 'hello' })).toBe(true);
  });
  it('is usable with a meaningful title', () => {
    expect(isUsablePreview({ title: 'A Real Headline', url: 'https://example.com/a' })).toBe(true);
  });
  it('rejects a title that is just the hostname', () => {
    expect(isUsablePreview({ title: 'example.com', url: 'https://example.com/a' })).toBe(false);
    expect(isUsablePreview({ title: 'www.example.com', url: 'https://www.example.com/a' })).toBe(
      false,
    );
  });
  it('rejects a title that is itself a URL', () => {
    expect(isUsablePreview({ title: 'https://example.com/a', url: 'https://example.com/a' })).toBe(
      false,
    );
  });
  it('rejects a fully empty preview', () => {
    expect(isUsablePreview({ url: 'https://example.com/a' })).toBe(false);
  });
});
