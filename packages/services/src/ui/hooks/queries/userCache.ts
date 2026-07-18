/**
 * Canonical user-cache UPSERT for the Oxy React Query cache.
 *
 * The problem this solves: many places across an app write a user object into
 * the React Query cache and REPLACE the existing entry — profile fetch, feed /
 * post hydration, search, notifications, lists. Each of those sources carries a
 * DIFFERENT (often sparse) slice of the user: a feed author has no viewer
 * `relationship`, a search hit has no `createdAt`, a notification actor has no
 * `_count`. A plain `setQueryData(key, sparseUser)` therefore STRIPS whatever
 * fields the authoritative single-profile fetch had already stored — the
 * "Follows you tag vanishes when the feed loads" / "counts flash to zero" class
 * of bug.
 *
 * The fix (owned here, in the SDK): ONE canonical upsert that MERGES. It writes
 * under BOTH keys the SDK's user hooks read from:
 *   - by-id:       `queryKeys.users.detail(id)`             (read by `useUserById`)
 *   - by-username: `queryKeys.users.byUsername(username, viewerId)` (viewer-scoped;
 *                  read by `useUserByUsername`, carries the viewer `relationship`)
 *
 * Merge semantics (per key):
 *   - No existing entry  -> seed the (normalized) incoming object and mark it
 *     STALE (`updatedAt: 0`) so react-query refetches the full authoritative
 *     profile (viewer-relative `relationship`, counts, `createdAt`, …). Instant
 *     first paint, then the real fetch.
 *   - Existing entry     -> `{ ...existing, ...pickMeaningful(incoming) }`: only
 *     the DEFINED, non-empty fields of `incoming` win; every other field is kept
 *     from `existing`. A sparse source can never NULL-out or STRIP a field the
 *     authoritative fetch set. The entry's freshness is left untouched (never
 *     marked stale — it is already managed).
 *   - Nested objects (`name`, `_count`, `relationship`) merge field-by-field, so
 *     a partial `name`/`_count`/`relationship` never replaces a fuller one.
 *   - Anti-degradation: a good `username` / `name.displayName` / `avatar` is
 *     never overwritten by a degraded/empty one (empty username, the
 *     `'Unknown user'` ghost-author sentinel, `null` avatar).
 *
 * It is a cache write only — zero network, one `setQueryData` per key.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { UserNameResponse } from '@oxyhq/contracts';
import { queryKeys } from './queryKeys';
import { useAuthStore } from '../../stores/authStore';

/**
 * A user-shaped object that can be upserted into the cache. Intentionally
 * permissive: it covers the SDK `User` PLUS the looser actor objects embedded on
 * posts / notifications / lists, where `name` may be a plain string and the id
 * may arrive as Mongo `_id`. Every field is optional — a sparse feed author is a
 * valid `CacheableUser`. The index signature lets any additional `User` field
 * pass through untouched (so the upsert never has to know the full DTO shape).
 */
export interface CacheableUser {
  id?: string;
  /** Some sources (post/notification actors) carry the id as Mongo `_id`. */
  _id?: string;
  username?: string;
  /**
   * Canonical structured name (`UserNameResponse`) OR a plain display string on
   * the looser actor objects. Normalized to the object shape on write.
   */
  name?: string | UserNameResponse;
  /** Avatar file id. `null`/`''` are treated as "no avatar" (never degrade). */
  avatar?: string | null;
  /** Social counts. A partial `_count` never replaces a fuller one. */
  _count?: { followers?: number; following?: number } | null;
  /**
   * Viewer-relative follow relationship. Present ONLY on an authenticated
   * single-profile fetch; `null`/absent for anon/self/bulk/feed. Never stripped
   * from an existing entry by a source that lacks it.
   */
  relationship?: { isFollowing?: boolean; followsYou?: boolean } | null;
  [key: string]: unknown;
}

/** The degraded display-name sentinel (ghost-author rule). */
const DEGRADED_DISPLAY_NAME = 'Unknown user';

