/**
 * Web-browser detection for `@oxyhq/services`.
 *
 * The predicate now lives ONCE in `@oxyhq/core` (`isWebBrowser`) so services and
 * auth-sdk share the exact same DOM probe. This module re-exposes it under the
 * existing internal import path so consumers stay unchanged.
 */
export { isWebBrowser } from '@oxyhq/core';
