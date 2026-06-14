/**
 * Canonical origin-normalisation helper shared across the SSO controller, the
 * SSO router CORS guard, and the FedCM service.
 *
 * Normalises an origin string for equality / allow-list comparisons:
 *  - lowercases the scheme and the host;
 *  - preserves an explicit port (e.g. `:3000`), drops an implicit/default one;
 *  - drops any path, query, fragment, userinfo and trailing slash — only the
 *    `scheme://host[:port]` triple is reconstructed.
 *
 * Fails closed: returns `null` (never throws) when `value` is not a parseable
 * absolute origin (empty string, relative path, or otherwise invalid URL). The
 * caller decides how to treat the `null` — reject, skip, or substitute.
 *
 * @example
 *   normaliseOrigin('HTTPS://Example.com/path?q=1') // 'https://example.com'
 *   normaliseOrigin('https://example.com:3000/')     // 'https://example.com:3000'
 *   normaliseOrigin('not a url')                      // null
 */
export function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}`;
  } catch {
    return null;
  }
}
