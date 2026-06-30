/**
 * `getServiceAssetMetadataByIds` mixin tests.
 *
 * Stubs `makeServiceRequest` (the service-token transport used by the route's
 * `serviceAuthMiddleware` + `files:read` scope) so the tests run with no network
 * and no `getServiceToken()` round-trip, then asserts:
 *  - empty / whitespace-only input no-ops to `[]` with no network call;
 *  - input is de-duplicated and a single chunk is sent for <= 100 unique ids,
 *    POSTed to `/assets/service/by-ids` as `{ ids }`;
 *  - the `{ data }` envelope is unwrapped to a bare `ServiceAssetMetadata[]`
 *    (mirroring how `makeServiceRequest<T[]>` returns the inner array);
 *  - inputs > 100 ids are chunked at 100/request and merged;
 *  - a failed chunk is logged and skipped — successful chunks still return.
 */

import type { ServiceAssetMetadata } from '../../models/interfaces';
import { OxyServices } from '../../OxyServices';

const sampleEntry: ServiceAssetMetadata = {
  id: 'asset-1',
  sha256: 'a'.repeat(64),
  mime: 'image/jpeg',
  size: 12345,
  status: 'active',
};

describe('OxyServices.assets — getServiceAssetMetadataByIds', () => {
  let oxy: OxyServices;
  let makeServiceRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeServiceRequestSpy = jest.spyOn(oxy, 'makeServiceRequest');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns [] and performs no network call for empty / whitespace input', async () => {
    await expect(oxy.getServiceAssetMetadataByIds([])).resolves.toEqual([]);
    await expect(oxy.getServiceAssetMetadataByIds(['', '   '])).resolves.toEqual([]);
    expect(makeServiceRequestSpy).not.toHaveBeenCalled();
  });

  it('de-duplicates and sends a single chunk for <= 100 unique ids', async () => {
    // makeServiceRequest unwraps the API's `{ data }` envelope, so the resolved
    // value is the bare array (NOT `{ data: [...] }`) — mirror that real shape.
    makeServiceRequestSpy.mockResolvedValueOnce([sampleEntry]);

    const result = await oxy.getServiceAssetMetadataByIds([
      'asset-1',
      'asset-1', // duplicate
      '   ', // dropped
    ]);

    expect(result).toEqual([sampleEntry]);
    expect(makeServiceRequestSpy).toHaveBeenCalledTimes(1);
    expect(makeServiceRequestSpy).toHaveBeenCalledWith(
      'POST',
      '/assets/service/by-ids',
      { ids: ['asset-1'] },
    );
  });

  it('chunks at 100 ids per request and merges each chunk', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `asset-${i}`);

    makeServiceRequestSpy.mockImplementation(
      async (
        _method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        _url: string,
        data?: { ids: string[] },
      ): Promise<ServiceAssetMetadata[]> =>
        (data?.ids ?? []).map((id) => ({
          id,
          sha256: 'b'.repeat(64),
          mime: 'application/octet-stream',
          size: 1,
          status: 'active' as const,
        })),
    );

    const result = await oxy.getServiceAssetMetadataByIds(ids);

    // 250 unique ids => 100 + 100 + 50 across three POSTs.
    expect(makeServiceRequestSpy).toHaveBeenCalledTimes(3);
    const chunkSizes = makeServiceRequestSpy.mock.calls.map(
      (call) => (call[2] as { ids: string[] }).ids.length,
    );
    expect(chunkSizes).toEqual([100, 100, 50]);

    expect(result).toHaveLength(250);
    expect(result[0]).toEqual({
      id: 'asset-0',
      sha256: 'b'.repeat(64),
      mime: 'application/octet-stream',
      size: 1,
      status: 'active',
    });
    expect(result[249]?.id).toBe('asset-249');
  });

  it('skips a failed chunk and returns the entries that resolved', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `asset-${i}`);

    makeServiceRequestSpy
      .mockResolvedValueOnce([sampleEntry]) // first chunk (100 ids) succeeds
      .mockRejectedValueOnce(new Error('chunk failed')); // second chunk (50 ids) fails

    const result = await oxy.getServiceAssetMetadataByIds(ids);

    expect(makeServiceRequestSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual([sampleEntry]);
  });
});
