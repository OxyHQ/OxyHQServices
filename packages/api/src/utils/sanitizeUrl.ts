const SENSITIVE_URL_QUERY_PARAMS = new Set(['token', 'access_token', 'authorization']);

/**
 * Remove credential-bearing query parameters before persisting user-supplied URLs.
 */
export function stripSensitiveUrlQueryParams(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  try {
    const url = new URL(trimmed);
    for (const param of SENSITIVE_URL_QUERY_PARAMS) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}
