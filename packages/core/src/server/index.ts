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

export { createOxyRateLimit } from './rateLimit';
export type { OxyRateLimitOptions } from './rateLimit';
