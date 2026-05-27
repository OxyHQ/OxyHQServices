/**
 * App-Data Mixin Tests
 *
 * Exercises the typed helpers around `/users/me/app-data/...`. We stub
 * `makeRequest` so the tests run without a network or a database — what we
 * care about here is request shape (method, URL, body), identifier
 * validation, and response handling (`null` when missing, echo on write).
 *
 * The mixin sits behind `withAuthRetry`, which polls for a token before
 * running the operation. We force a token in via `__resetTokensForTests`'
 * companion path (set access token directly) so the auth wait short-circuits.
 */

import { OxyServices } from '../../OxyServices';
import { OxyAppDataIdentifierError } from '../OxyServices.appData';

const setAccessTokenForTest = (oxy: OxyServices): void => {
  // Tokens are managed by HttpService — `hasAccessToken()` is the gate the
  // `withAuthRetry` loop polls. Reaching in via the public httpService and
  // calling setTokens with a dummy avoids us needing to expose new test
  // hooks just for this.
  oxy.httpService.setTokens('test-token', '');
};

describe('OxyServices.appData', () => {
  let oxy: OxyServices;
  let makeRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    setAccessTokenForTest(oxy);
    makeRequestSpy = jest.spyOn(oxy, 'makeRequest');
  });

  afterEach(() => {
    makeRequestSpy.mockRestore();
  });

  describe('getAppData', () => {
    it('returns the stored value when the API responds with one', async () => {
      makeRequestSpy.mockResolvedValue({ value: { completed: ['intro'] } });

      const result = await oxy.getAppData<{ completed: string[] }>(
        'academy',
        'getting-started',
      );

      expect(result).toEqual({ completed: ['intro'] });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/users/me/app-data/academy/getting-started',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });

    it('returns null when the API responds with `value: null`', async () => {
      makeRequestSpy.mockResolvedValue({ value: null });
      const result = await oxy.getAppData('academy', 'unknown');
      expect(result).toBeNull();
    });

    it('returns null when the response object is missing `value`', async () => {
      makeRequestSpy.mockResolvedValue({});
      const result = await oxy.getAppData('academy', 'unknown');
      expect(result).toBeNull();
    });

    it('URL-encodes namespace and key path segments', async () => {
      makeRequestSpy.mockResolvedValue({ value: 'ok' });
      await oxy.getAppData('a-b_c', 'd-e_f');
      // URL-encoding is a no-op for our allowed character set, but we still
      // run through encodeURIComponent — make sure that's wired so the call
      // site doesn't accidentally bypass it later.
      expect(makeRequestSpy.mock.calls[0][1]).toBe('/users/me/app-data/a-b_c/d-e_f');
    });

    it('throws OxyAppDataIdentifierError for invalid namespace', async () => {
      await expect(oxy.getAppData('Bad Namespace', 'k')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });

    it('throws OxyAppDataIdentifierError for invalid key', async () => {
      await expect(oxy.getAppData('ns', 'Bad/Key')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });

    it('rejects empty identifiers (regex requires at least one char)', async () => {
      await expect(oxy.getAppData('', 'k')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
      await expect(oxy.getAppData('n', '')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
    });

    it('rejects identifiers longer than 64 chars', async () => {
      const tooLong = 'a'.repeat(65);
      await expect(oxy.getAppData(tooLong, 'k')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
    });

    it('surfaces API errors (e.g. 401) via withAuthRetry', async () => {
      const err = Object.assign(new Error('Authentication required'), {
        response: { status: 401 },
      });
      makeRequestSpy.mockRejectedValue(err);
      await expect(oxy.getAppData('academy', 'getting-started')).rejects.toThrow();
    });
  });

  describe('setAppData', () => {
    it('writes the value and returns the server-echoed value', async () => {
      makeRequestSpy.mockResolvedValue({ value: { completed: ['intro'] } });

      const result = await oxy.setAppData('academy', 'getting-started', {
        completed: ['intro'],
      });

      expect(result).toEqual({ completed: ['intro'] });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'PUT',
        '/users/me/app-data/academy/getting-started',
        { value: { completed: ['intro'] } },
        expect.objectContaining({ cache: false }),
      );
    });

    it('falls back to the caller value when the server response omits it', async () => {
      makeRequestSpy.mockResolvedValue({});
      const result = await oxy.setAppData('academy', 'k', 'hello');
      expect(result).toBe('hello');
    });

    it('throws OxyAppDataIdentifierError before issuing a request', async () => {
      await expect(oxy.setAppData('UPPER', 'k', 1)).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe('deleteAppData', () => {
    it('issues a DELETE and resolves', async () => {
      makeRequestSpy.mockResolvedValue(undefined);

      await expect(oxy.deleteAppData('academy', 'getting-started')).resolves.toBeUndefined();
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'DELETE',
        '/users/me/app-data/academy/getting-started',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });

    it('throws OxyAppDataIdentifierError on invalid identifiers', async () => {
      await expect(oxy.deleteAppData('ns', 'BAD KEY')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
    });
  });

  describe('listAppData', () => {
    it('returns the entries map from the API', async () => {
      makeRequestSpy.mockResolvedValue({
        entries: {
          'getting-started': { completed: ['intro'] },
          'using-oxy-id': { completed: [] },
        },
      });

      const result = await oxy.listAppData<{ completed: string[] }>('academy');

      expect(result).toEqual({
        'getting-started': { completed: ['intro'] },
        'using-oxy-id': { completed: [] },
      });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/users/me/app-data/academy',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });

    it('returns an empty object when the API returns no entries', async () => {
      makeRequestSpy.mockResolvedValue({});
      const result = await oxy.listAppData('academy');
      expect(result).toEqual({});
    });

    it('throws OxyAppDataIdentifierError on invalid namespace', async () => {
      await expect(oxy.listAppData('Bad Namespace')).rejects.toBeInstanceOf(
        OxyAppDataIdentifierError,
      );
    });
  });
});
