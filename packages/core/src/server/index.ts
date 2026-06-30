/**
 * @oxyhq/core/server — Server-only utilities for Oxy backends
 *
 * This subpath export provides Express middleware and Node.js-specific
 * utilities that are not available in React Native or browser environments.
 *
 * @example
 * ```ts
 * import { createOxyRateLimit } from '@oxyhq/core/server';
 * import { oxyClient } from '@oxyhq/core';
 *
 * const oxy = oxyClient({ apiUrl: 'https://api.oxy.so' });
 *
 * app.use(createOxyRateLimit(oxy, { store: redisStore }));
 * ```
 */

export {
  createOptionalOxyAuth,
  createOxyAuthMiddleware,
  getOxyUserId,
  getRequiredOxyUserId,
  isOxyAuthenticated,
  requireOxyAuth,
} from './auth';
export type {
  OxyAuthenticatedRequest,
  OxyAuthMiddlewareOptions,
  OxyAuthRequest,
  OxyRequestUser,
  OxyServiceActingAsContext,
  OxyServiceAppContext,
} from './auth';
export { createOxyRateLimit } from './rateLimit';
export type { OxyRateLimitOptions } from './rateLimit';

// SSRF-safe upstream fetch + URL validation (Node-only).
export {
  assertSafePublicUrl,
  isBlockedIp,
  safeFetch,
  SsrfRejection,
  UpstreamError,
  ALLOWED_PORTS,
  ALLOWED_PROTOCOLS,
  BLOCKED_HOSTNAMES,
  DEFAULT_USER_AGENT,
  MAX_REDIRECTS,
  MAX_URL_LENGTH,
  UPSTREAM_HEADERS_TIMEOUT_MS,
} from './safeFetch';
export type {
  SafeFetchOptions,
  SafeFetchResult,
  SsrfCheckFail,
  SsrfCheckOk,
  SsrfCheckResult,
} from './safeFetch';

// Strict CORS allowlist (Oxy apex family + explicit app origins).
export { createOxyCors } from './cors';
export type { OxyCorsOptions } from './cors';

// Constant-time secret comparison.
export { verifySecret } from './verifySecret';
