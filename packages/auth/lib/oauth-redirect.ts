// Native app schemes that are allowed as redirect targets.
const ALLOWED_NATIVE_SCHEMES = ['astro:'];

/** Validate and normalize an OAuth redirect_uri for authorize flows. */
export function safeRedirectUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)) {
        return null;
      }
      if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
        return parsed.origin;
      }
      return parsed.toString();
    }
    if (ALLOWED_NATIVE_SCHEMES.includes(parsed.protocol)) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}
