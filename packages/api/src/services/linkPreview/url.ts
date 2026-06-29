/**
 * The hostname of a URL string, or `undefined` when the input cannot be parsed.
 * Shared by the resolver's site-name fallback and the cache's `isUsablePreview`
 * hostname-vs-title check so the parse + failure handling live in one place.
 */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
