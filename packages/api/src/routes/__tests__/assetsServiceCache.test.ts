/**
 * Service-token media-cache scoping tests.
 *
 * Covers the federation media-cache surface added to the assets router:
 *   - POST   /assets/service/cache         (service token uploads cached media)
 *   - DELETE /assets/service/cache/:id      (service token evicts cache objects)
 *
 * Security invariants exercised:
 *   1. A service token CAN upload to the cache namespace → `{ file: { id } }`.
 *   2. An unsupported content-type is rejected with 415.
 *   3. A service token CAN delete a cache-namespace asset.
 *   4. A service token CANNOT delete a normal user-owned asset → 403.
 *   5. The existing session-only routes (POST /assets/upload, DELETE
 *      /assets/:id) still run through authMiddleware (NOT serviceAuthMiddleware)
 *      — i.e. a service token does not reach them.
 *
 * The asset service singleton, both auth middlewares, the rate limiter, and
 * the media/placeholder helpers are stubbed at the module boundary so the
 * router is exercised over real `node:http` round-trips with no S3 or DB.
 */

import express from 'express';
import http from 'http';
import { Readable } from 'stream';
import { AddressInfo } from 'net';

const CACHE_FILE_ID = '64c0000000000000000000ff';
const USER_FILE_ID = '64c0000000000000000000aa';

// A body larger than the global 1 MiB JSON/urlencoded parser limit. If C1's
// guard failed to bypass those parsers, the stream would be truncated/rejected.
const LARGE_BODY_BYTES = Math.floor(1.5 * 1024 * 1024);

const mockServiceAuthMiddleware = jest.fn();
const mockAuthMiddleware = jest.fn();
const mockOptionalAuthMiddleware = jest.fn();

const mockUploadCachedMediaStream = jest.fn();
const mockDeleteCachedMedia = jest.fn();
const mockUploadFileDirect = jest.fn();
const mockGetDeletionSummary = jest.fn();
const mockDeleteFile = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...args: unknown[]) => mockAuthMiddleware(...args),
  serviceAuthMiddleware: (...args: unknown[]) => mockServiceAuthMiddleware(...args),
}));

jest.mock('../../middleware/optionalAuth', () => ({
  optionalAuthMiddleware: (...args: unknown[]) => mockOptionalAuthMiddleware(...args),
  getUserId: () => undefined,
}));

jest.mock('../../middleware/mediaHeaders', () => ({
  mediaHeadersMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../utils/placeholders', () => ({
  generateMissingFilePlaceholder: () => '<svg/>',
  TRANSPARENT_PNG_PLACEHOLDER: '',
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/assetServiceSingleton', () => ({
  assetService: {
    uploadCachedMediaStream: (...args: unknown[]) => mockUploadCachedMediaStream(...args),
    deleteCachedMedia: (...args: unknown[]) => mockDeleteCachedMedia(...args),
    uploadFileDirect: (...args: unknown[]) => mockUploadFileDirect(...args),
    getDeletionSummary: (...args: unknown[]) => mockGetDeletionSummary(...args),
    deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  },
  s3Service: {},
}));

import assetsRouter from '../assets';
import { errorHandler } from '../../middleware/errorHandler';

interface JsonResponse {
  status: number;
  body: { data?: { file?: { id?: string }; message?: string }; error?: string; message?: string };
}

async function requestRaw(
  server: http.Server,
  method: string,
  path: string,
  headers: Record<string, string>,
  payload?: Buffer
): Promise<JsonResponse> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method, host: '127.0.0.1', port: address.port, path, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const parsed = raw.length > 0 ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let server: http.Server;

// Faithful replica of the production C1 guard (server.ts). The cache stream-
// upload route reads the raw request itself, so the global body parsers (and
// their 1 MiB limit) MUST be bypassed for POST to the cache path. The `/api`
// prefix strip runs after parsing in production, hence both forms are matched.
const CACHE_UPLOAD_PATH = '/assets/service/cache';
const CACHE_UPLOAD_PATH_API_PREFIXED = '/api/assets/service/cache';
function isCacheUploadRequest(req: express.Request): boolean {
  return (
    req.method === 'POST' &&
    (req.path === CACHE_UPLOAD_PATH || req.path === CACHE_UPLOAD_PATH_API_PREFIXED)
  );
}

