/**
 * OxyServices Shared Entry Point
 *
 * Platform-agnostic utilities that work everywhere:
 * - Browser (Web, Expo Web)
 * - React Native (iOS, Android)
 * - Node.js (Backend)
 *
 * This module contains NO React, React Native, or browser-specific dependencies.
 *
 * @module shared
 *
 * @example
 * ```ts
 * // In any environment
 * import { darkenColor, normalizeTheme, withRetry } from '@oxyhq/services/shared';
 *
 * const darkBlue = darkenColor('#0066FF', 0.3);
 * const theme = normalizeTheme(userPreference);
 * const data = await withRetry(() => fetchData(), { maxRetries: 3 });
 * ```
 */

export * from './shared';
