/**
 * VariantService image-variant config + resize coverage.
 *
 * Focus: the `avatar` variant (128×128 webp, fit-inside) added to the
 * `imageVariants` config. Because the config is consumed by BOTH the
 * upload-time `generateImageVariants` path and the on-demand
 * `ensureImageVariant` (CDN-read) path, exercising `ensureImageVariant`
 * proves the new key is wired end to end: an unknown variant is rejected
 * (config-lookup gate), and a known one downloads the ORIGINAL object, runs
 * the real Sharp resize, and uploads the resized bytes.
 *
 * S3Service and the File model are stubbed at the module boundary; no AWS or
 * DB access occurs. Sharp runs for real so the assertions cover actual output
 * dimensions and byte sizes.
 */

import sharp from 'sharp';
import { VariantService } from '../variantService';
import type { S3Service } from '../s3Service';
import type { IFile } from '../../models/File';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// commitVariants persists via File.updateOne(...).exec(); stub it so no DB is
// needed and the happy path returns the freshly generated variant.
jest.mock('../../models/File', () => ({
  File: {
    updateOne: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({})) })),
    findById: jest.fn(() => Promise.resolve(null)),
    findOne: jest.fn(() => Promise.resolve(null)),
  },
  FileVisibility: {},
}));

interface CapturedUpload {
  key: string;
  buffer: Buffer;
}

interface FakeS3 {
  downloadBuffer: jest.Mock<Promise<Buffer>, [string]>;
  uploadBuffer: jest.Mock<Promise<void>, [string, Buffer, { contentType: string }?]>;
  fileExists: jest.Mock<Promise<boolean>, [string]>;
  uploads: CapturedUpload[];
}

function makeFakeS3(originalBuffer: Buffer): FakeS3 {
  const uploads: CapturedUpload[] = [];
  return {
    downloadBuffer: jest.fn(() => Promise.resolve(originalBuffer)),
    uploadBuffer: jest.fn((key: string, buffer: Buffer) => {
      uploads.push({ key, buffer });
      return Promise.resolve();
    }),
    fileExists: jest.fn(() => Promise.resolve(false)),
    uploads,
  };
}

function makeFile(): IFile {
  return {
    _id: 'test-file-id',
    sha256: 'a'.repeat(64),
    mime: 'image/png',
    visibility: 'public',
    storageKey: 'public/uploads/2026/07/aa/original.png',
    variants: [],
  } as unknown as IFile;
}

async function makeSquarePng(size: number): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

describe('VariantService imageVariants — avatar variant', () => {
  it('generates a 128×128 webp for the avatar variant from an existing original', async () => {
    const original = await makeSquarePng(512);
    const fakeS3 = makeFakeS3(original);
    const service = new VariantService(fakeS3 as unknown as S3Service);

    const variant = await service.ensureImageVariant(makeFile(), 'avatar');

    expect(variant.type).toBe('avatar');
    expect(variant.width).toBe(128);
    expect(variant.height).toBe(128);
    expect(variant.metadata).toMatchObject({ format: 'webp', quality: 82 });

    // The on-demand path reads the canonical original then uploads the resize.
    expect(fakeS3.downloadBuffer).toHaveBeenCalledWith('public/uploads/2026/07/aa/original.png');
    const uploaded = fakeS3.uploads.find(u => u.key.endsWith('/avatar.webp'));
    expect(uploaded).toBeDefined();
    const meta = await sharp(uploaded?.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
  });

  it('produces meaningfully smaller bytes than thumb for the same source', async () => {
    const original = await makeSquarePng(512);

    const avatarS3 = makeFakeS3(original);
    const avatar = await new VariantService(avatarS3 as unknown as S3Service).ensureImageVariant(
      makeFile(),
      'avatar',
    );

    const thumbS3 = makeFakeS3(original);
    const thumb = await new VariantService(thumbS3 as unknown as S3Service).ensureImageVariant(
      makeFile(),
      'thumb',
    );

    // thumb stays 256×256 (unchanged); avatar is half the linear dimension.
    expect(thumb.width).toBe(256);
    expect(thumb.height).toBe(256);
    expect(avatar.width).toBe(128);

    const avatarBytes = avatarS3.uploads.find(u => u.key.endsWith('/avatar.webp'))?.buffer.length ?? 0;
    const thumbBytes = thumbS3.uploads.find(u => u.key.endsWith('/thumb.webp'))?.buffer.length ?? 0;
    expect(avatarBytes).toBeGreaterThan(0);
    expect(thumbBytes).toBeGreaterThan(0);
    expect(avatarBytes).toBeLessThan(thumbBytes);
  });

  it('rejects a variant key that is not in the imageVariants config', async () => {
    const original = await makeSquarePng(512);
    const service = new VariantService(makeFakeS3(original) as unknown as S3Service);

    await expect(service.ensureImageVariant(makeFile(), 'not-a-real-variant')).rejects.toThrow(
      /Unsupported image variant/,
    );
  });
});
