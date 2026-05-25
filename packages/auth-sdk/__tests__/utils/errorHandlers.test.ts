/**
 * Tests for `@oxyhq/auth` error utilities.
 *
 * The web SDK uses the same `isInvalidSessionError` predicate as the RN
 * SDK to decide when to clear local session state versus surface a
 * generic error. The two implementations are deliberately kept in
 * lockstep — these tests pin the shared contract on the web side.
 */

import {
  extractErrorMessage,
  handleAuthError,
  isInvalidSessionError,
  isTimeoutOrNetworkError,
} from '../../src/utils/errorHandlers';

describe('isInvalidSessionError (auth-sdk)', () => {
  it('detects axios-style 401', () => {
    expect(isInvalidSessionError({ response: { status: 401 } })).toBe(true);
  });

  it('detects HttpService-shape error.status === 401', () => {
    expect(isInvalidSessionError({ status: 401, message: 'x' })).toBe(true);
  });

  it('matches "HTTP 401:" message format', () => {
    expect(isInvalidSessionError({ message: 'HTTP 401: invalid' })).toBe(true);
  });

  it('matches invalid-session prose patterns', () => {
    expect(isInvalidSessionError({ message: 'Session expired' })).toBe(true);
    expect(isInvalidSessionError({ message: 'Session not found' })).toBe(true);
  });

  it('rejects 4xx that are not 401', () => {
    expect(isInvalidSessionError({ response: { status: 403 } })).toBe(false);
    expect(isInvalidSessionError({ response: { status: 404 } })).toBe(false);
  });

  it('rejects primitives and null', () => {
    expect(isInvalidSessionError(null)).toBe(false);
    expect(isInvalidSessionError(undefined)).toBe(false);
    expect(isInvalidSessionError('error')).toBe(false);
  });
});

describe('isTimeoutOrNetworkError (auth-sdk)', () => {
  it('matches the well-known error codes', () => {
    expect(isTimeoutOrNetworkError({ code: 'TIMEOUT', message: 'x' })).toBe(true);
    expect(isTimeoutOrNetworkError({ code: 'NETWORK_ERROR', message: 'x' })).toBe(true);
    expect(isTimeoutOrNetworkError({ code: 'ECONNABORTED', message: 'x' })).toBe(true);
  });

  it('matches AbortError', () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    expect(isTimeoutOrNetworkError(e)).toBe(true);
  });

  it('matches "Failed to fetch" TypeError', () => {
    expect(isTimeoutOrNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('rejects regular server errors', () => {
    expect(isTimeoutOrNetworkError({ status: 500 })).toBe(false);
  });
});

describe('extractErrorMessage (auth-sdk)', () => {
  it('prefers error.message', () => {
    expect(extractErrorMessage({ message: 'boom' })).toBe('boom');
  });

  it('falls back to response.data.message', () => {
    expect(extractErrorMessage({ response: { data: { message: 'server says no' } } }))
      .toBe('server says no');
  });

  it('returns fallback for empty input', () => {
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
    expect(extractErrorMessage('', 'fallback')).toBe('fallback');
  });
});

describe('handleAuthError (auth-sdk)', () => {
  it('reports a normalized ApiError to onError', () => {
    const onError = jest.fn();
    const setAuthError = jest.fn();
    handleAuthError({ response: { status: 401 }, message: 'expired' }, {
      defaultMessage: 'fail',
      code: 'LOGIN_ERROR',
      onError,
      setAuthError,
    });
    expect(onError).toHaveBeenCalledWith({
      message: 'expired',
      code: 'LOGIN_ERROR',
      status: 401,
    });
    expect(setAuthError).toHaveBeenCalledWith('expired');
  });

  it('defaults to status 500 when unknown', () => {
    const onError = jest.fn();
    handleAuthError(undefined, { defaultMessage: 'X', code: 'C', onError });
    expect(onError).toHaveBeenCalledWith({
      message: 'X',
      code: 'C',
      status: 500,
    });
  });
});
