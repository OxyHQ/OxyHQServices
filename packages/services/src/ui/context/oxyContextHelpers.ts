import type { UseFollowHook } from '../hooks/useFollow.types';
import { useFollow } from '../hooks/useFollow';

/** Local display hint when a session lacks explicit `expiresAt` (7 days). */
export const DEFAULT_SESSION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

export function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  if ('status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  if ('response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'status' in response) {
      const status = (response as { status?: unknown }).status;
      if (typeof status === 'number') {
        return status;
      }
    }
  }
  return undefined;
}

export function isUnauthorizedStatus(error: unknown): boolean {
  return getHttpStatus(error) === 401;
}

/**
 * Resolve the `useFollow` hook at CALL time.
 *
 * `useFollow` imports `OxyContext`, which imports this module, so reading the
 * binding while that cycle is mid-evaluation would observe it uninitialized.
 * The function body defers the read until a consumer actually asks for the
 * hook, by which point every module has evaluated.
 *
 * This used to be a `require()` inside a try/catch. It must not be: a
 * `require()` in the package's ESM output pushes bundlers into CJS interop and
 * silently yields `undefined` bindings — see the note on `screenComponents` in
 * `../navigation/routes`. The hook ships in this same bundle, so there is no
 * "unavailable" case to fall back from.
 */
export const loadUseFollowHook = (): UseFollowHook => useFollow;
