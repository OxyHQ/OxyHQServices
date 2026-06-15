/**
 * Resolve a human-friendly user identifier (username OR email) to a User
 * document.
 *
 * Member-invite endpoints accept an identifier that real people actually know —
 * a username or an email address — instead of an opaque Mongo `_id`. This helper
 * centralises the "username or email → user" resolution so both the workspace
 * and the application invite paths behave identically.
 *
 * Detection + casing:
 *  - An identifier containing `@` is treated as an EMAIL and matched against the
 *    `email` field lowercased. The `User` schema stores `email` with
 *    `lowercase: true`, so the stored value is already lowercase — lowercasing
 *    the query gives an exact, case-insensitive match.
 *  - Otherwise the identifier is treated as a USERNAME and matched
 *    case-insensitively against the `username` field. Usernames are stored
 *    trimmed but NOT lowercased, so an anchored case-insensitive regex is used
 *    for an exact (non-substring) match. The identifier is regex-escaped to
 *    avoid metacharacter injection.
 *
 * Returns the matching user, or `null` when none is found or the (trimmed)
 * identifier is empty.
 */

import { User, IUser } from '../models/User';

/** Escape regex metacharacters so the identifier matches literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a username or email to its `User` document.
 *
 * @param identifier A raw username or email address.
 * @returns The matching user, or `null` if not found / blank input.
 */
export async function resolveUserByIdentifier(identifier: string): Promise<IUser | null> {
  const trimmed = identifier.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.includes('@')) {
    // Email — stored lowercased by the schema, so an exact lowercase match is
    // case-insensitive.
    return User.findOne({ email: trimmed.toLowerCase() });
  }

  // Username — stored trimmed but not lowercased; match exactly but
  // case-insensitively via an anchored, escaped regex.
  const exactCaseInsensitive = new RegExp(`^${escapeRegExp(trimmed)}$`, 'i');
  return User.findOne({ username: exactCaseInsensitive });
}
