/**
 * Non-destructive redirect-uri helpers. Official-app reconciliation must never
 * replace an existing allowlist — only append missing canonical entries.
 */

/** Union preserving order: existing entries first, then additions, de-duplicated. */
export function unionRedirectUris(
  current: readonly string[] | null | undefined,
  additions: readonly string[],
): string[] {
  return Array.from(new Set([...(current ?? []), ...additions]));
}

/** Exact-match helper — redirect URIs are compared literally, not by prefix. */
export function includesRedirectUri(
  allowlist: readonly string[] | null | undefined,
  uri: string,
): boolean {
  if (!allowlist?.length) return false;
  return allowlist.some((entry) => entry === uri);
}

export function originOfWebsiteUrl(websiteUrl: string): string | null {
  try {
    return new URL(websiteUrl.trim()).origin;
  } catch {
    return null;
  }
}

/**
 * When a trusted app's `websiteUrl` origin is missing from `redirectUris`,
 * return the unioned allowlist that repairs it. Returns `null` when no change
 * is needed or the website URL is unusable.
 */
export function computeOfficialRedirectUriRepair(
  redirectUris: readonly string[] | null | undefined,
  websiteUrl: string | null | undefined,
): string[] | null {
  const trimmed = websiteUrl?.trim();
  if (!trimmed) return null;

  const origin = originOfWebsiteUrl(trimmed);
  if (!origin) return null;
  if (includesRedirectUri(redirectUris, origin)) return null;

  return unionRedirectUris(redirectUris, [origin]);
}
