/**
 * Discovery error-handling tests (C3).
 *
 * `resolveProfile` and `getProfileRecommendations` are best-effort discovery
 * reads. Previously they swallowed every failure identically (`catch { return
 * null }`), making a 404 "handle not found" indistinguishable from a 5xx /
 * network failure in the field. These tests pin down the hardened behavior:
 *
 *  - `resolveProfile` STILL returns `null` on any failure (contract unchanged),
 *    but emits a `debug` log that flags whether it was a not-found vs a failure.
 *  - `getProfileRecommendations` STILL rethrows (contract unchanged), but emits
 *    a `debug` log first for observability.
 */

import { OxyServices } from '../../OxyServices';
import { logger } from '../../utils/loggerUtils';

/** A JSON success `Response` mimicking the API's `{ data: ... }` envelope. */
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A JSON error `Response` with the given HTTP status. */
function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('discovery error handling', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>;
  let debugSpy: jest.SpyInstance;
  let oxy: OxyServices;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    // Disable retry so a single error response surfaces immediately.
    oxy = new OxyServices({ baseURL: 'http://test.invalid', enableRetry: false });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    debugSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('resolveProfile', () => {
    it('returns the normalized user when discovery succeeds', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'u1', username: 'remote' }));
      const result = await oxy.resolveProfile('remote@mastodon.social');
      expect(result?.id).toBe('u1');
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('returns null AND logs a not-found debug entry on 404', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(404, 'not found'));
      const result = await oxy.resolveProfile('ghost@nowhere.example');
      expect(result).toBeNull();
      expect(debugSpy).toHaveBeenCalledTimes(1);
      const [message, context] = debugSpy.mock.calls[0];
      expect(message).toContain('not found');
      expect(context).toMatchObject({
        method: 'resolveProfile',
        handle: 'ghost@nowhere.example',
        status: 404,
        notFound: true,
      });
    });

    it('returns null AND logs a failure (not not-found) debug entry on 5xx', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(503, 'upstream down'));
      const result = await oxy.resolveProfile('remote@down.example');
      expect(result).toBeNull();
      expect(debugSpy).toHaveBeenCalledTimes(1);
      const [message, context] = debugSpy.mock.calls[0];
      expect(message).toContain('discovery failed');
      expect(context).toMatchObject({
        method: 'resolveProfile',
        status: 503,
        notFound: false,
      });
    });

    it('returns null on a network failure (no status)', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await oxy.resolveProfile('remote@offline.example');
      expect(result).toBeNull();
      expect(debugSpy).toHaveBeenCalledTimes(1);
      const [, context] = debugSpy.mock.calls[0];
      expect(context).toMatchObject({ notFound: false });
    });
  });

  describe('getProfileRecommendations', () => {
    it('returns the list on success without logging', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'r1', username: 'rec' }]));
      const result = await oxy.getProfileRecommendations();
      expect(result).toHaveLength(1);
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('rethrows on failure AND logs a debug entry first (contract unchanged)', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'boom'));
      await expect(oxy.getProfileRecommendations()).rejects.toThrow();
      expect(debugSpy).toHaveBeenCalledTimes(1);
      const [message, context] = debugSpy.mock.calls[0];
      expect(message).toContain('discovery read failed');
      expect(context).toMatchObject({
        method: 'getProfileRecommendations',
        status: 500,
      });
    });
  });
});