/** A cache entry always carries a resolved string `id`. */
type CachedUser = CacheableUser & { id: string; name?: UserNameResponse };

/**
 * Whether a value is "meaningful" — i.e. it should override an existing field.
 * Drops `undefined` / `null` / empty-or-whitespace strings so a sparse source
 * can never strip a field. `false`, `0` and other falsy-but-defined values ARE
 * meaningful (a real `verified: false` or `_count.followers: 0`).
 */
function isMeaningful(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/** A display name is meaningful only when non-empty AND not the degraded sentinel. */
function isMeaningfulDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value !== DEGRADED_DISPLAY_NAME;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize the polymorphic `name` (string | object | nullish) to the canonical object shape. */
function normalizeName(name: CacheableUser['name']): UserNameResponse | undefined {
  if (name === undefined || name === null) return undefined;
  if (typeof name === 'string') {
    const trimmed = name.trim();
    return trimmed ? { displayName: trimmed } : undefined;
  }
  return name;
}

/**
 * Coerce a user-shaped object to a cache entry: resolve the id from
 * `id ?? _id ?? fallbackId` and normalize `name` to the canonical object shape
 * (the polymorphic `string` name is dropped from the spread and re-set as an
 * object so the cache never holds a bare-string name).
 */
function toCachedUser(user: CacheableUser, fallbackId: string): CachedUser {
  const { name: rawName, ...rest } = user;
  const id = String(user.id ?? user._id ?? fallbackId);
  const name = normalizeName(rawName);
  const normalized: CachedUser = { ...rest, id };
  if (name !== undefined) normalized.name = name;
  return normalized;
}

/**
 * Normalize an incoming (possibly partial) user to a cache entry. Returns `null`
 * when no id can be resolved (nothing to key on).
 */
function normalizeIncoming(user: CacheableUser): CachedUser | null {
  const cached = toCachedUser(user, '');
  return cached.id ? cached : null;
}

/** Merge two `name` objects field-by-field, with anti-degradation on `displayName`. */
function mergeName(
  existing: UserNameResponse | undefined,
  incoming: UserNameResponse | undefined,
): UserNameResponse | undefined {
  if (incoming === undefined) return existing;
  if (existing === undefined) return incoming;
  const merged: UserNameResponse = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'displayName') continue;
    if (isMeaningful(value)) merged[key] = value;
  }
  // Never let an empty / `'Unknown user'` displayName overwrite a real one.
  if (isMeaningfulDisplayName(incoming.displayName)) {
    merged.displayName = incoming.displayName;
  }
  return merged;
}

/** Merge `_count` field-by-field so a partial count never replaces a fuller one. */
function mergeCount(
  existing: CacheableUser['_count'],
  incoming: CacheableUser['_count'],
): CacheableUser['_count'] {
  if (!isPlainObject(incoming)) return existing;
  const merged: { followers?: number; following?: number } = { ...(isPlainObject(existing) ? existing : {}) };
  if (typeof incoming.followers === 'number') merged.followers = incoming.followers;
  if (typeof incoming.following === 'number') merged.following = incoming.following;
  return merged;
}

/**
 * Merge `relationship`. A source without a relationship (feed/list/notification,
 * or an anon/self/bulk `null`) must NEVER strip an existing viewer relationship.
 */
function mergeRelationship(
  existing: CacheableUser['relationship'],
  incoming: CacheableUser['relationship'],
): CacheableUser['relationship'] {
  if (!isPlainObject(incoming)) return existing;
  const merged: { isFollowing?: boolean; followsYou?: boolean } = {
    ...(isPlainObject(existing) ? existing : {}),
  };
  if (typeof incoming.isFollowing === 'boolean') merged.isFollowing = incoming.isFollowing;
  if (typeof incoming.followsYou === 'boolean') merged.followsYou = incoming.followsYou;
  return merged;
}

/**
 * Merge a (normalized) incoming user over an existing cache entry: keep every
 * existing field, override only with the meaningful fields of `incoming`.
 */
