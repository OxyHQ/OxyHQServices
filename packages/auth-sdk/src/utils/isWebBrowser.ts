/**
 * Web-browser environment detection for the web auth SDK.
 *
 * The predicate now lives ONCE in `@oxyhq/core` (`isWebBrowser`) so auth-sdk and
 * services share the exact same DOM probe. Re-exposed here so existing consumer
 * imports (`import { isWebBrowser } from '@oxyhq/auth'`) stay valid.
 */
export { isWebBrowser } from '@oxyhq/core';
