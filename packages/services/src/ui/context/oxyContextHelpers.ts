import type { UseFollowHook } from '../hooks/useFollow.types';
import { logger as loggerUtil } from '@oxyhq/core';

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

let cachedUseFollowHook: UseFollowHook | null = null;

export const loadUseFollowHook = (): UseFollowHook => {
  if (cachedUseFollowHook) {
    return cachedUseFollowHook;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useFollow } = require('../hooks/useFollow');
    cachedUseFollowHook = useFollow as UseFollowHook;
    return cachedUseFollowHook;
  } catch (error) {
    if (__DEV__) {
      loggerUtil.warn(
        'useFollow hook is not available. Please import useFollow from @oxyhq/services directly.',
        { component: 'OxyContext', method: 'loadUseFollowHook' },
        error,
      );
    }
    const fallback: UseFollowHook = () => {
      throw new Error('useFollow hook is only available in the UI bundle. Import it from @oxyhq/services.');
    };
    cachedUseFollowHook = fallback;
    return cachedUseFollowHook;
  }
};
