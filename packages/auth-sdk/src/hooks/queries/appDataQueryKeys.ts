/**
 * Query keys + error utilities for `useAppData` hooks.
 *
 * Lives next to the hook file so consumers can import the keys directly
 * when they need to imperatively invalidate a value (e.g. after a non-React
 * write through `oxyServices.setAppData`).
 */

export const appDataQueryKeys = {
  all: ['appData'] as const,
  namespaces: () => [...appDataQueryKeys.all, 'namespace'] as const,
  namespace: (namespace: string) =>
    [...appDataQueryKeys.namespaces(), namespace] as const,
  values: () => [...appDataQueryKeys.all, 'value'] as const,
  value: (namespace: string, key: string) =>
    [...appDataQueryKeys.values(), namespace, key] as const,
} as const;

/**
 * True when `error` indicates the app-data endpoint isn't reachable — either
 * because the API deployment doesn't have it yet (404) or there's a network
 * failure with no response. We treat these as "no value stored" so consumers
 * fall back to local persistence without surfacing a user-facing error.
 *
 * Anything else (401, 403, 500) propagates normally — those are real bugs
 * the auth or retry pipeline needs to see.
 */
export function isMissingAppDataEndpointError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    code?: string;
    message?: string;
  };
  const status =
    candidate.status ?? candidate.statusCode ?? candidate.response?.status;

  // 404: endpoint not deployed on this API instance yet.
  if (status === 404) return true;

  // Network errors: no response received at all. Common during local dev
  // when the API server is down, or when offline.
  if (candidate.code === 'NETWORK_ERROR') return true;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  if (message.includes('Network Error') || message.includes('Failed to fetch')) {
    return true;
  }
  return false;
}
