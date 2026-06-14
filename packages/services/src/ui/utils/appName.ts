import { Platform } from 'react-native';

/**
 * The `storageKeyPrefix` default applied by `OxyContextProvider`. When the
 * consumer never overrides it, the prefix carries no app-identity signal and
 * must NOT be used to derive a display name (it would surface "Oxy_session").
 */
const DEFAULT_STORAGE_KEY_PREFIX = 'oxy_session';

/**
 * Capitalize the first character of a non-empty string. Used to turn a lower
 * case `storageKeyPrefix` (e.g. `"mention"`) into a presentable label
 * (`"Mention"`). Pure; leaves the remainder untouched so multi-word or already
 * capitalized values are preserved.
 */
function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Resolve a human-readable application display name for the consent / sign-in
 * UI shown by the central Oxy auth experience (e.g. "Mention wants to access
 * your Oxy account"). This is sent as the `appId` field on
 * `POST /auth/session/create` and rendered verbatim by the auth consent page.
 *
 * Resolution order (first non-empty wins):
 *   1. An explicit `appName` declared by the consumer on `OxyProvider`.
 *   2. The capitalized `storageKeyPrefix` — but only when the consumer actually
 *      overrode the default. Apps already pass a brand-shaped prefix
 *      (`"mention"`, `"homiio"`, …) so this gives most apps a correct name with
 *      zero extra config.
 *   3. On web only, a meaningful `document.title` (trimmed). This rescues
 *      zero-config web apps that set a page title but no prefix.
 *   4. `Platform.OS` as the terminal fallback. On web this yields the historical
 *      `"web"` value — now reached ONLY when an app supplies neither an explicit
 *      name, a custom prefix, nor a document title.
 *
 * The result is never empty.
 */
export function resolveAppDisplayName(
  appName: string | undefined,
  storageKeyPrefix: string | undefined,
): string {
  const explicit = appName?.trim();
  if (explicit) {
    return explicit;
  }

  const prefix = storageKeyPrefix?.trim();
  if (prefix && prefix !== DEFAULT_STORAGE_KEY_PREFIX) {
    return capitalizeFirst(prefix);
  }

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const title = document.title?.trim();
    if (title) {
      return title;
    }
  }

  return Platform.OS;
}
