/**
 * AssetService batch-resolution robustness coverage (review-finding regressions).
 *
 * 1. [HIGH — PR #452] `getFilesByIds` MUST drop invalid (non-ObjectId) ids before
 *    querying Mongo. A single malformed id previously reached `File.find` and
 *    threw a `CastError`, turning the whole batch into an HTTP 500. The resolver
 *    is lenient: it filters invalid ids and resolves the valid ones.
 *
 * 2. [HIGH — PR #456] `findActiveFilesBySha256` MUST be deterministic when several
 *    live `File` docs share one sha256 (content-addressing dedups bytes but docs
 *    are per-owner). It collapses each hash to ONE stable representative — the
 *    oldest by (createdAt, _id) — so repeated calls return the same fileId.
 *
 * The `File` model is stubbed at the module boundary; no DB access occurs.
 */

import { AssetService } from '../assetService';
import { S3Service } from '../s3Service';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockFileFind = jest.fn();

jest.mock('../../models/File', () => ({
  File: { find: (...args: unknown[]) => mockFileFind(...args) },
  FileVisibility: {},
}));

jest.mock('../variantService', () => ({
  VariantService: class {
    constructor(_s3: unknown) {
      /* no-op */
    }
  },
}));

jest.mock('../mediaPrivacyService', () => ({ mediaPrivacyService: {} }));
jest.mock('../../utils/fileCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn(), set: jest.fn(), get: jest.fn() },
}));

function buildAssetService(): AssetService {
  return new AssetService({} as unknown as S3Service);
}

const VALID_ID_A = 'a'.repeat(24);
const VALID_ID_B = 'b'.repeat(24);

describe('AssetService.getFilesByIds drops invalid ObjectIds (CastError -> 500 regression)', () => {
  beforeEach(() => {
    mockFileFind.mockReset();
  });

  it('filters out non-ObjectId ids before querying and resolves only the valid ones', async () => {
    mockFileFind.mockResolvedValue([{ _id: VALID_ID_A }]);

    const result = await buildAssetService().getFilesByIds([VALID_ID_A, 'not-an-object-id', '']);

    // Only the valid id reaches Mongo — the malformed entries are dropped, so no
    // CastError is ever thrown.
    expect(mockFileFind).toHaveBeenCalledTimes(1);
    const query = mockFileFind.mock.calls[0][0] as { _id: { $in: unknown[] } };
    expect(query._id.$in).toHaveLength(1);
    expect(String(query._id.$in[0])).toBe(VALID_ID_A);
    expect(result).toEqual([{ _id: VALID_ID_A }]);
  });

  it('returns [] without touching Mongo when every id is invalid', async () => {
    const result = await buildAssetService().getFilesByIds(['nope', '123', 'xyz']);

    expect(result).toEqual([]);
    expect(mockFileFind).not.toHaveBeenCalled();
  });
});

describe('AssetService.findActiveFilesBySha256 deterministic one-per-hash (PR #456)', () => {
  beforeEach(() => {
    mockFileFind.mockReset();
  });

  /**
   * `File.find(...).sort(...)` is chained; the mock returns the rows the route's
   * (createdAt, _id) sort would yield. We assert the service collapses duplicates
   * and that the chosen representative is independent of input row order.
   */
  function mockSortedRows(rows: unknown[]): void {
    mockFileFind.mockReturnValue({ sort: jest.fn().mockResolvedValue(rows) });
  }

  const SHA = 'c'.repeat(64);

  it('collapses multiple live docs sharing one sha256 to the oldest representative', async () => {
    const oldest = { _id: 'file-oldest', sha256: SHA, createdAt: new Date('2024-01-01') };
    const newer = { _id: 'file-newer', sha256: SHA, createdAt: new Date('2025-01-01') };
    mockSortedRows([oldest, newer]);

    const result = await buildAssetService().findActiveFilesBySha256([SHA]);

    // Service sorts ascending (createdAt, _id) — verify it asked Mongo for that order.
    const sortMock = mockFileFind.mock.results[0].value.sort as jest.Mock;
    expect(sortMock).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });

    // Exactly one record per hash, and it is the oldest (first in the sorted list).
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(oldest);
  });

  it('returns the SAME fileId for the same input across repeated calls', async () => {
    const rows = [
      { _id: 'file-oldest', sha256: SHA, createdAt: new Date('2024-01-01') },
      { _id: 'file-newer', sha256: SHA, createdAt: new Date('2025-01-01') },
    ];

    mockSortedRows(rows);
    const first = await buildAssetService().findActiveFilesBySha256([SHA]);
    mockSortedRows(rows);
    const second = await buildAssetService().findActiveFilesBySha256([SHA]);

    expect(first[0]._id).toBe('file-oldest');
    expect(second[0]._id).toBe(first[0]._id);
  });

  it('resolves multiple hashes independently, one representative each', async () => {
    const shaA = 'a'.repeat(64);
    const shaB = 'b'.repeat(64);
    mockSortedRows([
      { _id: 'a-old', sha256: shaA, createdAt: new Date('2024-01-01') },
      { _id: 'a-new', sha256: shaA, createdAt: new Date('2025-01-01') },
      { _id: 'b-old', sha256: shaB, createdAt: new Date('2024-06-01') },
    ]);

    const result = await buildAssetService().findActiveFilesBySha256([shaA, shaB]);

    expect(result).toHaveLength(2);
    expect(result.map((f) => f._id).sort()).toEqual(['a-old', 'b-old']);
  });

  it('short-circuits empty input without querying', async () => {
    const result = await buildAssetService().findActiveFilesBySha256([]);
    expect(result).toEqual([]);
    expect(mockFileFind).not.toHaveBeenCalled();
  });
});
