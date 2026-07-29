/**
 * `persistOriginalImageDimensions` — the eager, upload-path write of an image
 * original's intrinsic geometry.
 *
 * Two properties matter here and neither is observable from the variant tests:
 *
 * 1. It must persist the dimensions as DISPLAYED. `sharp().metadata()` reports
 *    width/height as STORED, explicitly ignoring the EXIF Orientation header,
 *    while every variant this service emits is built through `.rotate()` and is
 *    therefore auto-oriented. For the quarter-turn orientations (5-8) — what a
 *    phone writes for a portrait photo — those two disagree by a transpose, so
 *    persisting the stored pair would advertise an aspect ratio that is the
 *    reciprocal of the pixels a client actually receives.
 * 2. The canonical `metadata.media` summary must stay internally consistent:
 *    `aspectRatio` and `orientation` are derived from the same pair that is
 *    persisted beside them.
 *
 * Sharp runs for real so the assertions cover genuine decoded geometry; S3 and
 * the File model are stubbed at the module boundary.
 */

import sharp from 'sharp';
import { VariantService } from '../variantService';
import type { S3Service } from '../s3Service';
import type { IFile } from '../../models/File';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../models/File', () => ({
  File: {
    updateOne: jest.fn(() => ({ exec: jest.fn(() => Promise.resolve({})) })),
    findById: jest.fn(() => Promise.resolve(null)),
    findOne: jest.fn(() => Promise.resolve(null)),
  },
  FileVisibility: {},
}));

interface SavedFile extends IFile {
  save: jest.Mock<Promise<void>, []>;
}

function makeFile(): SavedFile {
  return {
    _id: 'test-file-id',
    sha256: 'b'.repeat(64),
    mime: 'image/jpeg',
    visibility: 'public',
    storageKey: 'public/uploads/2026/07/bb/original.jpg',
    variants: [],
    save: jest.fn(() => Promise.resolve()),
  } as unknown as SavedFile;
}

function makeS3(original: Buffer): S3Service {
  return {
    downloadBuffer: jest.fn(() => Promise.resolve(original)),
    uploadBuffer: jest.fn(() => Promise.resolve()),
    fileExists: jest.fn(() => Promise.resolve(false)),
  } as unknown as S3Service;
}

/** A landscape 800x400 JPEG carrying the given EXIF Orientation value. */
async function makeOrientedJpeg(orientation: number): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

function readMedia(file: IFile): Record<string, unknown> {
  const metadata = file.metadata ?? {};
  return (metadata.media ?? {}) as Record<string, unknown>;
}

describe('VariantService.persistOriginalImageDimensions', () => {
  it('persists the original dimensions for an unrotated image', async () => {
    const original = await makeOrientedJpeg(1);
    const service = new VariantService(makeS3(original));
    const file = makeFile();

    await expect(service.persistOriginalImageDimensions(file, original)).resolves.toBe(true);

    expect(readMedia(file)).toMatchObject({
      width: 800,
      height: 400,
      orientation: 'landscape',
      aspectRatio: 2,
    });
    expect(file.save).toHaveBeenCalledTimes(1);
  });

  // 5-8 are the quarter-turn orientations; 1-4 leave the axes alone.
  it.each([5, 6, 7, 8])(
    'transposes width/height for EXIF orientation %i, matching what the variants render',
    async (orientation) => {
      const original = await makeOrientedJpeg(orientation);
      const service = new VariantService(makeS3(original));
      const file = makeFile();

      await service.persistOriginalImageDimensions(file, original);

      // Stored is 800x400; displayed (and every `.rotate()`d variant) is 400x800.
      expect(readMedia(file)).toMatchObject({
        width: 400,
        height: 800,
        orientation: 'portrait',
        aspectRatio: 0.5,
      });

      // Cross-check against the real pipeline rather than restating the rule:
      // the persisted ratio must equal what an auto-oriented resize produces.
      const rendered = await sharp(original).rotate().toBuffer();
      const renderedMeta = await sharp(rendered).metadata();
      const media = readMedia(file);
      expect(media.width).toBe(renderedMeta.width);
      expect(media.height).toBe(renderedMeta.height);
    },
  );

  it.each([2, 3, 4])('leaves the axes alone for non-quarter-turn orientation %i', async (orientation) => {
    const original = await makeOrientedJpeg(orientation);
    const service = new VariantService(makeS3(original));
    const file = makeFile();

    await service.persistOriginalImageDimensions(file, original);

    expect(readMedia(file)).toMatchObject({ width: 800, height: 400 });
  });

  it('keeps aspectRatio and orientation consistent with the persisted pair', async () => {
    const original = await makeOrientedJpeg(6);
    const service = new VariantService(makeS3(original));
    const file = makeFile();

    await service.persistOriginalImageDimensions(file, original);

    const media = readMedia(file);
    const width = media.width as number;
    const height = media.height as number;
    expect(media.aspectRatio).toBeCloseTo(width / height, 10);
    expect(media.orientation).toBe(height / width >= 1.1 ? 'portrait' : 'landscape');
  });

  it('downloads the original when the caller holds no buffer', async () => {
    const original = await makeOrientedJpeg(1);
    const s3 = makeS3(original);
    const service = new VariantService(s3);
    const file = makeFile();

    await service.persistOriginalImageDimensions(file);

    expect(s3.downloadBuffer).toHaveBeenCalledWith('public/uploads/2026/07/bb/original.jpg');
    expect(readMedia(file)).toMatchObject({ width: 800, height: 400 });
  });

  it('reuses the supplied buffer instead of re-reading storage', async () => {
    const original = await makeOrientedJpeg(1);
    const s3 = makeS3(original);
    const service = new VariantService(s3);

    await service.persistOriginalImageDimensions(makeFile(), original);

    expect(s3.downloadBuffer).not.toHaveBeenCalled();
  });

  it('reports false and persists nothing when the bytes carry no dimensions', async () => {
    const notAnImage = Buffer.from('this is not an image at all');
    const service = new VariantService(makeS3(notAnImage));
    const file = makeFile();

    await expect(service.persistOriginalImageDimensions(file, notAnImage)).rejects.toThrow();
    expect(file.save).not.toHaveBeenCalled();
  });
});
