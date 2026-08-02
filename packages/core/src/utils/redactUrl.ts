/**
 * URL redaction for logging.
 *
 * Asset URLs the API hands back for private assets carry a scoped, short-lived
 * media token (`mt=…`) in their query string. That token is a bearer credential
 * for the underlying object, so it must never land in a log line, breadcrumb,
 * or metric — a captured log would otherwise grant read access until the token
 * expires. Query strings on API URLs can also carry other sensitive params, so
 * we redact the whole query rather than allow-listing one key.
 *
 * `redactUrlQuery` returns the URL's path portion with a `?<redacted>` marker
 * when a query string is present, and the input unchanged otherwise. It is
 * defensive: any input that does not parse as a URL is passed through as-is,
 * except that a bare `?query` tail is still stripped so a relative path with a
 * query never leaks.
 */
export function redactUrlQuery(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }

  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    return url;
  }

  return `${url.slice(0, queryIndex)}?<redacted>`;
}