function mergeUsers(existing: CachedUser, incoming: CachedUser): CachedUser {
  const merged: CachedUser = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'name' || key === '_count' || key === 'relationship') continue;
    if (key === 'id') {
      merged.id = incoming.id;
      continue;
    }
    if (isMeaningful(value)) merged[key] = value;
  }
  const name = mergeName(existing.name, incoming.name);
  if (name !== undefined) merged.name = name;
  const count = mergeCount(existing._count, incoming._count);
  if (count !== undefined) merged._count = count;
  const relationship = mergeRelationship(existing.relationship, incoming.relationship);
  if (relationship !== undefined) merged.relationship = relationship;
  return merged;
}

/** Merge-upsert a normalized user into one cache key (see module docs for semantics). */
function upsertOneKey(
  queryClient: QueryClient,
  key: readonly unknown[],
  incoming: CachedUser,
): void {
  const existing = queryClient.getQueryData<CacheableUser>(key);
  if (existing === undefined) {
    // Cold slot: seed the full incoming object, STALE, so react-query refetches
    // the full authoritative profile (relationship, counts, createdAt, …).
    queryClient.setQueryData<CachedUser>(key, incoming, { updatedAt: 0 });
    return;
  }
  // Existing entry: merge and leave its freshness lifecycle untouched. The
  // existing entry is keyed by `incoming.id`, so use it as the fallback id.
  const merged = mergeUsers(toCachedUser(existing, incoming.id), incoming);
  const dataUpdatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
  queryClient.setQueryData<CachedUser>(key, merged, { updatedAt: dataUpdatedAt });
}

/**
 * Resolve the active viewer id. The by-username cache key is viewer-scoped; the
 * seed must land on the exact key `useUserByUsername` reads. When a caller does
 * not pass `viewerId`, read it from the auth store — the same store behind the
 * hook's `useOxy().user?.id`, so seed and read stay in lockstep. An explicit
 * empty string is honoured (anonymous scope).
 */
function resolveViewerId(viewerId?: string): string {
  return viewerId ?? useAuthStore.getState().user?.id ?? '';
}

/**
 * Merge-upsert a (possibly partial) user into the SDK's user query cache under
 * both the by-id key and, when a username is present, the viewer-scoped
 * by-username key.
 *
 * @param queryClient The app's React Query client.
 * @param user        A `User`-shaped object (may be sparse).
 * @param viewerId    The active viewer id for the by-username key. Defaults to
 *                    the current auth-store user id.
 */
export function upsertCachedUser(
  queryClient: QueryClient,
  user: CacheableUser,
  viewerId?: string,
): void {
  const incoming = normalizeIncoming(user);
  if (!incoming) return;

  // By-id identity entry (read by `useUserById`). Not viewer-scoped.
  upsertOneKey(queryClient, queryKeys.users.detail(incoming.id), incoming);

  const username = incoming.username;
  if (typeof username === 'string' && username.trim() !== '') {
    // By-username entry (read by `useUserByUsername`). Viewer-scoped because the
    // authenticated single-profile fetch embeds the viewer `relationship`. Build
    // the key through the SAME helper the hook uses so username normalization
    // (`trim().toLowerCase()`) matches byte-for-byte.
    const key = queryKeys.users.byUsername(username, resolveViewerId(viewerId));
    upsertOneKey(queryClient, key, incoming);
  }
}

/**
 * Batch merge-upsert many users at once (for a feed / list / search response).
 * Resolves the viewer id once and upserts each user cumulatively — a user that
 * appears twice merges both slices into the single cache entry.
 */
export function upsertCachedUsers(
  queryClient: QueryClient,
  users: readonly CacheableUser[] | null | undefined,
  viewerId?: string,
): void {
  if (!Array.isArray(users) || users.length === 0) return;
  const resolvedViewerId = resolveViewerId(viewerId);
  for (const user of users) {
    if (user) upsertCachedUser(queryClient, user, resolvedViewerId);
  }
}
