/**
 * Abort-cleanup unit test for AssetService.uploadCachedMediaStream.
 *
 * Proves the C2(b) hardening: when the source request is torn down mid-upload
 * (client disconnect / request timeout → `'aborted'`), the in-flight S3 upload
 * is aborted via the AbortSignal and the partial temp object is deleted, so a
 * cancelled cache upload never leaks an orphaned S3 object.
 *
 * A hand-rolled fake S3Service (typed against the method subset the path uses,
 * no `as any`) stands in for real S3. Its `uploadStream` wires the passed
 * AbortSignal and only rejects once that signal fires — mirroring how the real
 * multipart `Upload.abort()` rejects `done()`.
 */

import { Readable } from 'stream';
import { AssetService } from '../assetService';
import { S3Service } from '../s3Service';
import type { UploadOptions } from '../s3Service';
import type { FileInfo } from '../../types/s3.types';

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

// The project's global mongoose mock (jest.setup.cjs) does not implement
// `Schema.Types.Mixed`, which File.ts touches at module-eval time. The abort
// path under test rejects in `uploadStream` BEFORE any File model access, so we
// stub the model module purely to make the import side-effect succeed.
const mockFileFindOne = jest.fn();
jest.mock('../../models/File', () => ({
  File: { findOne: (...args: unknown[]) => mockFileFindOne(...args), findById: jest.fn() },
  FileVisibility: {},
}));

// VariantService pulls in sharp/ffmpeg at import; stub it so these storage
// tests stay focused on AssetService's dedupe/repair contract.
const mockGenerateVariants = jest.fn();
jest.mock('../variantService', () => ({
  VariantService: class {
    constructor(_s3: unknown) { /* no-op */ }

    generateVariants(...args: unknown[]) {
      return mockGenerateVariants(...args);
    }
  },
}));

// mediaPrivacyService imports the User model (more Schema side effects the
// minimal mongoose mock can't satisfy) and is never reached on the abort path.
jest.mock('../mediaPrivacyService', () => ({
  mediaPrivacyService: {},
}));

const CACHE_MAX_BYTES = 256 * 1024 * 1024;

/** The S3Service surface uploadCachedMediaStream touches on the abort path. */
interface FakeS3 {
  uploadStream: jest.Mock<Promise<FileInfo>, [string, Readable, UploadOptions?]>;
  uploadBuffer: jest.Mock<Promise<FileInfo>, [string, Buffer, UploadOptions?]>;
  deleteFile: jest.Mock<Promise<void>, [string]>;
  fileExists: jest.Mock<Promise<boolean>, [string]>;
  copyFile: jest.Mock<Promise<void>, [string, string]>;
}

type FakeS3Input = Partial<Pick<FakeS3, 'uploadStream' | 'uploadBuffer' | 'fileExists' | 'copyFile'>> & Pick<FakeS3, 'deleteFile'>;

function buildAssetService(input: FakeS3Input): { service: AssetService; fake: FakeS3 } {
  const fake: FakeS3 = {
    uploadStream: jest.fn((): Promise<FileInfo> => Promise.resolve({ key: 'unused', size: 0, contentType: 'application/octet-stream' } as FileInfo)),
    uploadBuffer: jest.fn((key: string, buffer: Buffer, options?: UploadOptions): Promise<FileInfo> => Promise.resolve({
      key,
      size: buffer.length,
      contentType: options?.contentType || 'application/octet-stream',
    } as FileInfo)),
    fileExists: jest.fn((): Promise<boolean> => Promise.resolve(true)),
    copyFile: jest.fn((): Promise<void> => Promise.resolve()),
    ...input,
  };

  // AssetService only calls this method subset on this path; satisfy the
  // S3Service contract via a typed cast of the method subset (never `any`).
  const service = new AssetService(fake as unknown as S3Service);
  return { service, fake };
}

