/**
 * Simple utility to format user objects for API responses.
 * Returns clean, explicit user object with id (MongoDB ObjectId) and publicKey as separate fields.
 */

import type { IUser } from '../models/User';

export type UserLike = IUser | { _id: any; [key: string]: any } | null | undefined;

/**
 * Structured human-name subdocument as emitted on the wire.
 *
 * Mirrors `User.NameSchema`: `first`/`last` are stored (default `''`), `full` is
 * a Mongoose virtual. `formatUserResponse` ALWAYS emits a `full` value computed
 * from `first`/`last` when the source document was loaded without virtuals (e.g.
 * a `.lean()` query) — see {@link composeName}.
 */
interface FormattedName {
  first?: string;
  last?: string;
  full?: string;
}

/**
 * The shape of a source `name` field. Tolerant of both hydrated docs and
 * `.lean()` results: `full` is the optional virtual, `first`/`last` are stored.
 */
type NameLike =
  | {
      first?: unknown;
      last?: unknown;
      full?: unknown;
    }
  | null
  | undefined;

/**
 * Compose the structured name object for the response, GUARANTEEING a `full`
 * value whenever a first or last name is present — regardless of whether the
 * source document materialised the `name.full` Mongoose virtual.
 *
 * Resolution for `full`:
 *   1. the existing `name.full` virtual when present (and non-empty), else
 *   2. `[first, last].filter(Boolean).join(' ')` (first-only is valid — there is
 *      NO requirement that both parts exist).
 *
 * When both `first` and `last` are empty, `full` is omitted (empty string is not
 * emitted) — the core display resolver falls back further (username, then a
 * truncated public key), so an empty `full` carries no information.
 *
 * Returns `undefined` when there is no `name` subdocument at all, so the field is
 * simply absent from the response rather than an empty object.
 */
function composeName(name: NameLike): FormattedName | undefined {
  if (!name || typeof name !== 'object') {
    return undefined;
  }

  const first = typeof name.first === 'string' ? name.first : '';
  const last = typeof name.last === 'string' ? name.last : '';
  const existingFull = typeof name.full === 'string' ? name.full.trim() : '';

  const composedFull = existingFull || [first, last].filter(Boolean).join(' ').trim();

  const formatted: FormattedName = {};
  if (first) {
    formatted.first = first;
  }
  if (last) {
    formatted.last = last;
  }
  if (composedFull) {
    formatted.full = composedFull;
  }

  // If the source `name` carried nothing usable, omit the field entirely.
  if (formatted.first === undefined && formatted.last === undefined && formatted.full === undefined) {
    return undefined;
  }

  return formatted;
}

/**
 * Read the server `displayName` virtual when present.
 *
 * The server `displayName` virtual is the AUTHORITATIVE default, composed in
 * preference order `name.full → username → truncated publicKey handle` (see
 * `User.ts`). It is forwarded here for clients that want a ready-made display
 * string; clients may still compose their own from the raw fields (`name.full`,
 * `username`, etc.), all of which remain on the response.
 *
 * Present only when the source document materialised virtuals; absent on plain
 * `.lean()` reads — in which case the response carries the composed `name.full`
 * (see {@link composeName}) and the core display resolver derives the rest.
 */
function readDisplayName(user: { displayName?: unknown }): string | undefined {
  return typeof user.displayName === 'string' && user.displayName.length > 0
    ? user.displayName
    : undefined;
}

/**
 * Format user object for API response.
 * id = MongoDB ObjectId (_id.toString())
 * publicKey = separate field for authentication
 *
 * Self-sufficient name composition: the returned `name.full` is ALWAYS correct
 * whether or not the source document was loaded with Mongoose virtuals. This is
 * the canonical producer of the `@oxyhq/core` `userResponseSchema` contract — the
 * api `userTransform.contract.test.ts` locks the output to that schema so the
 * producer cannot silently drift from it again.
 */
export function formatUserResponse(user: UserLike) {
  if (!user) {
    return null;
  }

  const userId = user._id?.toString();
  if (!userId) {
    return null;
  }

  const name = composeName(user.name as NameLike);
  const displayName = readDisplayName(user as { displayName?: unknown });

  return {
    id: userId,
    publicKey: user.publicKey,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    color: user.color,
    name,
    displayName,
    privacySettings: user.privacySettings,
    verified: user.verified,
    language: user.language,
    bio: user.bio,
    description: user.description,
    locations: user.locations,
    links: user.links,
    linksMetadata: user.linksMetadata,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
