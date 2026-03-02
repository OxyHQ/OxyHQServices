/**
 * HTML Transform Utilities for Email Content
 *
 * Transforms email HTML to route external resources through our proxy,
 * providing CORS bypass and tracking protection.
 */

const INTERNAL_DOMAINS = ['oxy.so', 'localhost', '127.0.0.1'];

function isExternalUrl(url: string): boolean {
  if (!url || url.startsWith('data:') || url.startsWith('#') || url.startsWith('/')) {
    return false;
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const { hostname } = new URL(url);
      return !INTERNAL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
    } catch {
      return false;
    }
  }

  return false;
}

function buildProxyUrl(originalUrl: string, proxyBaseUrl: string): string {
  // btoa() only handles Latin1 — encode as UTF-8 first to avoid DOMException
  // on internationalized URLs. The backend decodes with Buffer.from(x, 'base64').toString('utf-8').
  const bytes = new TextEncoder().encode(originalUrl);
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const encoded = btoa(binary);
  return `${proxyBaseUrl}?url=${encodeURIComponent(encoded)}`;
}

/**
 * Transform email HTML to route external images and fonts through our proxy.
 */
export function proxyExternalImages(html: string, proxyBaseUrl: string): string {
  if (!html || !proxyBaseUrl) return html;

  // Transform <img src="...">
  let result = html.replace(
    /(<img[^>]+src\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, src, suffix) =>
      isExternalUrl(src) ? `${prefix}${buildProxyUrl(src, proxyBaseUrl)}${suffix}` : match
  );

  // Transform <source srcset="...">
  result = result.replace(
    /(<source[^>]+srcset\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, srcset, suffix) => {
      const transformed = srcset
        .split(',')
        .map((entry: string) => {
          const [url, ...rest] = entry.trim().split(/\s+/);
          if (isExternalUrl(url)) {
            return rest.length ? `${buildProxyUrl(url, proxyBaseUrl)} ${rest.join(' ')}` : buildProxyUrl(url, proxyBaseUrl);
          }
          return entry;
        })
        .join(', ');
      return `${prefix}${transformed}${suffix}`;
    }
  );

  // Transform url(...) in CSS
  result = result.replace(
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    (match, url) => (isExternalUrl(url) ? `url("${buildProxyUrl(url, proxyBaseUrl)}")` : match)
  );

  return result;
}

/**
 * Replace cid: references in email HTML with actual attachment URLs.
 */
export function resolveCidImages(html: string, cidMap: Record<string, string>): string {
  if (!html || Object.keys(cidMap).length === 0) return html;
  return html.replace(
    /(['"])cid:([^'"]+)(['"])/gi,
    (match, q1, cid, q2) => {
      const url = cidMap[cid];
      return url ? `${q1}${url}${q2}` : match;
    },
  );
}

/**
 * Get the proxy base URL based on the current environment
 */
export function getProxyBaseUrl(): string {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';
  return `${apiUrl}/email/proxy`;
}
