/**
 * Publish-service tests: content-addressed asset init (presign only what's
 * missing) + complete (verify via HEAD and flip to uploaded), create-update
 * gating on uploaded assets, rollback (marks head rolled_back), and promote
 * (new UUID pointing at the SAME assets). Models + s3Service are mocked.
 */

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const APP_ID = '507f1f77bcf86cd799439011';

const mockAssetFindOne = jest.fn();
const mockAssetCreate = jest.fn();
const mockAssetFind = jest.fn();
const mockUpdateCreate = jest.fn();
const mockUpdateFindOne = jest.fn();
const mockChannelFindOneAndUpdate = jest.fn();
const mockChannelUpdateOne = jest.fn();
const mockChannelFindOne = jest.fn();
const mockChannelFindById = jest.fn();
const mockPresign = jest.fn();
const mockHeadObject = jest.fn();

jest.mock('../../assetServiceSingleton', () => ({
  __esModule: true,
  s3Service: {
    getPresignedUploadUrl: (...args: unknown[]) => mockPresign(...args),
    headObject: (...args: unknown[]) => mockHeadObject(...args),
  },
}));
jest.mock('../../../models/UpdateAsset', () => ({
  __esModule: true,
  UpdateAsset: {
    findOne: (...a: unknown[]) => mockAssetFindOne(...a),
    create: (...a: unknown[]) => mockAssetCreate(...a),
    find: (...a: unknown[]) => mockAssetFind(...a),
  },
}));
jest.mock('../../../models/AppUpdate', () => ({
  __esModule: true,
  AppUpdate: {
    create: (...a: unknown[]) => mockUpdateCreate(...a),
    findOne: (...a: unknown[]) => mockUpdateFindOne(...a),
  },
}));
jest.mock('../../../models/UpdateChannel', () => ({
  __esModule: true,
  UpdateChannel: {
    findOneAndUpdate: (...a: unknown[]) => mockChannelFindOneAndUpdate(...a),
    updateOne: (...a: unknown[]) => mockChannelUpdateOne(...a),
    findOne: (...a: unknown[]) => mockChannelFindOne(...a),
    findById: (...a: unknown[]) => mockChannelFindById(...a),
  },
  UPDATE_PLATFORMS: ['ios', 'android'],
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as publishService from '../publish.service';
import { updateAssetS3Key } from '../assetKeys';

/** A query object that is both awaitable (→ doc) and chainable via `.sort()`. */
function queryable(doc: unknown) {
  const promise = Promise.resolve(doc);
  return {
    sort: () => Promise.resolve(doc),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

function docBase(overrides: Record<string, unknown> = {}) {
  return {
    updateId: `uuid-${Math.random().toString(16).slice(2)}`,
    applicationId: { toString: () => APP_ID },
    channelId: { toString: () => 'chan1' },
    runtimeVersion: '1.0.0',
    platform: 'ios',
    status: 'published',
    rolloutPercent: 100,
    launchAsset: { sha256: SHA_A, key: 'bundle', contentType: 'application/javascript' },
    assets: [{ sha256: SHA_B, key: 'img', contentType: 'image/png', fileExtension: '.png' }],
    extra: { expoClient: { name: 'demo' } },
    metadata: {},
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('initAssets', () => {
  test('presigns only the assets not already uploaded', async () => {
    mockAssetFindOne.mockImplementation(async (query: { sha256: string }) =>
      query.sha256 === SHA_A ? { sha256: SHA_A, status: 'uploaded' } : null
    );
    mockAssetCreate.mockResolvedValue({});
    mockPresign.mockResolvedValue('https://s3.example/presigned-put');

    const result = await publishService.initAssets(APP_ID, [
      { sha256: SHA_A, contentType: 'application/javascript', size: 100 },
      { sha256: SHA_B, contentType: 'image/png', size: 200 },
    ]);

    expect(result.existing).toEqual([SHA_A]);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({
      sha256: SHA_B,
      uploadUrl: 'https://s3.example/presigned-put',
      storageKey: updateAssetS3Key(SHA_B),
      contentType: 'image/png',
    });
    expect(mockPresign).toHaveBeenCalledTimes(1);
    expect(mockPresign).toHaveBeenCalledWith(updateAssetS3Key(SHA_B), expect.objectContaining({ contentType: 'image/png' }));
    expect(mockAssetCreate).toHaveBeenCalledTimes(1);
  });
});

describe('completeAssets', () => {
  test('flips a pending asset to uploaded after a successful HEAD', async () => {
    const asset = { sha256: SHA_B, s3Key: updateAssetS3Key(SHA_B), status: 'pending', size: 0, save: jest.fn() };
    mockAssetFindOne.mockResolvedValue(asset);
    mockHeadObject.mockResolvedValue({ size: 512, contentType: 'image/png' });

    const result = await publishService.completeAssets(APP_ID, [SHA_B]);

    expect(asset.status).toBe('uploaded');
    expect(asset.size).toBe(512);
    expect(asset.save).toHaveBeenCalled();
    expect(result.assets).toEqual([{ sha256: SHA_B, status: 'uploaded', size: 512 }]);
  });

  test('leaves an asset pending when the object is missing in S3', async () => {
    const asset = { sha256: SHA_B, s3Key: updateAssetS3Key(SHA_B), status: 'pending', size: 0, save: jest.fn() };
    mockAssetFindOne.mockResolvedValue(asset);
    mockHeadObject.mockResolvedValue(null);

    const result = await publishService.completeAssets(APP_ID, [SHA_B]);

    expect(asset.save).not.toHaveBeenCalled();
    expect(result.assets).toEqual([{ sha256: SHA_B, status: 'pending', size: 0 }]);
  });
});

describe('createUpdate', () => {
  const input = {
    applicationId: APP_ID,
    channel: 'production',
    runtimeVersion: '1.0.0',
    platform: 'ios' as const,
    launchAsset: { sha256: SHA_A, key: 'bundle', contentType: 'application/javascript' },
    assets: [{ sha256: SHA_B, key: 'img', contentType: 'image/png', fileExtension: '.png' }],
    extra: { expoClient: { name: 'demo' } },
  };

  test('rejects when a referenced asset is not uploaded', async () => {
    mockAssetFind.mockReturnValue({ select: () => Promise.resolve([{ sha256: SHA_A }]) }); // SHA_B missing
    await expect(publishService.createUpdate(input)).rejects.toThrow(/not uploaded/i);
    expect(mockUpdateCreate).not.toHaveBeenCalled();
  });

  test('creates a published update once all assets are uploaded', async () => {
    mockAssetFind.mockReturnValue({
      select: () => Promise.resolve([{ sha256: SHA_A }, { sha256: SHA_B }]),
    });
    mockChannelFindOneAndUpdate.mockResolvedValue({ _id: { toString: () => 'chan1' }, name: 'production' });
    mockChannelUpdateOne.mockResolvedValue({});
    const created = docBase({ updateId: 'created-uuid' });
    mockUpdateCreate.mockResolvedValue(created);

    const result = await publishService.createUpdate(input);

    // A fresh publish clears any active rollback-to-embedded for the tuple.
    expect(mockChannelUpdateOne).toHaveBeenCalled();
    expect(mockUpdateCreate).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('created-uuid');
    expect(result.channel).toBe('production');
    expect(result.launchAssetSha256).toBe(SHA_A);
    expect(result.assetSha256s).toEqual([SHA_B]);
  });
});

describe('rollback', () => {
  test('marks the current head rolled_back and returns the new head', async () => {
    mockChannelFindOne.mockResolvedValue({ _id: { toString: () => 'chan1' }, name: 'production' });
    const head = docBase({ updateId: 'head-uuid', status: 'published', save: jest.fn() });
    const previous = docBase({ updateId: 'prev-uuid' });
    mockUpdateFindOne
      .mockReturnValueOnce(queryable(head)) // findHead (before)
      .mockReturnValueOnce(queryable(previous)); // findHead (after)

    const result = await publishService.rollback(APP_ID, 'production', '1.0.0', 'ios');

    expect(head.status).toBe('rolled_back');
    expect(head.save).toHaveBeenCalled();
    expect(result.rolledBack.id).toBe('head-uuid');
    expect(result.head?.id).toBe('prev-uuid');
  });

  test('throws when there is no published update to roll back', async () => {
    mockChannelFindOne.mockResolvedValue({ _id: { toString: () => 'chan1' }, name: 'production' });
    mockUpdateFindOne.mockReturnValueOnce(queryable(null));
    await expect(publishService.rollback(APP_ID, 'production', '1.0.0', 'ios')).rejects.toThrow(
      /no published update/i
    );
  });
});

describe('promote', () => {
  test('creates a NEW update (new UUID) pointing at the same assets', async () => {
    const source = docBase({ updateId: 'source-uuid' });
    mockUpdateFindOne.mockReturnValueOnce(queryable(source));
    mockChannelFindOneAndUpdate.mockResolvedValue({ _id: { toString: () => 'chan2' }, name: 'preview' });
    mockChannelUpdateOne.mockResolvedValue({});
    const promoted = docBase({ updateId: 'promoted-uuid', promotedFromUpdateId: 'source-uuid' });
    mockUpdateCreate.mockResolvedValue(promoted);

    const result = await publishService.promote(APP_ID, 'source-uuid', 'preview', 50);

    expect(mockUpdateCreate).toHaveBeenCalledTimes(1);
    const createArg = mockUpdateCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.promotedFromUpdateId).toBe('source-uuid');
    expect(createArg.launchAsset).toBe(source.launchAsset);
    expect(createArg.assets).toBe(source.assets);
    expect(createArg.rolloutPercent).toBe(50);
    expect(result.id).toBe('promoted-uuid');
    expect(result.id).not.toBe(source.updateId);
  });

  test('throws when the source update does not exist', async () => {
    mockUpdateFindOne.mockReturnValueOnce(queryable(null));
    await expect(publishService.promote(APP_ID, 'missing', 'preview')).rejects.toThrow(/not found/i);
  });
});

describe('setRollout', () => {
  test('updates the rollout percentage in place', async () => {
    const update = docBase({ updateId: 'u-uuid', rolloutPercent: 100, save: jest.fn() });
    mockUpdateFindOne.mockReturnValueOnce(queryable(update));
    mockChannelFindById.mockReturnValue({ select: () => Promise.resolve({ name: 'production' }) });

    const result = await publishService.setRollout(APP_ID, 'u-uuid', 25);

    expect(update.rolloutPercent).toBe(25);
    expect(update.save).toHaveBeenCalled();
    expect(result.rolloutPercent).toBe(25);
  });
});
