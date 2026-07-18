/**
 * `redactUrlQuery` tests — the query-string scrubber used before any asset URL
 * reaches a log sink. Asset stream URLs carry a scoped `mt=` media token that
 * is a bearer credential; it must never be logged.
 */

import { redactUrlQuery } from '../redactUrl';

describe('redactUrlQuery', () => {
  it('strips the query string (including a media token) from an absolute URL', () => {
    const redacted = redactUrlQuery(
      'https://api.oxy.so/assets/priv1/stream?variant=thumb&mt=SECRET-TOKEN',
    );
    expect(redacted).toBe('https://api.oxy.so/assets/priv1/stream?<redacted>');
    expect(redacted).not.toContain('mt=');
    expect(redacted).not.toContain('SECRET-TOKEN');
  });

  it('strips the query string from a relative path too', () => {
    expect(redactUrlQuery('/assets/priv1/url?expiresIn=600&mt=SECRET')).toBe(
      '/assets/priv1/url?<redacted>',
    );
  });

  it('returns a URL without a query string unchanged', () => {
    expect(redactUrlQuery('https://cloud.oxy.so/pub1')).toBe('https://cloud.oxy.so/pub1');
    expect(redactUrlQuery('/assets')).toBe('/assets');
  });

  it('passes through empty input', () => {
    expect(redactUrlQuery('')).toBe('');
  });
});
