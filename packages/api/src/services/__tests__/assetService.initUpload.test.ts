/**
 * AssetService.initUpload — dedupe-signing authorization coverage.
 *
 * When a SHA-256 already maps to an existing File record, initUpload must NOT
 * hand a presigned PUT URL for that object's storage key to an arbitrary
 * caller: signing a live deduplicated object's key would let any authenticated
 * user who knows the SHA-256 overwrite another user's asset bytes. A repair PUT
 * URL is issued only to the file's OWNER, and only when the underlying object
 * is actually missing.
 *
 * S3Service and the File model are stubbed at the module boundary; no AWS or DB
 * access occurs.
 */

import { AssetService } from '../assetService';
import type { S3Service } from '../s3Service';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockFileFindOne = jest.fn();
jest.mock('../../models/File', () => ({
  File: { findOne: (...args: unknown[]) => mockFileFindOne(...args), findById: jest.fn() },
  FileVisibility: {},
}));

jest.mock('../variantService', () => ({
  VariantService: class {
    constructor(_s3: unknown) {
      /* no-op: initUpload never reaches variant generation */
    }
  },
}));

jest.mock('../mediaPrivacyService', () => ({
  mediaPrivacyService: {},
}));

interface FakeS3 {
  fileExists: jest.Mock<Promise<boolean>, [string]>;
  getPresignedUploadUrl: jest.Mock<Promise<string>, [string, { contentType: string; expiresIn: number }]>;
}

function buildAssetService(fake: FakeS3): AssetService {
  return new AssetService(fake as unknown as S3Service);
}

function existingFile(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => 'victim-file-id' },
    sha256: 'a'.repeat(64),
    storageKey: 'users/victim/private/secret.png',
    ownerUserId: 'victim-user-id',
    status: 'active',
    ...overrides,
  };
}

describe('AssetService.initUpload dedupe signing', () => {
  beforeEach(() => {
    mockFileFindOne.mockReset();
  });

  it('does not return a PUT URL for a live existing object owned by another user', async () => {
    const fakeS3: FakeS3 = {
      fileExists: jest.fn(() => Promise.resolve(true)),
      getPresignedUploadUrl: jest.fn(() => Promise.resolve('signed-put-url')),
    };
    mockFileFindOne.mockResolvedValue(existingFile());

    const result = await buildAssetService(fakeS3).initUpload(
      'attacker-user-id',
      'a'.repeat(64),
      123,
      'image/png',
    );

    expect(fakeS3.fileExists).toHaveBeenCalledWith('users/victim/private/secret.png');
    expect(fakeS3.getPresignedUploadUrl).not.toHaveBeenCalled();
    expect(result).toEqual({
      uploadUrl: '',
      fileId: 'victim-file-id',
      sha256: 'a'.repeat(64),
    });
  });

  it('does not return a repair PUT URL for a missing object to a non-owner', async () => {
    const fakeS3: FakeS3 = {
      fileExists: jest.fn(() => Promise.resolve(false)),
      getPresignedUploadUrl: jest.fn(() => Promise.resolve('signed-put-url')),
    };
    mockFileFindOne.mockResolvedValue(existingFile());

    const result = await buildAssetService(fakeS3).initUpload(
      'attacker-user-id',
      'a'.repeat(64),
      123,
      'image/png',
    );

    expect(fakeS3.fileExists).toHaveBeenCalledWith('users/victim/private/secret.png');
    expect(fakeS3.getPresignedUploadUrl).not.toHaveBeenCalled();
    expect(result.uploadUrl).toBe('');
  });

  it('only returns a repair PUT URL for a missing existing object when requested by its owner', async () => {
    const fakeS3: FakeS3 = {
      fileExists: jest.fn(() => Promise.resolve(false)),
      getPresignedUploadUrl: jest.fn(() => Promise.resolve('owner-repair-url')),
    };
    mockFileFindOne.mockResolvedValue(existingFile({ ownerUserId: 'owner-user-id' }));

    const result = await buildAssetService(fakeS3).initUpload(
      'owner-user-id',
      'a'.repeat(64),
      123,
      'image/png',
    );

    expect(fakeS3.getPresignedUploadUrl).toHaveBeenCalledWith('users/victim/private/secret.png', {
      contentType: 'image/png',
      expiresIn: 3600,
    });
    expect(result.uploadUrl).toBe('owner-repair-url');
  });
});
