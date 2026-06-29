/**
 * Batch hot-read (`readHotPreviews`) tests — locks the MGET refactor's semantics
 * (two MGETs instead of a per-URL GET+EXISTS fan-out) with a faked ready Redis.
 */
const mockMget = jest.fn();

jest.mock('../../../config/redis', () => ({
  getRedisClient: () => ({ status: 'ready', mget: (...a: unknown[]) => mockMget(...a) }),
}));

import { readHotPreviews } from '../linkPreviewCache';

const validDto = { url: 'https://hit.com', status: 'resolved', title: 'A' };

beforeEach(() => mockMget.mockReset());

describe('readHotPreviews (MGET)', () => {
  it('zips hot hits, negatives, misses, and invalid entries correctly', async () => {
    const urls = ['https://hit.com', 'https://neg.com', 'https://miss.com', 'https://bad.com'];
    // Promise.all order: first mget = hot keys, second = negative keys.
    mockMget
      .mockResolvedValueOnce([JSON.stringify(validDto), null, null, '{"url":"x"}']) // hot vals (bad = no status)
      .mockResolvedValueOnce([null, '1', null, null]); // neg vals (neg.com marked)

    const { previews, misses } = await readHotPreviews(urls);

    expect(previews.get('https://hit.com')).toEqual(validDto);
    expect(previews.get('https://neg.com')).toEqual({ url: 'https://neg.com', status: 'empty' });
    // A miss and a contract-invalid hot entry both become misses (re-warmed).
    expect(misses.sort()).toEqual(['https://bad.com', 'https://miss.com']);
    expect(previews.has('https://miss.com')).toBe(false);
    expect(previews.has('https://bad.com')).toBe(false);
  });

  it('issues exactly two MGETs (not a per-URL fan-out)', async () => {
    mockMget.mockResolvedValue([null, null]);
    await readHotPreviews(['https://a.com', 'https://b.com']);
    expect(mockMget).toHaveBeenCalledTimes(2);
  });

  it('degrades every URL to a miss on a Redis error', async () => {
    mockMget.mockRejectedValue(new Error('redis down'));
    const { previews, misses } = await readHotPreviews(['https://a.com', 'https://b.com']);
    expect(previews.size).toBe(0);
    expect(misses).toEqual(['https://a.com', 'https://b.com']);
  });

  it('returns empty for an empty input without touching Redis', async () => {
    const { previews, misses } = await readHotPreviews([]);
    expect(previews.size).toBe(0);
    expect(misses).toEqual([]);
    expect(mockMget).not.toHaveBeenCalled();
  });
});
