/**
 * HTML Transform Utilities for Email Content
 *
 * Transforms email HTML to route external resources through our proxy,
 * providing CORS bypass and tracking protection.
 */

/**
 * Check if a URL is external (not our own domain)
 */
function isExternalUrl(url: string): boolean {
  // Skip data URIs, relative URLs, and anchors
  if (!url || url.startsWith('data:') || url.startsWith('#') || url.startsWith('/')) {
    return false;
  }

  // Check for absolute URLs
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      // Consider oxy.so domains as internal
      if (parsed.hostname.endsWith('oxy.so') || parsed.hostname === 'localhost') {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Build a proxy URL for an external resource
 */
function buildProxyUrl(originalUrl: string, proxyBaseUrl: string): string {
  // Use base64 encoding to preserve special characters in URLs
  const encoded = btoa(originalUrl);
  return `${proxyBaseUrl}?url=${encodeURIComponent(encoded)}`;
}

/**
 * Transform email HTML to route external images and fonts through our proxy.
 *
 * This provides:
 * - CORS bypass for images blocked by CORP/CORS policies
 * - Tracking protection (our proxy blocks tracking pixels)
 * - IP privacy (external servers see our server's IP, not the user's)
 *
 * @param html - Raw email HTML content
 * @param proxyBaseUrl - Base URL for the proxy endpoint (e.g., "https://api.oxy.so/email/proxy")
 * @returns Transformed HTML with proxied image URLs
 */
export function proxyExternalImages(html: string, proxyBaseUrl: string): string {
  if (!html || !proxyBaseUrl) return html;

  let result = html;

  // 1. Transform <img src="..."> attributes
  result = result.replace(
    /(<img[^>]+src\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
    (match, prefix, src, suffix) => {
      if (isExternalUrl(src)) {
        const proxiedUrl = buildProxyUrl(src, proxyBaseUrl);
        return `${prefix}${proxiedUrl}${suffix}`;
      }
      return match;
    }
  );

  // 2. Transform <source srcset="..."> for picture elements
  result = result.replace(
    /(<source[^>]+srcset\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
    (match, prefix, srcset, suffix) => {
      // srcset can contain multiple URLs, transform each
      const transformedSrcset = srcset
        .split(',')
        .map((entry: string) => {
          const parts = entry.trim().split(/\s+/);
          const url = parts[0];
          const descriptor = parts.slice(1).join(' ');
          if (isExternalUrl(url)) {
            const proxiedUrl = buildProxyUrl(url, proxyBaseUrl);
            return descriptor ? `${proxiedUrl} ${descriptor}` : proxiedUrl;
          }
          return entry;
        })
        .join(', ');
      return `${prefix}${transformedSrcset}${suffix}`;
    }
  );

  // 3. Transform background-image: url(...) in inline styles
  result = result.replace(
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    (match, url) => {
      if (isExternalUrl(url)) {
        const proxiedUrl = buildProxyUrl(url, proxyBaseUrl);
        return `url("${proxiedUrl}")`;
      }
      return match;
    }
  );

  // 4. Transform @font-face src: url(...) in style blocks
  // Already handled by the url() replacement above

  return result;
}

/**
 * Get the proxy base URL based on the current environment
 */
export function getProxyBaseUrl(): string {
  // In development, use localhost
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001/email/proxy';
    }
  }

  // In production, use the API domain
  return 'https://api.oxy.so/email/proxy';
}