beforeAll((done) => {
  const app = express();
  // Mirror production exactly: both global parsers are mounted with the C1
  // guard so a POST to the cache path bypasses them and the raw request reaches
  // the route as an untouched readable stream; every other request is parsed.
  const jsonParser = express.json({ limit: '1mb' });
  const urlencodedParser = express.urlencoded({ extended: true, limit: '1mb' });
  app.use((req, res, next) => (isCacheUploadRequest(req) ? next() : jsonParser(req, res, next)));
  app.use((req, res, next) => (isCacheUploadRequest(req) ? next() : urlencodedParser(req, res, next)));
  app.use('/assets', assetsRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default service principal: a valid service token.
  mockServiceAuthMiddleware.mockImplementation(
    (req: { serviceApp?: unknown }, _res: unknown, next: () => void) => {
      req.serviceApp = {
        type: 'service',
        appId: 'mention-app',
        appName: 'mention',
        scopes: [],
      };
      next();
    }
  );

  // Default user principal for session-only routes.
  mockAuthMiddleware.mockImplementation(
    (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { _id: '64b0000000000000000000aa', id: '64b0000000000000000000aa' };
      next();
    }
  );
  mockOptionalAuthMiddleware.mockImplementation(
    (_req: unknown, _res: unknown, next: () => void) => next()
  );
});

describe('POST /assets/service/cache', () => {
  it('lets a service token upload to the cache namespace and returns { file: { id } }', async () => {
    mockUploadCachedMediaStream.mockResolvedValueOnce({ _id: CACHE_FILE_ID, size: 1234 });

    const res = await requestRaw(
      server,
      'POST',
      '/assets/service/cache',
      { 'content-type': 'image/png', 'content-length': '4' },
      Buffer.from('PNG!')
    );

    expect(res.status).toBe(200);
    expect(res.body.data?.file?.id).toBe(CACHE_FILE_ID);
    expect(mockServiceAuthMiddleware).toHaveBeenCalledTimes(1);
    expect(mockUploadCachedMediaStream).toHaveBeenCalledTimes(1);
    // authMiddleware must NOT have run for this service route.
    expect(mockAuthMiddleware).not.toHaveBeenCalled();
  });

  it('rejects an unsupported content-type with 415 and never touches S3', async () => {
    const res = await requestRaw(
      server,
      'POST',
      '/assets/service/cache',
      { 'content-type': 'application/pdf', 'content-length': '4' },
      Buffer.from('%PDF')
    );

    expect(res.status).toBe(415);
    expect(mockUploadCachedMediaStream).not.toHaveBeenCalled();
  });

  it('rejects an SVG upload with 415 (stored-XSS vector) and never touches S3', async () => {
    const res = await requestRaw(
      server,
      'POST',
      '/assets/service/cache',
      { 'content-type': 'image/svg+xml', 'content-length': '14' },
      Buffer.from('<svg></svg>...')
    );

    expect(res.status).toBe(415);
    expect(mockUploadCachedMediaStream).not.toHaveBeenCalled();
  });

  it('streams a >1 MiB body intact through the real parser chain to the service', async () => {
    // The service stub consumes the request stream (the route hands it `req`)
    // and counts the bytes that actually arrive — proving the global 1 MiB
    // JSON/urlencoded limit did NOT truncate or reject the binary body.
    let bytesReceived = 0;
    mockUploadCachedMediaStream.mockImplementationOnce(async (source: Readable) => {
      for await (const chunk of source) {
        bytesReceived += (chunk as Buffer).length;
      }
      return { _id: CACHE_FILE_ID, size: bytesReceived };
    });

    const payload = Buffer.alloc(LARGE_BODY_BYTES, 0x61);
    const res = await requestRaw(
      server,
      'POST',
      '/assets/service/cache',
      { 'content-type': 'video/mp4', 'content-length': String(LARGE_BODY_BYTES) },
      payload
    );

    expect(res.status).toBe(200);
    expect(res.body.data?.file?.id).toBe(CACHE_FILE_ID);
    expect(mockUploadCachedMediaStream).toHaveBeenCalledTimes(1);
    // Full payload reached the service — no truncation by the 1 MiB parser.
    expect(bytesReceived).toBe(LARGE_BODY_BYTES);
  });
});

describe('DELETE /assets/service/cache/:id', () => {
  it('lets a service token delete a cache-namespace asset', async () => {
    mockDeleteCachedMedia.mockResolvedValueOnce({ deleted: true, outOfScope: false });

    const res = await requestRaw(
      server,
      'DELETE',
      `/assets/service/cache/${CACHE_FILE_ID}`,
      {}
    );

    expect(res.status).toBe(200);
    expect(mockDeleteCachedMedia).toHaveBeenCalledWith(CACHE_FILE_ID);
    expect(mockAuthMiddleware).not.toHaveBeenCalled();
  });

  it('refuses to delete a normal user-owned asset (out of scope) with 403', async () => {
    mockDeleteCachedMedia.mockResolvedValueOnce({ deleted: false, outOfScope: true });

    const res = await requestRaw(
      server,
      'DELETE',
      `/assets/service/cache/${USER_FILE_ID}`,
      {}
    );

    expect(res.status).toBe(403);
    // Crucially the user-facing deleteFile path is never reached.
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('returns 404 when the cache asset does not exist', async () => {
    mockDeleteCachedMedia.mockResolvedValueOnce({ deleted: false, outOfScope: false });

    const res = await requestRaw(
      server,
      'DELETE',
      `/assets/service/cache/${CACHE_FILE_ID}`,
      {}
    );

    expect(res.status).toBe(404);
  });
});

describe('existing session-only routes are unchanged', () => {
  it('POST /assets/upload runs through authMiddleware, not serviceAuthMiddleware', async () => {
    // The session-only multipart upload route is wired to authMiddleware. We
    // assert the auth middleware that fronts it is authMiddleware by sending a
    // request and confirming serviceAuthMiddleware never fires for it.
    mockAuthMiddleware.mockImplementationOnce(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Authentication required' });
      }
    );

    const res = await requestRaw(
      server,
      'POST',
      '/assets/upload',
      { 'content-type': 'application/json', 'content-length': '2' },
      Buffer.from('{}')
    );

    expect(res.status).toBe(401);
    expect(mockAuthMiddleware).toHaveBeenCalledTimes(1);
    expect(mockServiceAuthMiddleware).not.toHaveBeenCalled();
  });

  it('DELETE /assets/:id runs through authMiddleware, not serviceAuthMiddleware', async () => {
    mockAuthMiddleware.mockImplementationOnce(
      (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'Authentication required' });
      }
    );

    const res = await requestRaw(
      server,
      'DELETE',
      `/assets/${USER_FILE_ID}`,
      {}
    );

    expect(res.status).toBe(401);
    expect(mockAuthMiddleware).toHaveBeenCalledTimes(1);
    expect(mockServiceAuthMiddleware).not.toHaveBeenCalled();
  });
});
