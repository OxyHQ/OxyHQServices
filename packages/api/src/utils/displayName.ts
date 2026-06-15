/**
 * Authoritative server-side display-name composition.
 *
 * Single source of truth for the `User.displayName` virtual (see `models/User.ts`).
 * Extracted as a pure function so the composition rules are unit-testable in
 * isolation — the API jest setup mocks Mongoose entirely, so the model's
 * virtual getter never actually runs under test; the rules are verified here
 * against this helper instead.
 *
 * This is the DERIVED default only. It does NOT replace any raw field — callers
 * that want the structured name keep reading `name.first` / `name.last` /
 * `name.full` / `username` directly.
 */

interface NameParts {
  first?: string | null;
  last?: string | null;
}

interface DisplayNameSource {
  name?: NameParts | null;
  username?: string | null;
  publicKey?: string | null;
}

/**
 * Compose the human full name from `first` / `last`.
 *
 * First-only is valid — there is NO requirement that both parts exist. Returns
 * an empty string when neither part is a non-empty string.
 */
export function composeFullName(name: NameParts | null | undefined): string {
  if (!name || typeof name !== 'object') {
    return '';
  }
  const first = typeof name.first === 'string' ? name.first : '';
  const last = typeof name.last === 'string' ? name.last : '';
  return [first, last].filter(Boolean).join(' ').trim();
}

/**
 * Truncate a public key into a short, human-readable handle.
 *
 * `0x`-prefixed keys keep the prefix; otherwise the bare hex is truncated.
 * Returns `undefined` when the input is not a usable string.
 */
export function truncatePublicKeyHandle(publicKey: string | null | undefined): string | undefined {
  if (!publicKey || typeof publicKey !== 'string') {
    return undefined;
  }
  if (publicKey.startsWith('0x')) {
    return `0x${publicKey.slice(2, 8)}...${publicKey.slice(-6)}`;
  }
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`;
}

/**
 * Compose the authoritative default display name in preference order:
 *
 *   1. `name.full` (composed from `name.first` / `name.last`; first-only valid)
 *   2. `username`
 *   3. truncated `publicKey` handle
 *   4. `'Anonymous'`
 */
export function composeDisplayName(source: DisplayNameSource): string {
  const full = composeFullName(source.name);
  if (full) {
    return full;
  }

  if (typeof source.username === 'string' && source.username.trim()) {
    return source.username;
  }

  const handle = truncatePublicKeyHandle(source.publicKey);
  if (handle) {
    return handle;
  }

  return 'Anonymous';
}
