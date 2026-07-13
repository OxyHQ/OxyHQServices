/**
 * AssetService dedup + public-CDN status guards (security regression coverage).
 *
 * 1. [CRITICAL] Content-addressed dedup MUST exclude `deleted` tombstones. A
 *    prior change matched tombstones globally and revived them under the next
 *    uploader's ownership (cross-tenant ownership takeover via SHA-256
 *    collision). Every dedup `File.findOne(...)` must carry
 *    `status: { $ne: 'deleted' }`, and a fresh upload whose content matches only
 *    a tombstone must insert a BRAND-NEW record owned by the uploader.
 *
 * 2. [MEDIUM] getPublicCdnUrl must return null for any non-`active` asset even
 *    when `visibility === 'public'`, so trashed/deleted objects can't keep
 *    serving from the public CDN.
 *
 * S3Service, the File model, and variant/privacy services are stubbed at the
 * module boundary; no AWS or DB access occurs.
 */

import { AssetService } from '../assetService';
import type { S3Service } from '../s3Service';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockFileFindOne = jest.fn();
const mockFileSave = jest.fn();
const mockFileConstruct = jest.fn();

// `new File({...})` is used on the insert path. The factory defines a real
// (non-arrow) function constructor so `new File(...)` works; it records every
// construction via `mockFileConstruct` and assigns the provided fields to the
// instance so the test can assert who the new record is owned by.
jest.mock('../../models/File', () => {
  function File(this: Record<string, unknown>, doc: Record<string, unknown>) {
    mockFileConstruct(doc);
    Object.assign(this, doc);
    this._id = { toString: () => 'new-inserted-id' };
    this.save = mockFileSave;
  }
  (File as unknown as { findOne: (...a: unknown[]) => unknown }).findOne = (...args: unknown[]) =>
    mockFileFindOne(...args);
  (File as unknown as { findById: jest.Mock }).findById = jest.fn();
  return { File, FileVisibility: {} };
});

jest.mock('../variantService', () => ({
  VariantService: class {
    constructor(_s3: unknown) {
      /* no-op */
    }
    generateVariants = jest.fn(() => Promise.resolve());
  },
}));

jest.mock('../mediaPrivacyService', () => ({ mediaPrivacyService: {} }));
jest.mock('../../utils/fileCache', () => ({
  __esModule: true,
  default: { invalidate: jest.fn(), set: jest.fn(), get: jest.fn() },
}));

interface FakeS3 {
  fileExists: jest.Mock;
  getPresignedUploadUrl: jest.Mock;
  uploadBuffer: jest.Mock;
}

function buildAssetService(fake: Partial<FakeS3>): AssetService {
  return new AssetService(fake as unknown as S3Service);
}

describe('AssetService dedup excludes deleted tombstones (cross-tenant takeover regression)', () => {
  beforeEach(() => {
    mockFileFindOne.mockReset();
    mockFileSave.mockReset();
    mockFileConstruct.mockClear();
  });

  it('initUpload dedup query filters out deleted tombstones', async () => {
    mockFileFindOne.mockResolvedValue(null);
    const fakeS3: FakeS3 = {
      fileExists: jest.fn(() => Promise.resolve(false)),
      getPresignedUploadUrl: jest.fn(() => Promise.resolve('signed-url')),
      uploadBuffer: jest.fn(() => Promise.resolve()),
    };

    await buildAssetService(fakeS3).initUpload('uploader', 'b'.repeat(64), 10, 'image/png');

    // The dedup lookup MUST scope to non-deleted records.
    expect(mockFileFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: 'b'.repeat(64), status: { $ne: 'deleted' } }),
    );
  });

  it('uploadFileDirect never matches a tombstone — inserts a new record owned by the uploader', async () => {
    // findActiveFileBySha returns null (the tombstone is excluded by the filter).
    mockFileFindOne.mockResolvedValue(null);
    mockFileSave.mockResolvedValue(undefined);
    const fakeS3: FakeS3 = {
      fileExists: jest.fn(() => Promise.resolve(false)),
      getPresignedUploadUrl: jest.fn(() => Promise.resolve('signed-url')),
      uploadBuffer: jest.fn(() => Promise.resolve()),
    };

    const result = await buildAssetService(fakeS3).uploadFileDirect(
      'attacker-user-id',
      // Valid PNG magic so the image-content guard accepts it and the test
      // exercises the tombstone-exclusion path (not a 400 content rejection).
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png',
      'avatar.png',
    );

    // Dedup query scoped to non-deleted.
    expect(mockFileFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $ne: 'deleted' } }),
    );
    // A brand-new File was constructed and owned by the uploader — NOT a revived
    // tombstone reassigned to the attacker.
    expect(mockFileConstruct).toHaveBeenCalledTimes(1);
    expect(mockFileConstruct).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: 'attacker-user-id', status: 'active' }),
    );
    expect(result).toEqual(expect.objectContaining({ ownerUserId: 'attacker-user-id' }));
    expect(fakeS3.uploadBuffer).toHaveBeenCalled();
  });
});

describe('AssetService.getPublicCdnUrl status gate (trashed/deleted CDN exposure regression)', () => {
  const fakeS3 = { fileExists: jest.fn() } as unknown as Partial<FakeS3>;

  function publicFile(status: string) {
    return {
      _id: { toString: () => 'f1' },
      visibility: 'public',
      status,
      storageKey: 'public/content/2026/06/ab/abc.png',
      variants: [],
    } as never;
  }

  it.each(['trash', 'deleted'])('returns null for a public but %s asset', async (status) => {
    const svc = buildAssetService(fakeS3);
    const url = await svc.getPublicCdnUrl(publicFile(status));
    expect(url).toBeNull();
  });
});