describe('uploadCachedMediaStream — abort cleanup', () => {
  beforeEach(() => {
    mockFileFindOne.mockReset();
    mockGenerateVariants.mockReset();
    mockGenerateVariants.mockResolvedValue(undefined);
  });

  it('aborts the S3 upload and deletes the temp object when the source aborts', async () => {
    let capturedTempKey: string | undefined;
    let abortObserved = false;

    const uploadStream = jest.fn(
      (key: string, _body: Readable, options?: UploadOptions): Promise<FileInfo> => {
        capturedTempKey = key;
        // Reject only when the caller aborts — exactly what the real multipart
        // Upload does when `upload.abort()` is invoked from the signal handler.
        return new Promise<FileInfo>((_resolve, reject) => {
          const signal = options?.abortSignal;
          if (!signal) {
            return; // never resolves; the test only exercises the abort path
          }
          signal.addEventListener('abort', () => {
            abortObserved = true;
            reject(new Error('Upload aborted'));
          }, { once: true });
        });
      }
    );

    const deleteFile = jest.fn((): Promise<void> => Promise.resolve());

    const { service } = buildAssetService({ uploadStream, deleteFile });

    // A source stream that never ends; we trigger the client-disconnect path
    // by emitting 'aborted' after the upload has started.
    const source = new Readable({ read() { /* no data — wait for abort */ } });

    const promise = service.uploadCachedMediaStream(
      source,
      'video/mp4',
      'federation-cache-media',
      CACHE_MAX_BYTES
    );

    // Let uploadStream register its abort listener, then simulate the client
    // disconnecting mid-upload.
    await new Promise((resolve) => setImmediate(resolve));
    source.emit('aborted');

    await expect(promise).rejects.toThrow('Upload aborted');

    // The AbortSignal reached S3 and fired, and the partial temp object was
    // cleaned up with the same key the upload used.
    expect(abortObserved).toBe(true);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(capturedTempKey);
    expect(capturedTempKey).toMatch(/^cache\/incoming\//);

    // Tear down the never-ending source so no stream handle leaks past the test.
    source.destroy();
  });

  it('does NOT abort the S3 upload when the source closes after a clean end', async () => {
    // Regression guard: Node's `'close'` event ALSO fires on normal successful
    // completion (right after the body is fully read), BEFORE `completed` flips
    // to true. The handler must NOT treat that as a client/timeout abort — it
    // previously did, self-aborting every clean upload into a 500.
    let abortObserved = false;
    let resolveUpload: ((info: FileInfo) => void) | undefined;

    const uploadStream = jest.fn(
      (_key: string, _body: Readable, options?: UploadOptions): Promise<FileInfo> => {
        const signal = options?.abortSignal;
        signal?.addEventListener('abort', () => { abortObserved = true; }, { once: true });
        return new Promise<FileInfo>((resolve) => { resolveUpload = resolve; });
      }
    );

    const deleteFile = jest.fn((): Promise<void> => Promise.resolve());
    const { service } = buildAssetService({ uploadStream, deleteFile });

    // Dedup short-circuit: returning an existing file lets the success path
    // resolve without constructing a File model (out of scope for this unit).
    const existingFile = { _id: '64c000000000000000000abc', size: 4 };
    mockFileFindOne.mockResolvedValueOnce(existingFile);

    // A source that delivers a small body and ends cleanly, exactly like a
    // fully-received request body piped through the byte-meter Transform.
    const source = new Readable({
      read() {
        this.push(Buffer.from('PNG!'));
        this.push(null);
      },
    });

    const promise = service.uploadCachedMediaStream(
      source,
      'image/png',
      'federation-cache-media',
      CACHE_MAX_BYTES
    );

    // Let the meter drain the body so the source's 'end' fires and
    // `readableEnded` becomes true, then emit the normal-completion 'close'.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(source.readableEnded).toBe(true);
    source.emit('close');

    // The clean-end close must NOT have tripped the abort signal.
    expect(abortObserved).toBe(false);

    // Now let the S3 upload finish; the call resolves to the deduped file.
    resolveUpload?.({ key: 'cache/incoming/x', size: 4, contentType: 'image/png' } as FileInfo);

    await expect(promise).resolves.toBe(existingFile);

    // The abort signal stayed clean through the whole success path. The single
    // deleteFile here is the legitimate dedup temp-object cleanup, never an
    // abort-driven one.
    expect(abortObserved).toBe(false);
    expect(deleteFile).toHaveBeenCalledTimes(1);

    source.destroy();
  });

  it('restores a deduped cached-media object when the existing file record is missing storage', async () => {
    let resolveUpload: ((info: FileInfo) => void) | undefined;
    let capturedTempKey: string | undefined;

    const uploadStream = jest.fn(
      (key: string, _body: Readable): Promise<FileInfo> => {
        capturedTempKey = key;
        return new Promise<FileInfo>((resolve) => { resolveUpload = resolve; });
      }
    );
    const deleteFile = jest.fn((): Promise<void> => Promise.resolve());
    const fileExists = jest.fn((): Promise<boolean> => Promise.resolve(false));
    const copyFile = jest.fn((): Promise<void> => Promise.resolve());
    const { service } = buildAssetService({ uploadStream, deleteFile, fileExists, copyFile });

    const existingFile = {
      _id: { toString: () => '64c000000000000000000def' },
      sha256: 'known-sha',
      storageKey: 'content/2026/06/kn/known-sha.png',
      size: 4,
    };
    mockFileFindOne.mockResolvedValueOnce(existingFile);

    const source = new Readable({
      read() {
        this.push(Buffer.from('PNG!'));
        this.push(null);
      },
    });

    const promise = service.uploadCachedMediaStream(
      source,
      'image/png',
      'federation-cache-media',
      CACHE_MAX_BYTES
    );

    await new Promise((resolve) => setImmediate(resolve));
    resolveUpload?.({ key: capturedTempKey || 'cache/incoming/x', size: 4, contentType: 'image/png' } as FileInfo);

    await expect(promise).resolves.toBe(existingFile);

    expect(fileExists).toHaveBeenCalledWith(existingFile.storageKey);
    expect(copyFile).toHaveBeenCalledWith(capturedTempKey, existingFile.storageKey);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(capturedTempKey);

    source.destroy();
  });

  it('revives a deleted direct-upload record and restores its missing storage', async () => {
    const deleteFile = jest.fn((): Promise<void> => Promise.resolve());
    const fileExists = jest.fn((): Promise<boolean> => Promise.resolve(false));
    const uploadBuffer = jest.fn((key: string, buffer: Buffer, options?: UploadOptions): Promise<FileInfo> => Promise.resolve({
      key,
      size: buffer.length,
      contentType: options?.contentType || 'application/octet-stream',
    } as FileInfo));
    const { service } = buildAssetService({ deleteFile, fileExists, uploadBuffer });

    const existingFile = {
      _id: { toString: () => '64c000000000000000000fed' },
      sha256: 'deduped-sha',
      storageKey: 'content/2026/06/de/deduped-sha.jpg',
      status: 'deleted',
      ownerUserId: '__federation__',
      purpose: 'user',
      size: 4,
      mime: 'image/jpeg',
      ext: '.jpg',
      originalName: 'old-avatar.jpg',
      visibility: 'public',
      metadata: { old: true },
      links: [{ app: 'old', entityType: 'profile', entityId: 'old', createdBy: 'old', createdAt: new Date() }],
      variants: [{ type: 'thumb', key: 'variants/old/thumb.webp', readyAt: new Date() }],
      save: jest.fn((): Promise<void> => Promise.resolve()),
    };
    mockFileFindOne.mockResolvedValueOnce(existingFile);

    const result = await service.uploadFileDirect(
      'fresh-owner',
      Buffer.from('JPEG'),
      'image/jpeg',
      'fresh-avatar.jpg',
      'public',
      { source: 'federation-avatar' }
    );

    expect(result).toBe(existingFile);
    expect(fileExists).toHaveBeenCalledWith(existingFile.storageKey);
    expect(uploadBuffer).toHaveBeenCalledWith(existingFile.storageKey, Buffer.from('JPEG'), { contentType: 'image/jpeg' });
    expect(existingFile.status).toBe('active');
    expect(existingFile.ownerUserId).toBe('fresh-owner');
    expect(existingFile.originalName).toBe('fresh-avatar.jpg');
    expect(existingFile.metadata).toEqual({ source: 'federation-avatar' });
    expect(existingFile.links).toEqual([]);
    expect(existingFile.variants).toEqual([]);
    expect(existingFile.save).toHaveBeenCalledTimes(1);
    expect(mockGenerateVariants).toHaveBeenCalledWith(existingFile._id.toString());
  });

  it('revives a deleted cached-media record after deduplicating streamed media', async () => {
    let resolveUpload: ((info: FileInfo) => void) | undefined;
    let capturedTempKey: string | undefined;

    const uploadStream = jest.fn(
      (key: string, _body: Readable): Promise<FileInfo> => {
        capturedTempKey = key;
        return new Promise<FileInfo>((resolve) => { resolveUpload = resolve; });
      }
    );
    const deleteFile = jest.fn((): Promise<void> => Promise.resolve());
    const fileExists = jest.fn((): Promise<boolean> => Promise.resolve(false));
    const copyFile = jest.fn((): Promise<void> => Promise.resolve());
    const { service } = buildAssetService({ uploadStream, deleteFile, fileExists, copyFile });

    const existingFile = {
      _id: { toString: () => '64c000000000000000000cab' },
      sha256: 'deleted-cache-sha',
      storageKey: 'content/2026/06/de/deleted-cache-sha.png',
      status: 'deleted',
      ownerUserId: '__federation__',
      purpose: 'federation-media-cache',
      size: 4,
      mime: 'image/png',
      ext: '.png',
      originalName: 'old-cache.png',
      visibility: 'public',
      metadata: { old: true },
      links: [{ app: 'mention', entityType: 'post', entityId: 'old', createdBy: 'old', createdAt: new Date() }],
      variants: [{ type: 'thumb', key: 'variants/old/thumb.webp', readyAt: new Date() }],
      save: jest.fn((): Promise<void> => Promise.resolve()),
    };
    mockFileFindOne.mockResolvedValueOnce(existingFile);

    const source = new Readable({
      read() {
        this.push(Buffer.from('PNG!'));
        this.push(null);
      },
    });

    const promise = service.uploadCachedMediaStream(
      source,
      'image/png',
      'federation-cache-media',
      CACHE_MAX_BYTES
    );

    await new Promise((resolve) => setImmediate(resolve));
    resolveUpload?.({ key: capturedTempKey || 'cache/incoming/x', size: 4, contentType: 'image/png' } as FileInfo);

    await expect(promise).resolves.toBe(existingFile);

    expect(fileExists).toHaveBeenCalledWith(existingFile.storageKey);
    expect(copyFile).toHaveBeenCalledWith(capturedTempKey, existingFile.storageKey);
    expect(deleteFile).toHaveBeenCalledWith(capturedTempKey);
    expect(existingFile.status).toBe('active');
    expect(existingFile.ownerUserId).toBe('__federation_media_cache__');
    expect(existingFile.purpose).toBe('federation-media-cache');
    expect(existingFile.metadata).toEqual({});
    expect(existingFile.links).toEqual([]);
    expect(existingFile.variants).toEqual([]);
    expect(existingFile.save).toHaveBeenCalledTimes(1);
    expect(mockGenerateVariants).toHaveBeenCalledWith(existingFile._id.toString());

    source.destroy();
  });
});
