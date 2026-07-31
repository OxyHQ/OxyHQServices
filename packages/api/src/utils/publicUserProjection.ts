/**
 * The Mongo projection for a PUBLIC user row.
 *
 * SINGLE source of truth for every endpoint that returns a list of other
 * people's user documents (followers, following, mutuals, user search). Those
 * lists render the same row everywhere in the ecosystem — avatar, display name,
 * handle, bio, verified badge, federated/remote-instance badge — so they all
 * need the same field set, and repeating a hand-written `.select('username name
 * avatar color …')` per query is exactly how they drifted apart: the follower /
 * following / mutual queries silently omitted `bio`, `verified` and
 * `federation`, so the API emitted `bio: undefined` on every row while the
 * model, the serializer (`UserService.formatUserResponse`) and the wire contract
 * (`userResponseSchema`) all carried the field.
 *
 * INVARIANT: this projection must cover every field
 * `UserService.formatUserResponse` reads. A field it reads but this does not
 * project is not an error anywhere — it just silently serializes as `undefined`.
 *
 * Inclusion-only on purpose: every unlisted path (`email`, `phone`, `password`,
 * `refreshToken`, hashed contacts, the private half of `privacySettings`, …) is
 * dropped by MongoDB itself, instead of relying on an easily-forgotten `-field`
 * exclusion to keep a private field off a public row.
 *
 * `publicKey` is deliberately NOT projected. The DTO `id` is always the stable
 * ObjectId (`formatUserResponse` anchors it on `_id`), and the social graph these
 * lists feed (follow edges, the viewer graph id lists, client-side follow-state
 * maps) is keyed by that same ObjectId — the public row needs no key material.
 */

import type { IUser } from '../models/User';

/**
 * Public profile paths. Nested paths are allowed (MongoDB projects the single
 * leaf), which is how the public, derived `fediverseSharing` consent flag is
 * exposed without dragging in the rest of `privacySettings`.
 */
const PUBLIC_USER_PROFILE_PATHS = [
  'username',
  'name',
  'avatar',
  'color',
  'bio',
  'description',
  'links',
  'linksMetadata',
  'verified',
  // Account type + remote-actor info: the row renders a verified badge, a
  // federated badge and the `@user@instance` handle from these.
  'type',
  'federation',
  // ONLY the public, derived consent flag — the rest of `privacySettings` is
  // private and must never reach a public row.
  'privacySettings.fediverseSharing',
  'createdAt',
  'updatedAt',
] as const;

/**
 * Gate-only paths: read by route handlers / `isPublicGraphTarget` to decide
 * whether a row is discoverable. Never serialized on public DTOs.
 */
const PUBLIC_USER_PROFILE_GATE_PATHS = [
  'accountStatus',
  'reputationTier',
  'privacySettings.isPrivateAccount',
] as const;

const ALL_PUBLIC_USER_PROFILE_PATHS = [
  ...PUBLIC_USER_PROFILE_PATHS,
  ...PUBLIC_USER_PROFILE_GATE_PATHS,
] as const;

/** `.select(...)` argument for a public user row. */
export const PUBLIC_USER_PROFILE_SELECT = ALL_PUBLIC_USER_PROFILE_PATHS.join(' ');

/**
 * `$project` stage for a public user row, for the surfaces that read through an
 * aggregation pipeline rather than a query (`GET /search`, `GET /profiles/search`).
 *
 * Derived from {@link PUBLIC_USER_PROFILE_PATHS} only — NOT
 * {@link PUBLIC_USER_PROFILE_GATE_PATHS}. Gate paths (`accountStatus`,
 * `reputationTier`, `privacySettings.isPrivateAccount`) are read from
 * {@link PUBLIC_USER_PROFILE_SELECT} when a handler must decide discoverability
 * before serializing, but they must never reach a public DTO. Search/profile
 * pipelines already filter those rows in `$match` (`peopleSearchMongoMatch`).
 *
 * INCLUSION-ONLY for the same reason as {@link PUBLIC_USER_PROFILE_SELECT}: an
 * exclusion `$project` listing the private fields to drop is one forgotten field
 * away from leaking. `GET /search` shipped exactly that bug — a
 * `{ password: 0, refreshToken: 0 }` denylist put `email`, `publicKey` and the
 * full `privacySettings` on an unauthenticated response.
 *
 * `_id` is included implicitly by MongoDB, which is what `formatUserResponse`
 * anchors the DTO `id` on. The sort-only fields a native-first pipeline adds
 * (`_nativePriority`, `_reputationRank`) are dropped for free — an inclusion
 * projection emits nothing it does not name.
 */
export const PUBLIC_USER_PROFILE_PROJECTION: Record<string, 1> = Object.fromEntries(
  PUBLIC_USER_PROFILE_PATHS.map((path) => [path, 1]),
);

/**
 * The lean document shape {@link PUBLIC_USER_PROFILE_SELECT} yields. Declared
 * from `IUser` so the projection and the type cannot drift: a path added to the
 * projection is a compile error here until it is a real `User` field.
 */
export type PublicUserDocument = Pick<
  IUser,
  | '_id'
  | 'username'
  | 'name'
  | 'avatar'
  | 'color'
  | 'bio'
  | 'description'
  | 'links'
  | 'linksMetadata'
  | 'verified'
  | 'type'
  | 'federation'
  | 'accountStatus'
  | 'reputationTier'
  | 'createdAt'
  | 'updatedAt'
> & {
  /** Only the projected leaves — see {@link PUBLIC_USER_PROFILE_SELECT}. */
  privacySettings?: Pick<IUser['privacySettings'], 'fediverseSharing' | 'isPrivateAccount'>;
};
