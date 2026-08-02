/**
 * `getServiceAssetMetadataBySha256` mixin tests (reverse content-address lookup).
 *
 * Stubs `makeServiceRequest` (the service-token transport used by the route's
 * `serviceAuthMiddleware` + `files:read` scope) so the tests run with no network
 * and no `getServiceToken()` round-trip, then asserts:
 *  - empty / whitespace / all-malformed input no-ops to `[]` with no network call;
 *  - hashes are lowercased, hex-validated (malformed dropped), and de-duplicated,
 *    and a single chunk is POSTed to `/assets/service/by-sha256` as `{ sha256s }`;
 *  - the `{ data }` envelope is unwrapped to a bare `ServiceAssetMetadataBySha[]`
 *    (mirroring how `makeServiceRequest<T[]>` returns the inner array), with the
 *    optional `url` preserved for public assets and absent for private ones;
 *  - inputs > 100 hashes are chunked at 100/request and merged;
 *  - a failed chunk is logged and skipped — successful chunks still return.
 */

import type { ServiceAssetMetadataBySha } from '../../models/interfaces';
import { OxyServices } from '../../OxyServices';

const publicEntry: ServiceAssetMetadataBySha = {
  sha256: 'a'.repeat(64),
  id: 'asset-1',
  mime: 'image/jpeg',
  size: 12345,
  status: 'active',
  url: 'https://cloud.oxy.so/content/2026/06/aa/abc.jpg',
};

const privateEntry: ServiceAssetMetadataBySha = {
  sha256: 'b'.repeat(64),
  id: 'asset-2',
  mime: 'application/octet-stream',
  size: 7,
  status: 'active',
  // no url — private/unlisted assets stream through the origin
};

describe('OxyServices.assets — getServiceAssetMetadataBySha256', () => {
  let oxy: OxyServices;
  let makeServiceRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeServiceRequestSpy = jest.spyOn(oxy, 'makeServiceRequest');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns [] and performs no network call for empty / malformed input', async () => {
    await expect(oxy.getServiceAssetMetadataBySha256([])).resolves.toEqual([]);
    // whitespace, wrong length, and non-hex are all dropped → no chunk to send
    await expect(
      oxy.getServiceAssetMetadataBySha256(['   ', 'zzz', 'a'.repeat(63), 'a'.repeat(65)]),
    ).resolves.toEqual([]);
    expect(makeServiceRequestSpy).not.toHaveBeenCalled();
  });

  it('lowercases, hex-validates, de-duplicates, and sends a single chunk', async () => {
    // makeServiceRequest unwraps the API's `{ data }` envelope, so the resolved
    // value is the bare array (NOT `{ data: [...] }`) — mirror that real shape.
    makeServiceRequestSpy.mockResolvedValueOnce([publicEntry, privateEntry]);

    const result = await oxy.getServiceAssetMetadataBySha256([
      'A'.repeat(64), // uppercase → normalized to 'a'*64
      'a'.repeat(64), // duplicate after lowercasing
      'B'.repeat(64),
      'not-hex', // dropped
      '   ', // dropped
    ]);

    expect(result).toEqual([publicEntry, privateEntry]);
    // public asset carries url; private one does not
    expect(result[0].url).toBe(publicEntry.url);
    expect(result[1].url).toBeUndefined();

    expect(makeServiceRequestSpy).toHaveBeenCalledTimes(1);
    expect(makeServiceRequestSpy).toHaveBeenCalledWith(
      'POST',
      '/assets/service/by-sha256',
      { sha256s: ['a'.repeat(64), 'b'.repeat(64)] },
    );
  });

  it('chunks at 100 hashes per request and merges each chunk', async () => {
    // 250 distinct valid hex digests.
    const shas = Array.from({ length: 250 }, (_, i) =>
      i.toString(16).padStart(64, '0'),
    );

    makeServiceRequestSpy.mockImplementation(
      async (
        _method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        _url: string,
        data?: { sha256s: string[] },
      ): Promise<ServiceAssetMetadataBySha[]> =>
        (data?.sha256s ?? []).map((sha) => ({
          sha256: sha,
          id: `asset-${sha}`,
          mime: 'application/octet-stream',
          size: 1,
          status: 'active' as const,
        })),
    );

    const result = await oxy.getServiceAssetMetadataBySha256(shas);

    // 250 unique hashes => 100 + 100 + 50 across three POSTs.
    expect(makeServiceRequestSpy).toHaveBeenCalledTimes(3);
    const chunkSizes = makeServiceRequestSpy.mock.calls.map(
      (call) => (call[2] as { sha256s: string[] }).sha256s.length,
    );
    expect(chunkSizes).toEqual([100, 100, 50]);

    expect(result).toHaveLength(250);
    expect(result[0].sha256).toBe(shas[0]);
    expect(result[249].sha256).toBe(shas[249]);
  });

  it('skips a failed chunk and returns the entries that resolved', async () => {
    const shas = Array.from({ length: 150 }, (_, i) =>
      i.toString(16).padStart(64, '0'),
    );

    makeServiceRequestSpy
      .mockResolvedValueOnce([publicEntry]) // first chunk (100 hashes) succeeds
      .mockRejectedValueOnce(new Error('chunk failed')); // second chunk (50) fails

    const result = await oxy.getServiceAssetMetadataBySha256(shas);

    expect(makeServiceRequestSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual([publicEntry]);
  });
});
