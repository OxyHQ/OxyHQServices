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
jest.mock('../../models/File', () => ({
  File: { findOne: jest.fn(), findById: jest.fn() },
  FileVisibility: {},
}));

// VariantService pulls in sharp/ffmpeg at import; it is never invoked on the
// abort path, so stub the module to keep this unit test focused and fast.
jest.mock('../variantService', () => ({
  VariantService: class { constructor(_s3: unknown) { /* no-op */ } },
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
  deleteFile: jest.Mock<Promise<void>, [string]>;
}

function buildAssetService(fake: FakeS3): { service: AssetService; fake: FakeS3 } {
  // AssetService only calls uploadStream/deleteFile on this path; satisfy the
  // S3Service contract via a typed cast of the method subset (never `any`).
  const service = new AssetService(fake as unknown as S3Service);
  return { service, fake };
}

describe('uploadCachedMediaStream — abort cleanup', () => {
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
});
